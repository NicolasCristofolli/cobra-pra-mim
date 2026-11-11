import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { addDaysISO, todayISO } from '../src/lib/dates';
import { createCharge, type ChargeRow } from '../src/modules/charges/charges.repo';
import { runBillingCycle } from '../src/services/billing-engine';
import { resolveAccess } from '../src/services/subscription/access';
import {
  buildTestApp,
  createClient,
  createUser,
  loginAgent,
  truncateAll,
  type TestHarness
} from './helpers';

/** Regressões dos bugs encontrados na revisão de código. */
describe('correções da revisão', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('cliente excluído com fatura ENVIADA: a fatura é cancelada, a série para e nada é enviado', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Ana', phone: '5551999110010' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Mensalidade',
      amountCents: 10000,
      dueDate: addDaysISO(today, 3),
      recurrence: 'MONTHLY'
    });
    // "Enviar agora" antes do vencimento deixa a fatura SENT.
    const sent = await agent.post(`/charges/${charge.id}/notify`);
    expect(sent.status).toBe(200);
    expect(sent.body.charge.status).toBe('SENT');

    const removed = await agent.delete(`/clients/${clientId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.canceledChargeIds).toContain(charge.id);

    const before = harness.sentMessages.length;
    const report = await runBillingCycle(harness.deps, addDaysISO(today, 3));
    expect(report.generated).toBe(0);
    expect(harness.sentMessages).toHaveLength(before);
  });

  it('cliente excluído com a última fatura já PAGA: o motor não gera novos ciclos nem cobra', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Bia', phone: '5551999110011' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Plano',
      amountCents: 5000,
      dueDate: today,
      recurrence: 'WEEKLY'
    });
    expect((await agent.post(`/charges/${charge.id}/pay`)).status).toBe(200);
    expect((await agent.delete(`/clients/${clientId}`)).status).toBe(200);

    const messagesBefore = harness.sentMessages.length;
    const report = await runBillingCycle(harness.deps, addDaysISO(today, 8));
    expect(report.generated).toBe(0);
    expect(report.notified).toBe(0);
    expect(harness.sentMessages).toHaveLength(messagesBefore);

    // Desfez a exclusão: a série volta a gerar (catch-up).
    expect((await agent.post(`/clients/${clientId}/restore`)).status).toBe(200);
    const resumed = await runBillingCycle(harness.deps, addDaysISO(today, 8));
    expect(resumed.generated).toBeGreaterThan(0);
  });

  it('editar o valor de uma fatura com Pix gerado: cancela o Pix antigo e volta para PENDING', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Caio', phone: '5551999110012' });
    const dueDate = addDaysISO(today, 2);
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Serviço',
      amountCents: 10000,
      dueDate,
      recurrence: 'NONE'
    });
    expect((await agent.post(`/charges/${charge.id}/notify`)).status).toBe(200);
    const withPix = await queryOne<ChargeRow>('SELECT * FROM charges WHERE id = $1', [charge.id]);
    expect(withPix!.gateway_charge_id).toBe('fake_pay_1');

    // Só a descrição mudou: o Pix continua valendo.
    const sameValue = await agent
      .put(`/charges/${charge.id}`)
      .send({ description: 'Serviço (ajuste)', amountCents: 10000, dueDate });
    expect(sameValue.status).toBe(200);
    expect(sameValue.body.gatewayChargeId).toBe('fake_pay_1');
    expect(sameValue.body.status).toBe('SENT');
    expect(harness.gatewayCancels).toHaveLength(0);

    // Valor mudou: Pix antigo cancelado no gateway e limpo na fatura.
    const edited = await agent
      .put(`/charges/${charge.id}`)
      .send({ description: 'Serviço (ajuste)', amountCents: 20000, dueDate });
    expect(edited.status).toBe(200);
    expect(harness.gatewayCancels).toEqual(['fake_pay_1']);
    expect(edited.body.gatewayChargeId).toBeNull();
    expect(edited.body.pixCopyPaste).toBeNull();
    expect(edited.body.lastNotifiedAt).toBeNull();
    expect(edited.body.status).toBe('PENDING');

    // Reenvio gera um Pix novo com o valor novo.
    expect((await agent.post(`/charges/${charge.id}/notify`)).status).toBe(200);
    expect(harness.gatewayCalls.at(-1)!.amountCents).toBe(20000);
  });

  it('fatura atrasada nunca notificada: o Pix é criado vencendo hoje, não no passado', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'Duda', phone: '5551999110013' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Atrasada',
      amountCents: 7000,
      dueDate: today,
      recurrence: 'NONE'
    });
    await query(`UPDATE charges SET due_date = $2 WHERE id = $1`, [charge.id, addDaysISO(today, -5)]);

    const report = await runBillingCycle(harness.deps);
    expect(report.overdueMarked).toBe(1);
    expect(report.notified).toBe(1);
    expect(harness.gatewayCalls).toHaveLength(1);
    expect(harness.gatewayCalls[0]!.dueDate).toBe(today);
  });

  it('datas inexistentes e valores fora do limite respondem 400, não 500', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Edu', phone: '5551999110014' });
    const base = { clientId, description: 'Teste', amountCents: 1000, recurrence: 'NONE' };
    const year = Number(today.slice(0, 4)) + 1;

    expect((await agent.post('/charges').send({ ...base, dueDate: `${year}-02-31` })).status).toBe(400);
    expect((await agent.post('/charges').send({ ...base, dueDate: `${year}-13-01` })).status).toBe(400);
    expect(
      (await agent.post('/charges').send({ ...base, dueDate: `${year}-03-10`, amountCents: 3_000_000_000 })).status
    ).toBe(400);

    const ok = await agent.post('/charges').send({ ...base, dueDate: `${year}-03-10` });
    expect(ok.status).toBe(201);
    const badEdit = await agent
      .put(`/charges/${ok.body.id}`)
      .send({ description: 'Teste', amountCents: 1000, dueDate: `${year}-04-31` });
    expect(badEdit.status).toBe(400);
  });

  it('métricas: fatura ENVIADA conta como "em aberto" e série encerrada sai do MRR', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Fábio', phone: '5551999110015' });
    const open = await createCharge({
      userId: user.id,
      clientId,
      description: 'Avulsa',
      amountCents: 3000,
      dueDate: addDaysISO(today, 4),
      recurrence: 'NONE'
    });
    expect((await agent.post(`/charges/${open.id}/notify`)).status).toBe(200); // vira SENT
    // Série mensal cuja data limite já é o próprio vencimento: não gera mais ciclos.
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Série no fim',
      amountCents: 9000,
      dueDate: addDaysISO(today, 1),
      recurrence: 'MONTHLY',
      recurrenceEndDate: addDaysISO(today, 1)
    });
    // Série mensal ativa.
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Série ativa',
      amountCents: 4000,
      dueDate: addDaysISO(today, 1),
      recurrence: 'MONTHLY',
      recurrenceEndDate: addDaysISO(today, 400)
    });

    const metrics = await agent.get('/dashboard/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.body.statusCounts).toEqual({ paid: 0, open: 3, overdue: 0 });
    expect(metrics.body.clientsTotal).toBe(1);
    expect(metrics.body.clientsOverdue).toBe(0);
    expect(metrics.body.mrrCents).toBe(4000);
  });

  it('dar baixa duas vezes responde 409 na segunda (sem erro 500)', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Gabi', phone: '5551999110016' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Dupla',
      amountCents: 1000,
      dueDate: today,
      recurrence: 'NONE'
    });
    const [first, second] = await Promise.all([
      agent.post(`/charges/${charge.id}/pay`),
      agent.post(`/charges/${charge.id}/pay`)
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    // Uma única confirmação de pagamento no WhatsApp.
    expect(harness.sentMessages).toHaveLength(1);
  });

  it('webhook duplicado simultâneo: uma baixa, uma confirmação', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'Hugo', phone: '5551999110017' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Webhook',
      amountCents: 2500,
      dueDate: today,
      recurrence: 'NONE'
    });
    const { default: request } = await import('supertest');
    const send = () =>
      request(harness.app)
        .post(`/webhooks/payments/${user.id}`)
        .set('x-webhook-token', user.webhookSecret)
        .send({ status: 'PAID', chargeId: charge.id });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(responses.filter((r) => r.body.paid === true)).toHaveLength(1);
    expect(harness.sentMessages).toHaveLength(1);
  });

  it('cancelar durante o período de teste mantém o acesso até o fim do teste', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const day = 86_400_000;
    const base = { grace_days: 5, current_period_end: null };
    expect(
      resolveAccess(
        { ...base, status: 'CANCELED', trial_ends_at: new Date(now.getTime() + 3 * day) },
        now
      ).state
    ).toBe('FULL');
    expect(
      resolveAccess(
        { ...base, status: 'CANCELED', trial_ends_at: new Date(now.getTime() - day) },
        now
      ).state
    ).toBe('BLOCKED');
    expect(resolveAccess({ ...base, status: 'CANCELED', trial_ends_at: null }, now).state).toBe(
      'BLOCKED'
    );
  });
});
