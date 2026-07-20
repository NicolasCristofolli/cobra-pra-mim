import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { queryOne, query } from '../src/db';
import { encrypt } from '../src/lib/crypto';
import { createCharge } from '../src/modules/charges/charges.repo';
import {
  buildTestApp,
  createClient,
  createUser,
  truncateAll,
  type TestHarness
} from './helpers';

describe('webhook de pagamentos (POST /webhooks/payments/:userId)', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  async function setupPendingCharge() {
    const user = await createUser({ webhookSecret: 'segredo-forte-123' });
    const clientId = await createClient(user.id, {
      name: 'Cliente Webhook',
      phone: '5551999990000'
    });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Fatura teste',
      amountCents: 15000,
      dueDate: '2026-07-06',
      recurrence: 'NONE'
    });
    return { user, charge };
  }

  it('rejeita com 401 quando o token está ausente e a fatura NÃO muda', async () => {
    const { user, charge } = await setupPendingCharge();

    const response = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .send({
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_1', externalReference: charge.id, value: 150 }
      });

    expect(response.status).toBe(401);
    const row = await queryOne<{ status: string }>(
      'SELECT status FROM charges WHERE id = $1',
      [charge.id]
    );
    expect(row!.status).toBe('PENDING');
    expect(harness.sentMessages).toHaveLength(0);
  });

  it('rejeita com 401 quando o token está errado (comparação timing-safe)', async () => {
    const { user, charge } = await setupPendingCharge();

    const response = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('asaas-access-token', 'token-errado')
      .send({
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_1', externalReference: charge.id, value: 150 }
      });

    expect(response.status).toBe(401);
    const row = await queryOne<{ status: string }>(
      'SELECT status FROM charges WHERE id = $1',
      [charge.id]
    );
    expect(row!.status).toBe('PENDING');
  });

  it('processa PAYMENT_RECEIVED do Asaas: marca PAGO, grava líquido e confirma no WhatsApp', async () => {
    const { user, charge } = await setupPendingCharge();

    const response = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('asaas-access-token', user.webhookSecret)
      .send({
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay_asaas_777',
          externalReference: charge.id,
          value: 150,
          netValue: 148.01
        }
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, paid: true, chargeId: charge.id });

    const row = await queryOne<{
      status: string;
      paid_at: string | null;
      net_amount_cents: number | null;
    }>('SELECT status, paid_at, net_amount_cents FROM charges WHERE id = $1', [charge.id]);
    expect(row!.status).toBe('PAID');
    expect(row!.paid_at).not.toBeNull();
    expect(row!.net_amount_cents).toBe(14801);

    // Confirmação enviada pelo template paid_template com o valor formatado.
    expect(harness.sentMessages).toHaveLength(1);
    expect(harness.sentMessages[0]!.message).toContain('Cliente Webhook');
    expect(harness.sentMessages[0]!.message).toContain('150,00');

    const log = await queryOne<{ kind: string; success: boolean }>(
      `SELECT kind, success FROM notification_logs WHERE charge_id = $1`,
      [charge.id]
    );
    expect(log).toMatchObject({ kind: 'PAYMENT_CONFIRMED', success: true });
  });

  it('é idempotente: o mesmo evento duas vezes não duplica confirmação nem log', async () => {
    const { user, charge } = await setupPendingCharge();
    const payload = {
      event: 'PAYMENT_CONFIRMED',
      payment: { id: 'pay_x', externalReference: charge.id, value: 150 }
    };

    const first = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('x-webhook-token', user.webhookSecret)
      .send(payload);
    expect(first.body.paid).toBe(true);

    const second = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('x-webhook-token', user.webhookSecret)
      .send(payload);
    expect(second.status).toBe(200);
    expect(second.body.alreadyPaid).toBe(true);

    expect(harness.sentMessages).toHaveLength(1);
    const logs = await query('SELECT id FROM notification_logs WHERE charge_id = $1', [
      charge.id
    ]);
    expect(logs).toHaveLength(1);
  });

  it('evento que não bate com nenhuma fatura responde 200 (evita retries) sem efeitos', async () => {
    const { user } = await setupPendingCharge();

    const response = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('asaas-access-token', user.webhookSecret)
      .send({
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'pay_desconhecido', externalReference: null, value: 10 }
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ received: true, matched: false });
    expect(harness.sentMessages).toHaveLength(0);
  });

  it('localiza a fatura pelo gateway_charge_id quando não há externalReference', async () => {
    const { user, charge } = await setupPendingCharge();
    await query('UPDATE charges SET gateway_charge_id = $2 WHERE id = $1', [
      charge.id,
      'pay_via_gwid'
    ]);

    const response = await request(harness.app)
      .post(`/webhooks/payments/${user.id}`)
      .set('asaas-access-token', user.webhookSecret)
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_via_gwid', value: 150 } });

    expect(response.status).toBe(200);
    expect(response.body.paid).toBe(true);
  });

  describe('Mercado Pago (header x-signature)', () => {
    const MP_SECRET = 'assinatura-secreta-do-painel-mp';
    const REQUEST_ID = 'req-abc-123';

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function setupMpUser() {
      const setup = await setupPendingCharge();
      await query(
        `UPDATE settings
           SET gateway_provider = 'MERCADO_PAGO',
               gateway_api_key_enc = $2,
               mp_webhook_secret_enc = $3
         WHERE user_id = $1`,
        [setup.user.id, encrypt('APP_USR-token-mp'), encrypt(MP_SECRET)]
      );
      return setup;
    }

    /** Assina como o Mercado Pago: HMAC-SHA256 de id:<dataId>;request-id:<rid>;ts:<ts>; */
    function signMp(dataId: string, ts = '1720000000') {
      const manifest = `id:${dataId};request-id:${REQUEST_ID};ts:${ts};`;
      const v1 = createHmac('sha256', MP_SECRET).update(manifest).digest('hex');
      return `ts=${ts},v1=${v1}`;
    }

    function mockMpApi(payment: Record<string, unknown>) {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => payment
      }));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('aceita ping com x-signature válida, verifica na API do MP e marca PAGO', async () => {
      const { user, charge } = await setupMpUser();
      const paymentId = '987654321';
      const fetchMock = mockMpApi({
        id: Number(paymentId),
        status: 'approved',
        external_reference: charge.id,
        transaction_details: { net_received_amount: 148.01 }
      });

      const response = await request(harness.app)
        .post(`/webhooks/payments/${user.id}`)
        .query({ 'data.id': paymentId, type: 'payment' })
        .set('x-signature', signMp(paymentId))
        .set('x-request-id', REQUEST_ID)
        .send({ type: 'payment', data: { id: paymentId } });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ received: true, paid: true, chargeId: charge.id });
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.mercadopago.com/v1/payments/${paymentId}`,
        expect.objectContaining({
          headers: { Authorization: 'Bearer APP_USR-token-mp' }
        })
      );

      const row = await queryOne<{ status: string; net_amount_cents: number | null }>(
        'SELECT status, net_amount_cents FROM charges WHERE id = $1',
        [charge.id]
      );
      expect(row!.status).toBe('PAID');
      expect(row!.net_amount_cents).toBe(14801);
    });

    it('rejeita com 401 quando a x-signature não confere e NÃO consulta a API do MP', async () => {
      const { user, charge } = await setupMpUser();
      const fetchMock = mockMpApi({ id: 1, status: 'approved' });

      const response = await request(harness.app)
        .post(`/webhooks/payments/${user.id}`)
        .query({ 'data.id': '987654321', type: 'payment' })
        .set('x-signature', 'ts=1720000000,v1=deadbeef')
        .set('x-request-id', REQUEST_ID)
        .send({ type: 'payment', data: { id: '987654321' } });

      expect(response.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
      const row = await queryOne<{ status: string }>(
        'SELECT status FROM charges WHERE id = $1',
        [charge.id]
      );
      expect(row!.status).toBe('PENDING');
    });

    it('rejeita com 401 quando vem x-signature mas a assinatura secreta não está configurada', async () => {
      const { user, charge } = await setupPendingCharge(); // sem mp_webhook_secret_enc

      const response = await request(harness.app)
        .post(`/webhooks/payments/${user.id}`)
        .query({ 'data.id': '111', type: 'payment' })
        .set('x-signature', signMp('111'))
        .set('x-request-id', REQUEST_ID)
        .send({ type: 'payment', data: { id: '111' } });

      expect(response.status).toBe(401);
      const row = await queryOne<{ status: string }>(
        'SELECT status FROM charges WHERE id = $1',
        [charge.id]
      );
      expect(row!.status).toBe('PENDING');
    });

    it('ping assinado de pagamento NÃO aprovado responde 200 sem dar baixa', async () => {
      const { user, charge } = await setupMpUser();
      mockMpApi({ id: 555, status: 'pending', external_reference: charge.id });

      const response = await request(harness.app)
        .post(`/webhooks/payments/${user.id}`)
        .query({ 'data.id': '555', type: 'payment' })
        .set('x-signature', signMp('555'))
        .set('x-request-id', REQUEST_ID)
        .send({ type: 'payment', data: { id: '555' } });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ received: true, handled: false });
      const row = await queryOne<{ status: string }>(
        'SELECT status FROM charges WHERE id = $1',
        [charge.id]
      );
      expect(row!.status).toBe('PENDING');
    });
  });

  it('token válido de OUTRO usuário não paga fatura alheia (isolamento por tenant)', async () => {
    const { charge } = await setupPendingCharge();
    const intruso = await createUser({ webhookSecret: 'segredo-do-intruso' });

    const response = await request(harness.app)
      .post(`/webhooks/payments/${intruso.id}`)
      .set('asaas-access-token', intruso.webhookSecret)
      .send({
        event: 'PAYMENT_RECEIVED',
        payment: { id: 'p', externalReference: charge.id, value: 150 }
      });

    // Autenticou no tenant do intruso, mas a fatura não pertence a ele.
    expect(response.status).toBe(200);
    expect(response.body.matched).toBe(false);
    const row = await queryOne<{ status: string }>(
      'SELECT status FROM charges WHERE id = $1',
      [charge.id]
    );
    expect(row!.status).toBe('PENDING');
  });
});
