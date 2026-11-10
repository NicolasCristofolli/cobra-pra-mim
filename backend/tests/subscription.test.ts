import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { addDaysISO, todayISO } from '../src/lib/dates';
import { createCharge } from '../src/modules/charges/charges.repo';
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

const WEBHOOK_TOKEN = 'token-plataforma-teste';
const CPF_VALIDO = '529.982.247-25';
const DAY = 86_400_000;

function webhook(harness: TestHarness, body: object, token: string | null = WEBHOOK_TOKEN) {
  const req = request(harness.app).post('/webhooks/platform/asaas');
  if (token) req.set('asaas-access-token', token);
  return req.send(body);
}

async function setSubscription(
  userId: string,
  fields: { status: string; periodEndDaysFromNow: number | null; trialDaysFromNow?: number }
) {
  await query(
    `UPDATE subscriptions
        SET status = $2,
            current_period_end = CASE WHEN $3::int IS NULL THEN NULL
                                      ELSE now() + ($3::int * interval '1 day') END,
            trial_ends_at = CASE WHEN $4::int IS NULL THEN NULL
                                 ELSE now() + ($4::int * interval '1 day') END
      WHERE user_id = $1`,
    [userId, fields.status, fields.periodEndDaysFromNow, fields.trialDaysFromNow ?? null]
  );
}

describe('resolveAccess (regra de acesso)', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const base = { trial_ends_at: null, grace_days: 5 };
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  it('sem assinatura ou aguardando pagamento: bloqueado', () => {
    expect(resolveAccess(null, now)).toMatchObject({ state: 'BLOCKED', reason: 'NO_PLAN' });
    expect(
      resolveAccess({ ...base, status: 'PENDING_PAYMENT', current_period_end: null }, now)
    ).toMatchObject({ state: 'BLOCKED', reason: 'PENDING_PAYMENT' });
  });

  it('ativa dentro do período: acesso total', () => {
    expect(resolveAccess({ ...base, status: 'ACTIVE', current_period_end: at(3) }, now).state).toBe('FULL');
  });

  it('venceu dentro da carência: aviso; depois da carência: bloqueio', () => {
    const warning = resolveAccess({ ...base, status: 'PAST_DUE', current_period_end: at(-2) }, now);
    expect(warning).toMatchObject({ state: 'WARNING', reason: 'PAST_DUE' });
    expect(new Date(warning.blocksAt!).getTime()).toBe(at(3).getTime());
    expect(
      resolveAccess({ ...base, status: 'PAST_DUE', current_period_end: at(-6) }, now)
    ).toMatchObject({ state: 'BLOCKED', reason: 'EXPIRED' });
    // Mesmo sem o webhook PAYMENT_OVERDUE, a data decide.
    expect(resolveAccess({ ...base, status: 'ACTIVE', current_period_end: at(-2) }, now).state).toBe('WARNING');
  });

  it('cancelada: acesso até o fim do período, sem carência', () => {
    expect(resolveAccess({ ...base, status: 'CANCELED', current_period_end: at(1) }, now).state).toBe('FULL');
    expect(resolveAccess({ ...base, status: 'CANCELED', current_period_end: at(-1) }, now).state).toBe('BLOCKED');
  });

  it('trial: libera até trial_ends_at', () => {
    expect(
      resolveAccess({ ...base, status: 'TRIALING', current_period_end: null, trial_ends_at: at(1) }, now)
    ).toMatchObject({ state: 'FULL', reason: 'TRIAL' });
    expect(
      resolveAccess({ ...base, status: 'TRIALING', current_period_end: null, trial_ends_at: at(-1) }, now).state
    ).toBe('BLOCKED');
  });
});

describe('fluxo: plano -> checkout -> ativação', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await truncateAll();
    process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN = WEBHOOK_TOKEN;
    harness = buildTestApp();
  });

  it('conta nova fica bloqueada (402) até o webhook confirmar o pagamento', async () => {
    const user = await createUser({ subscription: 'NONE' });
    const agent = await loginAgent(harness.app, user);

    const blocked = await agent.get('/clients');
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('SUBSCRIPTION_NO_PLAN');

    const me = await agent.get('/auth/me');
    expect(me.body.access).toMatchObject({ state: 'BLOCKED', reason: 'NO_PLAN' });
    expect(me.body.subscription).toBeNull();

    // 1) Planos ficam acessíveis mesmo bloqueado.
    const plans = await agent.get('/billing/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.map((p: { code: string }) => p.code)).toEqual(['mensal', 'anual']);

    // 2) Checkout
    const invalid = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: '111.111.111-11' });
    expect(invalid.status).toBe(400);

    const checkout = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: CPF_VALIDO });
    expect(checkout.status).toBe(201);
    expect(checkout.body.checkoutUrl).toBe('https://fake.asaas/i/sub_fake_1');
    expect(harness.platformCalls.find((c) => c.method === 'ensureCustomer')!.args).toMatchObject({
      userId: user.id,
      cpfCnpj: '52998224725'
    });

    // Duplo clique: reaproveita, sem criar outra assinatura no Asaas.
    const again = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: CPF_VALIDO });
    expect(again.body.checkoutUrl).toBe(checkout.body.checkoutUrl);
    expect(harness.platformCalls.filter((c) => c.method === 'createSubscription')).toHaveLength(1);

    // Voltar do checkout NÃO ativa: ainda bloqueado.
    expect((await agent.get('/clients')).status).toBe(402);
    expect((await agent.get('/billing/access')).body.reason).toBe('PENDING_PAYMENT');

    // 3) Webhook: token errado é recusado.
    const payment = {
      id: 'pay_sub_fake_1',
      subscription: 'sub_fake_1',
      value: 49.9,
      dueDate: todayISO(),
      invoiceUrl: 'https://fake.asaas/i/sub_fake_1'
    };
    expect((await webhook(harness, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment }, 'errado')).status).toBe(401);
    expect((await webhook(harness, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment }, null)).status).toBe(401);

    const confirmed = await webhook(harness, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment });
    expect(confirmed.body.result).toBe('activated');

    // Reenvio do mesmo evento: idempotente.
    const duplicate = await webhook(harness, { id: 'evt_1', event: 'PAYMENT_CONFIRMED', payment });
    expect(duplicate.body.result).toBe('duplicate');

    expect((await agent.get('/clients')).status).toBe(200);
    const status = await agent.get('/billing/status');
    expect(status.body.access.state).toBe('FULL');
    expect(status.body.subscription.status).toBe('ACTIVE');
    expect(status.body.openPayment).toBeNull();

    // Período pago = vencimento + 1 mês.
    const sub = await queryOne<{ end: string }>(
      `SELECT (current_period_end AT TIME ZONE 'America/Sao_Paulo')::date::text AS end
         FROM subscriptions WHERE user_id = $1`,
      [user.id]
    );
    const [y, m] = todayISO().split('-').map(Number) as [number, number];
    expect(sub!.end.slice(0, 7)).toBe(`${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}`);
  });

  it('checkout indisponível sem a chave da plataforma responde 503', async () => {
    harness = buildTestApp({ withPlatformBilling: false });
    const user = await createUser({ subscription: 'NONE' });
    const agent = await loginAgent(harness.app, user);
    const response = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: CPF_VALIDO });
    expect(response.status).toBe(503);
  });

  it('atraso dentro da carência: libera com aviso; depois: bloqueia', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    await setSubscription(user.id, { status: 'PAST_DUE', periodEndDaysFromNow: -2 });
    const warned = await agent.get('/clients');
    expect(warned.status).toBe(200);
    expect(warned.headers['x-subscription-warning']).toBeDefined();
    expect((await agent.get('/auth/me')).body.access.state).toBe('WARNING');

    await setSubscription(user.id, { status: 'PAST_DUE', periodEndDaysFromNow: -6 });
    const expired = await agent.get('/clients');
    expect(expired.status).toBe(402);
    expect(expired.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('PAYMENT_OVERDUE marca PAST_DUE e o pagamento seguinte reativa', async () => {
    const user = await createUser();
    const subId = `sub_test_${user.id.slice(0, 8)}`;
    const overdue = {
      id: 'pay_2',
      subscription: subId,
      value: 49.9,
      dueDate: addDaysISO(todayISO(), -1),
      invoiceUrl: 'https://fake.asaas/i/pay_2'
    };
    expect((await webhook(harness, { id: 'evt_o', event: 'PAYMENT_OVERDUE', payment: overdue })).body.result).toBe('past_due');
    let row = await queryOne<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
    expect(row!.status).toBe('PAST_DUE');

    // "Pagar agora" do aviso devolve o boleto em atraso.
    await setSubscription(user.id, { status: 'PAST_DUE', periodEndDaysFromNow: -1 });
    const agent = await loginAgent(harness.app, user);
    const payNow = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: CPF_VALIDO });
    expect(payNow.body.checkoutUrl).toBe('https://fake.asaas/i/pay_2');
    expect(harness.platformCalls.filter((c) => c.method === 'createSubscription')).toHaveLength(0);

    await webhook(harness, { id: 'evt_r', event: 'PAYMENT_RECEIVED', payment: overdue });
    row = await queryOne<{ status: string }>('SELECT status FROM subscriptions WHERE user_id = $1', [user.id]);
    expect(row!.status).toBe('ACTIVE');
    expect((await agent.get('/billing/access')).body.state).toBe('FULL');
  });

  it('expirada com boleto antigo demais: não oferece o boleto, cria assinatura nova', async () => {
    const user = await createUser();
    const subId = `sub_test_${user.id.slice(0, 8)}`;
    const stale = { id: 'pay_old', subscription: subId, value: 49.9, dueDate: addDaysISO(todayISO(), -40), invoiceUrl: 'https://fake.asaas/i/old' };
    await webhook(harness, { id: 'evt_old', event: 'PAYMENT_OVERDUE', payment: stale });
    await setSubscription(user.id, { status: 'PAST_DUE', periodEndDaysFromNow: -40 });

    const agent = await loginAgent(harness.app, user);
    const status = await agent.get('/billing/status');
    expect(status.body.access.reason).toBe('EXPIRED');
    expect(status.body.openPayment).toBeNull();

    const checkout = await agent.post('/billing/checkout').send({ planCode: 'mensal', cpfCnpj: CPF_VALIDO });
    expect(checkout.body.checkoutUrl).toBe('https://fake.asaas/i/sub_fake_1');
    // A assinatura antiga é encerrada no Asaas para não gerar mais boletos.
    expect(harness.platformCalls.find((c) => c.method === 'cancelSubscription')!.args).toBe(subId);
  });

  it('estorno expira na hora; cancelamento mantém o acesso até o fim do período', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const cancel = await agent.post('/billing/cancel');
    expect(cancel.status).toBe(200);
    expect(harness.platformCalls.at(-1)).toMatchObject({ method: 'cancelSubscription' });
    expect((await agent.get('/clients')).status).toBe(200);

    await setSubscription(user.id, { status: 'CANCELED', periodEndDaysFromNow: -1 });
    expect((await agent.get('/clients')).status).toBe(402);

    const other = await createUser();
    const refund = await webhook(harness, {
      id: 'evt_ref',
      event: 'PAYMENT_REFUNDED',
      payment: { id: 'pay_ref', subscription: `sub_test_${other.id.slice(0, 8)}`, value: 49.9, dueDate: todayISO() }
    });
    expect(refund.body.result).toBe('expired');
    const otherAgent = await loginAgent(harness.app, other);
    expect((await otherAgent.get('/clients')).status).toBe(402);
  });

  it('trial vencido reabre o checkout com assinatura nova; trial vigente não perde acesso', async () => {
    const user = await createUser();
    await setSubscription(user.id, { status: 'TRIALING', periodEndDaysFromNow: null, trialDaysFromNow: 10 });
    const agent = await loginAgent(harness.app, user);

    const checkout = await agent.post('/billing/checkout').send({ planCode: 'anual', cpfCnpj: CPF_VALIDO });
    expect(checkout.status).toBe(201);
    // Primeira cobrança vence no fim do trial, não hoje.
    const created = harness.platformCalls.find((c) => c.method === 'createSubscription')!.args as {
      nextDueDate: string;
      cycle: string;
    };
    expect(created.cycle).toBe('YEARLY');
    expect(created.nextDueDate > todayISO()).toBe(true);
    // Continua TRIALING até pagar.
    expect((await agent.get('/auth/me')).body.subscription.status).toBe('TRIALING');
    expect((await agent.get('/clients')).status).toBe(200);
  });

  it('motor de cobrança não envia WhatsApp de conta bloqueada', async () => {
    const active = await createUser();
    const blocked = await createUser({ subscription: 'NONE' });
    for (const user of [active, blocked]) {
      const clientId = await createClient(user.id, { name: 'Cliente', phone: '5551999110001' });
      await createCharge({
        userId: user.id,
        clientId,
        description: 'Mensalidade',
        amountCents: 10000,
        dueDate: todayISO(),
        recurrence: 'NONE'
      });
    }

    const report = await runBillingCycle(harness.deps, todayISO());
    expect(report.notified).toBe(1);
    expect(report.blockedSkipped).toBe(1);
    expect(harness.sentMessages).toHaveLength(1);
  });
});
