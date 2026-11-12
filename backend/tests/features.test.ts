import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { addDaysISO, todayISO } from '../src/lib/dates';
import { createCharge } from '../src/modules/charges/charges.repo';
import { runBillingCycle } from '../src/services/billing-engine';
import { deepHealth } from '../src/services/health';
import { recordEngineRun } from '../src/services/billing-engine';
import {
  buildTestApp,
  createClient,
  createUser,
  loginAgent,
  truncateAll,
  type TestHarness
} from './helpers';

describe('régua de cobrança, proteção do chip, opt-out, página pública e monitoramento', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    await query('TRUNCATE engine_runs');
    harness = buildTestApp();
  });

  async function chargeFor(userId: string, phone: string, dueDate: string) {
    const clientId = await createClient(userId, { name: 'Cliente Régua', phone });
    const charge = await createCharge({
      userId,
      clientId,
      description: 'Mensalidade',
      amountCents: 12000,
      dueDate,
      recurrence: 'NONE'
    });
    return { clientId, charge };
  }

  it('régua padrão: lembrete 3 dias antes, cobrança no dia, lembretes 3 e 7 dias depois — cada um uma única vez', async () => {
    const user = await createUser();
    const due = addDaysISO(today, 3);
    const { charge } = await chargeFor(user.id, '5551999220001', due);

    // D-3: lembrete (modelo de lembrete, com o link da fatura)
    let report = await runBillingCycle(harness.deps, today);
    expect(report.notified).toBe(1);
    expect(harness.sentMessages[0]!.message).toContain('Passando para lembrar');
    expect(harness.sentMessages[0]!.message).toMatch(/\/f\/[0-9a-f]{32}/);
    // Repetir o ciclo no mesmo dia não reenvia.
    report = await runBillingCycle(harness.deps, today);
    expect(report.notified).toBe(0);

    // D-2: nada
    expect((await runBillingCycle(harness.deps, addDaysISO(today, 1))).notified).toBe(0);

    // Dia do vencimento: cobrança principal
    report = await runBillingCycle(harness.deps, due);
    expect(report.notified).toBe(1);
    expect(harness.sentMessages[1]!.message).toContain('Sua fatura de');

    // D+1 e D+2: nada. D+3 e D+7: lembretes de atraso.
    expect((await runBillingCycle(harness.deps, addDaysISO(due, 1))).notified).toBe(0);
    expect((await runBillingCycle(harness.deps, addDaysISO(due, 3))).notified).toBe(1);
    expect(harness.sentMessages[2]!.message).toContain('Não identificamos o pagamento');
    expect((await runBillingCycle(harness.deps, addDaysISO(due, 3))).notified).toBe(0);
    expect((await runBillingCycle(harness.deps, addDaysISO(due, 7))).notified).toBe(1);
    expect(harness.sentMessages).toHaveLength(4);

    const kinds = await query<{ kind: string }>(
      'SELECT kind FROM notification_logs WHERE charge_id = $1 ORDER BY created_at',
      [charge.id]
    );
    expect(kinds.map((row) => row.kind)).toEqual([
      'REMINDER',
      'CHARGE',
      'OVERDUE_REMINDER',
      'OVERDUE_REMINDER'
    ]);
  });

  it('fatura paga não recebe lembrete de atraso; régua vazia desliga os lembretes', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const { charge } = await chargeFor(user.id, '5551999220002', today);
    await runBillingCycle(harness.deps, today);
    expect((await agent.post(`/charges/${charge.id}/pay`)).status).toBe(200);
    const sentAfterPay = harness.sentMessages.length;
    expect((await runBillingCycle(harness.deps, addDaysISO(today, 3))).notified).toBe(0);
    expect(harness.sentMessages).toHaveLength(sentAfterPay);

    // Usuário desliga a régua nas configurações.
    const saved = await agent
      .put('/settings')
      .send({ reminderDaysBefore: [], reminderDaysAfter: [], dailyMessageLimit: 80 });
    expect(saved.status).toBe(200);
    expect(saved.body.reminderDaysBefore).toEqual([]);
    expect(saved.body.dailyMessageLimit).toBe(80);
    await chargeFor(user.id, '5551999220003', addDaysISO(today, 3));
    expect((await runBillingCycle(harness.deps, today)).notified).toBe(0);

    // Régua inválida é recusada.
    expect((await agent.put('/settings').send({ reminderDaysBefore: [0] })).status).toBe(400);
    expect((await agent.put('/settings').send({ dailyMessageLimit: 5000 })).status).toBe(400);
  });

  it('limite diário do chip: para de enviar ao atingir o teto e o restante sai no dia seguinte', async () => {
    const user = await createUser();
    await query('UPDATE settings SET daily_message_limit = 2 WHERE user_id = $1', [user.id]);
    for (let i = 0; i < 4; i++) await chargeFor(user.id, `555199922010${i}`, today);

    const first = await runBillingCycle(harness.deps, today);
    expect(first.notified).toBe(2);
    expect(first.limitSkipped).toBe(2);

    // No dia seguinte as duas que sobraram (agora atrasadas, nunca notificadas) saem.
    // (Os envios de "hoje" ficam registrados com a data real; o ciclo de amanhã conta do zero.)
    const next = await runBillingCycle(harness.deps, addDaysISO(today, 1));
    expect(next.notified).toBe(2);
    expect(harness.sentMessages).toHaveLength(4);
  });

  it('cliente que pediu para não receber mensagens: motor pula e o envio manual é recusado', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const created = await agent.post('/clients').send({
      name: 'Sem Mensagens',
      phone: '51999220200',
      document: '03580256050',
      whatsappOptOut: true
    });
    expect(created.status).toBe(201);
    expect(created.body.whatsappOptOut).toBe(true);
    const charge = await createCharge({
      userId: user.id,
      clientId: created.body.id,
      description: 'Plano',
      amountCents: 5000,
      dueDate: today,
      recurrence: 'NONE'
    });

    expect((await runBillingCycle(harness.deps, today)).notified).toBe(0);
    const manual = await agent.post(`/charges/${charge.id}/notify`);
    expect(manual.status).toBe(422);
    expect(manual.body.error).toContain('não receber mensagens');
    expect(harness.sentMessages).toHaveLength(0);

    // Voltou a aceitar: o motor envia.
    const updated = await agent.put(`/clients/${created.body.id}`).send({
      name: 'Sem Mensagens',
      phone: '51999220200',
      document: '03580256050',
      whatsappOptOut: false
    });
    expect(updated.body.whatsappOptOut).toBe(false);
    expect((await runBillingCycle(harness.deps, today)).notified).toBe(1);
  });

  it('WhatsApp desconectado: não envia, avisa o dono por e-mail uma vez e mostra o alerta no painel', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    await query(`UPDATE settings SET whatsapp_provider = 'EVOLUTION' WHERE user_id = $1`, [user.id]);
    await chargeFor(user.id, '5551999220300', today);
    harness.setWhatsappConnected(false);

    const report = await runBillingCycle(harness.deps, today);
    expect(report.notified).toBe(0);
    expect(report.disconnectedSkipped).toBe(1);
    expect(harness.sentMessages).toHaveLength(0);
    expect(harness.sentEmails).toHaveLength(1);
    expect(harness.sentEmails[0]!.to).toBe(user.email);
    expect(harness.sentEmails[0]!.subject).toContain('WhatsApp desconectou');
    expect((await agent.get('/dashboard/metrics')).body.whatsappDisconnected).toBe(true);

    // Segundo ciclo ainda desconectado: não manda outro e-mail.
    await runBillingCycle(harness.deps, today);
    expect(harness.sentEmails).toHaveLength(1);

    // Reconectou: o alerta some e a cobrança pendente sai.
    harness.setWhatsappConnected(true);
    const after = await runBillingCycle(harness.deps, today);
    expect(after.notified).toBe(1);
    expect((await agent.get('/dashboard/metrics')).body.whatsappDisconnected).toBe(false);
  });

  it('salvar a chave do Asaas cadastra o webhook automaticamente (URL e token do usuário)', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    const saved = await agent
      .put('/settings')
      .send({ gatewayProvider: 'ASAAS', gatewayApiKey: '$aact_hmlg_chave_de_teste' });
    expect(saved.status).toBe(200);
    expect(saved.body.webhookAutoConfig).toEqual({ status: 'configured' });
    expect(harness.webhookRegistrations).toHaveLength(1);
    expect(harness.webhookRegistrations[0]).toMatchObject({
      url: `http://localhost:4000/webhooks/payments/${user.id}`,
      authToken: user.webhookSecret,
      email: user.email
    });

    // Salvar só os modelos não mexe no gateway.
    const templates = await agent.put('/settings').send({ messageTemplate: 'Olá {nome_cliente}' });
    expect(templates.body.webhookAutoConfig).toBeNull();
    expect(harness.webhookRegistrations).toHaveLength(1);

    // Rotacionar o segredo atualiza o webhook com o token novo.
    const rotated = await agent.post('/settings/webhook-secret/rotate');
    expect(rotated.body.webhookAutoConfig).toEqual({ status: 'configured' });
    expect(harness.webhookRegistrations[1]!.authToken).toBe(rotated.body.webhookSecret);
    expect(rotated.body.webhookSecret).not.toBe(user.webhookSecret);
  });

  it('página pública da fatura: mostra o Pix sem login e sem dados pessoais; some o Pix depois de paga', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const { charge } = await chargeFor(user.id, '5551999220400', addDaysISO(today, 2));
    expect((await agent.post(`/charges/${charge.id}/notify`)).status).toBe(200);
    const row = await queryOne<{ public_token: string }>(
      'SELECT public_token FROM charges WHERE id = $1',
      [charge.id]
    );
    const token = row!.public_token;
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    const listed = await agent.get('/charges');
    expect(listed.body.items[0].publicUrl).toBe(`http://localhost:3000/f/${token}`);

    const open = await request(harness.app).get(`/public/charges/${token}`);
    expect(open.status).toBe(200);
    expect(open.body).toMatchObject({
      sellerName: 'Usuário Teste',
      clientFirstName: 'Cliente',
      description: 'Mensalidade',
      amountCents: 12000,
      status: 'PENDING'
    });
    expect(open.body.pixCopyPaste).toContain('FAKEPIX');
    expect(JSON.stringify(open.body)).not.toContain('5551999220400');
    expect(open.body.id).toBeUndefined();

    expect((await agent.post(`/charges/${charge.id}/pay`)).status).toBe(200);
    const paid = await request(harness.app).get(`/public/charges/${token}`);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.pixCopyPaste).toBeNull();

    expect((await request(harness.app).get(`/public/charges/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await request(harness.app).get('/public/charges/abc')).status).toBe(404);
  });

  it('cadastro novo entra em teste grátis de 7 dias (após confirmar o e-mail)', async () => {
    const agent = request.agent(harness.app);
    const registered = await agent
      .post('/auth/register')
      .send({ name: 'Nova Conta', email: 'nova@example.com', password: 'senha-forte-123' });
    expect(registered.status).toBe(201);
    await query(`UPDATE users SET email_verified_at = now() WHERE email = 'nova@example.com'`);

    const me = await agent.get('/auth/me');
    expect(me.body.access).toMatchObject({ state: 'FULL', reason: 'TRIAL' });
    const days =
      (new Date(me.body.access.blocksAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    expect((await agent.get('/clients')).status).toBe(200);

    // Trial vencido: bloqueia e pede o plano.
    await query(
      `UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour'
        WHERE user_id = (SELECT id FROM users WHERE email = 'nova@example.com')`
    );
    expect((await agent.get('/clients')).status).toBe(402);
  });

  it('health profundo: ok sem execuções, 503 quando o último ciclo falhou ou está parado há mais de 26h', async () => {
    expect((await request(harness.app).get('/health/deep')).status).toBe(200);

    const report = await runBillingCycle(harness.deps, today);
    await recordEngineRun(today, { ok: true, report });
    const healthy = await request(harness.app).get('/health/deep');
    expect(healthy.status).toBe(200);
    expect(healthy.body.lastCycle.ok).toBe(true);

    await recordEngineRun(today, { ok: false, error: 'falha simulada' });
    const failed = await request(harness.app).get('/health/deep');
    expect(failed.status).toBe(503);
    expect(failed.body.problems[0]).toContain('falhou');

    // Ciclo antigo e sem erro: "parado" só conta com o cron ligado (em teste ele fica desligado).
    await query('TRUNCATE engine_runs');
    await query(
      `INSERT INTO engine_runs (ran_on, ok, finished_at) VALUES ($1, true, now() - interval '30 hours')`,
      [today]
    );
    process.env.DISABLE_CRON = 'false';
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const stale = await deepHealth();
      expect(stale.ok).toBe(false);
      expect(stale.problems[0]).toContain('26h');
    } finally {
      process.env.DISABLE_CRON = 'true';
      process.env.NODE_ENV = previousEnv;
    }
  });
});
