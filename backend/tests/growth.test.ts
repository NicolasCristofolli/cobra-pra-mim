import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { easterSunday, isBusinessDay, isNationalHoliday, isWeekend } from '../src/lib/business-days';
import { toCsv } from '../src/lib/csv';
import { addDaysISO, currentHour, todayISO } from '../src/lib/dates';
import { createCharge } from '../src/modules/charges/charges.repo';
import { runBillingCycle } from '../src/services/billing-engine';
import {
  previousMonth,
  runLifecycleEmails,
  sendMonthlyReports
} from '../src/services/lifecycle-emails';
import {
  buildTestApp,
  createClient,
  createUser,
  loginAgent,
  truncateAll,
  type TestHarness
} from './helpers';

// CPFs válidos (dígitos verificadores corretos) para os testes de importação.
const CPF_A = '03580256050';
const CPF_B = '52998224725';
const CPF_C = '11144477735';

async function chargeFor(
  userId: string,
  phone: string,
  dueDate: string,
  extra: { billingType?: 'PIX' | 'BOLETO' | 'UNDEFINED'; amountCents?: number } = {}
) {
  const clientId = await createClient(userId, { name: 'Cliente Novo', phone });
  const charge = await createCharge({
    userId,
    clientId,
    description: 'Mensalidade',
    amountCents: extra.amountCents ?? 12000,
    dueDate,
    recurrence: 'NONE',
    billingType: extra.billingType
  });
  return { clientId, charge };
}

/** Próximo sábado a partir de `from` (inclusive). */
function nextSaturday(from: string): string {
  let date = from;
  while (new Date(`${date}T12:00:00Z`).getUTCDay() !== 6) date = addDaysISO(date, 1);
  return date;
}

describe('horário de envio por conta e dias úteis', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('agendador: a conta só é atendida a partir da hora escolhida, e uma única vez no dia', async () => {
    const early = await createUser();
    const late = await createUser();
    await query('UPDATE settings SET send_hour = 10 WHERE user_id = $1', [late.id]);
    await chargeFor(early.id, '5551999330001', today);
    await chargeFor(late.id, '5551999330002', today);

    // 8h: só a conta das 8h (padrão).
    let report = await runBillingCycle(harness.deps, today, { hour: 8 });
    expect(report.notified).toBe(1);
    // 9h: ninguém (a das 8h já foi atendida, a das 10h ainda não chegou a hora).
    report = await runBillingCycle(harness.deps, today, { hour: 9 });
    expect(report.notified).toBe(0);
    // 10h: a conta das 10h.
    report = await runBillingCycle(harness.deps, today, { hour: 10 });
    expect(report.notified).toBe(1);
    expect(harness.sentMessages).toHaveLength(2);

    // Fatura criada depois de a conta ter sido atendida não dispara envio
    // automático no mesmo dia (sai no ciclo de amanhã, como sempre foi).
    await chargeFor(early.id, '5551999330003', today);
    report = await runBillingCycle(harness.deps, today, { hour: 11 });
    expect(report.notified).toBe(0);
    report = await runBillingCycle(harness.deps, addDaysISO(today, 1), { hour: 8 });
    expect(report.notified).toBe(1);

    const runs = await query<{ user_id: string }>(
      'SELECT user_id FROM engine_user_runs WHERE ran_on = $1::date',
      [today]
    );
    expect(runs.map((row) => row.user_id).sort()).toEqual([early.id, late.id].sort());
  });

  it('agendador: servidor fora do ar na hora da conta recupera na hora seguinte, mas nunca de madrugada', async () => {
    const user = await createUser();
    await chargeFor(user.id, '5551999330010', today);
    // 22h e 23h: fora da janela de envio.
    expect((await runBillingCycle(harness.deps, today, { hour: 22 })).notified).toBe(0);
    expect((await runBillingCycle(harness.deps, today, { hour: 23 })).notified).toBe(0);
    // 0h–5h do dia seguinte: a hora da conta (8h) ainda não chegou.
    const tomorrow = addDaysISO(today, 1);
    expect((await runBillingCycle(harness.deps, tomorrow, { hour: 3 })).notified).toBe(0);
    // 13h (perdeu as 8h): recupera.
    expect((await runBillingCycle(harness.deps, tomorrow, { hour: 13 })).notified).toBe(1);
  });

  it('agendador: WhatsApp desconectado não consome o dia; reconectou, a próxima hora envia', async () => {
    const user = await createUser();
    await query(`UPDATE settings SET whatsapp_provider = 'EVOLUTION' WHERE user_id = $1`, [user.id]);
    await chargeFor(user.id, '5551999330020', today);
    harness.setWhatsappConnected(false);
    let report = await runBillingCycle(harness.deps, today, { hour: 8 });
    expect(report.notified).toBe(0);
    expect(report.disconnectedSkipped).toBe(1);

    harness.setWhatsappConnected(true);
    report = await runBillingCycle(harness.deps, today, { hour: 9 });
    expect(report.notified).toBe(1);
  });

  it('sem hora (execução manual e testes antigos): atende todas as contas e não grava controle diário', async () => {
    const user = await createUser();
    await query('UPDATE settings SET send_hour = 20 WHERE user_id = $1', [user.id]);
    await chargeFor(user.id, '5551999330030', today);
    expect((await runBillingCycle(harness.deps, today)).notified).toBe(1);
    const runs = await queryOne<{ total: string }>('SELECT COUNT(*) AS total FROM engine_user_runs');
    expect(Number(runs!.total)).toBe(0);
  });

  it('conta que não envia em fim de semana: a cobrança de sábado sai na segunda', async () => {
    const user = await createUser();
    const other = await createUser();
    await query('UPDATE settings SET skip_non_business_days = TRUE WHERE user_id = $1', [user.id]);
    const saturday = nextSaturday(addDaysISO(today, 1));
    await chargeFor(user.id, '5551999330040', saturday);
    await chargeFor(other.id, '5551999330041', saturday);

    // Sábado: só a conta que envia todo dia.
    let report = await runBillingCycle(harness.deps, saturday);
    expect(report.notified).toBe(1);
    expect(report.calendarSkipped).toBe(1);
    // Domingo: nada.
    report = await runBillingCycle(harness.deps, addDaysISO(saturday, 1));
    expect(report.notified).toBe(0);
    // Segunda: sai a cobrança que ficou pendente (se segunda não for feriado).
    const monday = addDaysISO(saturday, 2);
    report = await runBillingCycle(harness.deps, monday);
    expect(report.notified).toBe(isNationalHoliday(monday) ? 0 : 1);
  });

  it('calendário: fins de semana, feriados fixos e Sexta-feira Santa', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(isNationalHoliday('2026-04-03')).toBe(true); // Sexta-feira Santa
    expect(isNationalHoliday('2026-12-25')).toBe(true);
    expect(isNationalHoliday('2026-11-20')).toBe(true);
    expect(isNationalHoliday('2026-11-19')).toBe(false);
    expect(isWeekend('2026-11-14')).toBe(true); // sábado
    expect(isWeekend('2026-11-16')).toBe(false); // segunda
    expect(isBusinessDay('2026-11-16')).toBe(true);
    expect(isBusinessDay('2026-11-15')).toBe(false); // domingo e feriado
    expect(isBusinessDay('2026-09-07')).toBe(false); // segunda, feriado
  });

  it('hora atual no fuso do app', () => {
    expect(currentHour('America/Sao_Paulo', new Date('2026-11-12T11:30:00Z'))).toBe(8);
    expect(currentHour('America/Sao_Paulo', new Date('2026-11-12T03:00:00Z'))).toBe(0);
    expect(currentHour('America/Sao_Paulo', new Date('2026-11-12T02:59:00Z'))).toBe(23);
  });

  it('configurações: horário de envio de 6h a 20h, dias úteis e resumo mensal', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const current = await agent.get('/settings');
    expect(current.body.sendHour).toBe(8);
    expect(current.body.skipNonBusinessDays).toBe(false);
    expect(current.body.monthlyReportEnabled).toBe(true);

    const saved = await agent
      .put('/settings')
      .send({ sendHour: 14, skipNonBusinessDays: true, monthlyReportEnabled: false });
    expect(saved.status).toBe(200);
    expect(saved.body.sendHour).toBe(14);
    expect(saved.body.skipNonBusinessDays).toBe(true);
    expect(saved.body.monthlyReportEnabled).toBe(false);
    // Salvar outra coisa não mexe no horário.
    const other = await agent.put('/settings').send({ dailyMessageLimit: 90 });
    expect(other.body.sendHour).toBe(14);

    expect((await agent.put('/settings').send({ sendHour: 3 })).status).toBe(400);
    expect((await agent.put('/settings').send({ sendHour: 22 })).status).toBe(400);
    expect((await agent.put('/settings').send({ sendHour: 9.5 })).status).toBe(400);
  });
});

describe('boleto e "cliente escolhe"', () => {
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
  });

  it('fatura em boleto: o gateway recebe BOLETO, a mensagem leva o link e a página pública mostra o botão de pagar', async () => {
    const harness = buildTestApp();
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Empresa Boleto', phone: '5551999440001' });

    const created = await agent.post('/charges').send({
      clientId,
      description: 'Serviço de novembro',
      amountCents: 35000,
      dueDate: today,
      billingType: 'BOLETO'
    });
    expect(created.status).toBe(201);
    expect(created.body.billingType).toBe('BOLETO');

    const report = await runBillingCycle(harness.deps, today);
    expect(report.notified).toBe(1);
    expect(harness.gatewayCalls[0]!.billingType).toBe('BOLETO');
    const message = harness.sentMessages[0]!.message;
    expect(message).toContain('Pague pelo link abaixo');
    expect(message).toContain('https://fake.gateway/inv/1');
    expect(message).not.toContain('copia e cola');

    const token = (created.body.publicUrl as string).split('/f/')[1]!;
    const page = await request(harness.app).get(`/public/charges/${token}`);
    expect(page.status).toBe(200);
    expect(page.body.billingType).toBe('BOLETO');
    expect(page.body.pixCopyPaste).toBeNull();
    expect(page.body.invoiceUrl).toBe('https://fake.gateway/inv/1');
  });

  it('fatura em Pix continua igual: copia e cola na mensagem e billingType PIX', async () => {
    const harness = buildTestApp();
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Cliente Pix', phone: '5551999440002' });
    const created = await agent
      .post('/charges')
      .send({ clientId, description: 'Mensalidade', amountCents: 9000, dueDate: today });
    expect(created.status).toBe(201);
    expect(created.body.billingType).toBe('PIX');
    await runBillingCycle(harness.deps, today);
    expect(harness.gatewayCalls[0]!.billingType).toBe('PIX');
    expect(harness.sentMessages[0]!.message).toContain('Pix copia e cola');
    expect(harness.sentMessages[0]!.message).toContain('00020126FAKEPIX1');
  });

  it('modelo personalizado é respeitado no boleto; série recorrente herda a forma de pagamento', async () => {
    const harness = buildTestApp();
    const user = await createUser();
    await query(`UPDATE settings SET message_template = 'Oi {nome_cliente}, pague: {link_pix}' WHERE user_id = $1`, [
      user.id
    ]);
    const clientId = await createClient(user.id, { name: 'Maria Série', phone: '5551999440003' });
    const first = await createCharge({
      userId: user.id,
      clientId,
      description: 'Plano',
      amountCents: 10000,
      dueDate: today,
      recurrence: 'WEEKLY',
      recurrenceEndDate: addDaysISO(today, 30),
      billingType: 'UNDEFINED'
    });
    const report = await runBillingCycle(harness.deps, today);
    expect(report.generated).toBe(1);
    expect(harness.sentMessages[0]!.message).toBe('Oi Maria Série, pague: https://fake.gateway/inv/1');
    const next = await queryOne<{ billing_type: string }>(
      'SELECT billing_type FROM charges WHERE series_id = $1 AND id <> $1',
      [first.id]
    );
    expect(next!.billing_type).toBe('UNDEFINED');
  });

  it('sem gateway que aceite boleto: criar fatura em boleto responde 400; valor inválido também', async () => {
    const harness = buildTestApp({ withGateway: false });
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    const clientId = await createClient(user.id, { name: 'Sem Gateway', phone: '5551999440004' });
    const base = { clientId, description: 'Teste', amountCents: 5000, dueDate: today };

    const boleto = await agent.post('/charges').send({ ...base, billingType: 'BOLETO' });
    expect(boleto.status).toBe(400);
    expect(boleto.body.code).toBe('BILLING_TYPE_UNAVAILABLE');
    expect((await agent.post('/charges').send({ ...base, billingType: 'CARTAO' })).status).toBe(400);
    // Pix segue liberado sem gateway.
    expect((await agent.post('/charges').send({ ...base, billingType: 'PIX' })).status).toBe(201);
  });
});

describe('importação de clientes e exportação de cobranças', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('importa as linhas válidas e devolve as recusadas com linha e motivo', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    await agent.post('/clients').send({ name: 'Já Cadastrada', phone: '51999550001', document: CPF_A });

    const response = await agent.post('/clients/import').send({
      rows: [
        { name: 'Ana Souza', phone: '(51) 99955-0002', email: 'ana@example.com', document: '529.982.247-25', notes: 'VIP' },
        { name: 'Duplicada', phone: '51999550001', document: CPF_C }, // telefone já existe
        { name: 'Sem Doc', phone: '51999550003', document: '' },
        { name: 'B', phone: '51999550004', document: CPF_C }, // nome curto
        { name: 'Carlos Lima', phone: '51999550005', email: '', document: CPF_C },
        { name: 'CPF Repetido', phone: '51999550006', document: CPF_B } // CPF da Ana
      ]
    });
    expect(response.status).toBe(200);
    expect(response.body.created).toBe(2);
    expect(response.body.rejected).toEqual([
      { line: 3, name: 'Duplicada', reason: 'Já existe um cliente com este telefone' },
      { line: 4, name: 'Sem Doc', reason: expect.stringContaining('CPF') },
      { line: 5, name: 'B', reason: 'Informe o nome do cliente' },
      { line: 7, name: 'CPF Repetido', reason: 'Já existe um cliente com este CPF/CNPJ' }
    ]);

    const list = await agent.get('/clients');
    const names = (list.body as Array<{ name: string }>).map((client) => client.name).sort();
    expect(names).toEqual(['Ana Souza', 'Carlos Lima', 'Já Cadastrada']);
    const ana = (list.body as Array<Record<string, unknown>>).find((client) => client.name === 'Ana Souza')!;
    expect(ana.phone).toBe('5551999550002');
    expect(ana.document).toBe(CPF_B);
    expect(ana.email).toBe('ana@example.com');
    expect(ana.notes).toBe('VIP');
  });

  it('importação: limites, corpo inválido e isolamento entre contas', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const agentA = await loginAgent(harness.app, userA);
    const agentB = await loginAgent(harness.app, userB);

    expect((await agentA.post('/clients/import').send({ rows: [] })).status).toBe(400);
    expect((await agentA.post('/clients/import').send({})).status).toBe(400);
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ name: `Cliente ${i}`, phone: '1', document: '1' }));
    expect((await agentA.post('/clients/import').send({ rows: tooMany })).status).toBe(400);
    expect((await request(harness.app).post('/clients/import').send({ rows: [] })).status).toBe(401);

    // O mesmo cliente entra nas duas contas, sem conflito.
    const row = { name: 'Compartilhado', phone: '51999550010', document: CPF_A };
    expect((await agentA.post('/clients/import').send({ rows: [row] })).body.created).toBe(1);
    expect((await agentB.post('/clients/import').send({ rows: [row] })).body.created).toBe(1);
    expect((await agentA.get('/clients')).body).toHaveLength(1);
  });

  it('exporta as cobranças do período em CSV (por vencimento e por pagamento), só da própria conta', async () => {
    const user = await createUser();
    const stranger = await createUser();
    const agent = await loginAgent(harness.app, user);

    const { charge: paid } = await chargeFor(user.id, '5551999550020', today, { amountCents: 12345 });
    await query(`UPDATE clients SET name = '=CMD("x")', document = $2 WHERE id = $1`, [paid.client_id, CPF_A]);
    await chargeFor(user.id, '5551999550021', addDaysISO(today, 5), { billingType: 'BOLETO' });
    await chargeFor(user.id, '5551999550022', addDaysISO(today, 60));
    await chargeFor(stranger.id, '5551999550023', today);
    expect((await agent.post(`/charges/${paid.id}/pay`)).status).toBe(200);

    const response = await agent.get(`/charges/export?from=${today}&to=${addDaysISO(today, 10)}`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    const text = response.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(3); // cabeçalho + 2 faturas do período
    expect(lines[0]).toBe(
      'Cliente;CPF/CNPJ;Telefone;Descrição;Valor;Vencimento;Situação;Pago em;Valor líquido;Forma de pagamento;Recorrência'
    );
    // Fórmula neutralizada, valor com vírgula, fatura paga com data de pagamento.
    expect(lines[1]).toContain(`"'=CMD(""x"")"`);
    expect(lines[1]).toContain(';035.802.560-50;(51) 99955-0020;');
    expect(lines[1]).toContain(';123,45;');
    expect(lines[1]).toContain(';Paga;');
    expect(lines[1]).toContain(';Pix;Avulsa');
    expect(lines[2]).toContain(';Em aberto;;;Boleto;Avulsa');

    // Por pagamento: só a paga.
    const byPaid = await agent.get(`/charges/export?from=${today}&to=${today}&by=paid`);
    expect(byPaid.text.slice(1).trim().split('\r\n')).toHaveLength(2);
    // Filtro de situação.
    const onlyOpen = await agent.get(
      `/charges/export?from=${today}&to=${addDaysISO(today, 90)}&status=PENDING`
    );
    expect(onlyOpen.text.slice(1).trim().split('\r\n')).toHaveLength(3);

    // Período inválido ou grande demais.
    expect((await agent.get(`/charges/export?from=${today}&to=${addDaysISO(today, -1)}`)).status).toBe(400);
    expect((await agent.get(`/charges/export?from=2020-01-01&to=2026-01-01`)).status).toBe(400);
    expect((await agent.get('/charges/export?from=2026-02-31&to=2026-03-01')).status).toBe(400);
    expect((await agent.get('/charges/export')).status).toBe(400);
    expect((await request(harness.app).get(`/charges/export?from=${today}&to=${today}`)).status).toBe(401);
  });

  it('CSV: separador, aspas, quebra de linha e fórmulas', () => {
    const csv = toCsv(['A', 'B'], [['x;y', 'diz "oi"'], ['+55 51', 'linha\nnova'], ['@soma', '-10']]);
    expect(csv).toBe('﻿A;B\r\n"x;y";"diz ""oi"""\r\n\'+55 51;"linha\nnova"\r\n\'@soma;\'-10\r\n');
  });
});

describe('primeiros passos, termos de uso e planos públicos', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('primeiros passos acompanham o estado real da conta e podem ser dispensados', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);

    let status = (await agent.get('/dashboard/onboarding')).body;
    expect(status).toEqual({
      steps: { whatsapp: false, gateway: false, client: false, charge: false, sent: false },
      done: 0,
      total: 5,
      completed: false,
      dismissed: false
    });

    await query(`UPDATE settings SET whatsapp_provider = 'EVOLUTION' WHERE user_id = $1`, [user.id]);
    await agent.put('/settings').send({ gatewayProvider: 'ASAAS', gatewayApiKey: '$aact_hmlg_teste' });
    const { charge } = await chargeFor(user.id, '5551999660001', today);
    status = (await agent.get('/dashboard/onboarding')).body;
    expect(status.steps).toEqual({ whatsapp: true, gateway: true, client: true, charge: true, sent: false });
    expect(status.done).toBe(4);

    expect((await agent.post(`/charges/${charge.id}/notify`)).status).toBe(200);
    status = (await agent.get('/dashboard/onboarding')).body;
    expect(status.completed).toBe(true);

    // WhatsApp caiu: o passo volta a ficar pendente.
    await query('UPDATE settings SET whatsapp_disconnected_at = now() WHERE user_id = $1', [user.id]);
    expect((await agent.get('/dashboard/onboarding')).body.steps.whatsapp).toBe(false);

    expect((await agent.post('/dashboard/onboarding/dismiss')).status).toBe(200);
    expect((await agent.get('/dashboard/onboarding')).body.dismissed).toBe(true);
  });

  it('cadastro grava o aceite dos termos; /me informa o papel', async () => {
    const accepted = await request(harness.app).post('/auth/register').send({
      name: 'Aceitou Termos',
      email: 'aceitou@example.com',
      password: 'senha-forte-123',
      acceptTerms: true
    });
    expect(accepted.status).toBe(201);
    const legacy = await request(harness.app).post('/auth/register').send({
      name: 'Tela Antiga',
      email: 'antiga@example.com',
      password: 'senha-forte-123'
    });
    expect(legacy.status).toBe(201);
    const rows = await query<{ email: string; accepted: boolean }>(
      'SELECT email, terms_accepted_at IS NOT NULL AS accepted FROM users ORDER BY email'
    );
    expect(rows).toEqual([
      { email: 'aceitou@example.com', accepted: true },
      { email: 'antiga@example.com', accepted: false }
    ]);
    // Campo de tipo errado ou desconhecido continua sendo recusado.
    const bad = await request(harness.app).post('/auth/register').send({
      name: 'Tipo Errado',
      email: 'errado@example.com',
      password: 'senha-forte-123',
      acceptTerms: 'sim'
    });
    expect(bad.status).toBe(400);

    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    expect((await agent.get('/auth/me')).body.role).toBe('USER');
  });

  it('planos públicos (página inicial): preços e dias de teste, sem login', async () => {
    const response = await request(harness.app).get('/public/plans');
    expect(response.status).toBe(200);
    expect(response.body.trialDays).toBe(7);
    expect(response.body.plans.map((plan: { code: string }) => plan.code)).toEqual(['mensal', 'anual']);
    expect(response.body.plans[0]).toEqual({
      code: 'mensal',
      name: 'Mensal',
      description: expect.any(String),
      priceCents: 4990,
      cycle: 'MONTHLY'
    });
  });
});

describe('painel do administrador', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  async function createAdmin() {
    const admin = await createUser({ subscription: 'NONE' });
    await query(`UPDATE users SET role = 'ADMIN' WHERE id = $1`, [admin.id]);
    return admin;
  }

  it('só administrador acessa; os demais recebem 404', async () => {
    const user = await createUser();
    const agent = await loginAgent(harness.app, user);
    expect((await agent.get('/admin/overview')).status).toBe(404);
    expect((await agent.post(`/admin/accounts/${user.id}/extend-trial`).send({ days: 7 })).status).toBe(404);
    expect((await request(harness.app).get('/admin/overview')).status).toBe(401);
  });

  it('visão geral: contas por situação, receita recorrente e alertas, sem dados dos clientes finais', async () => {
    const admin = await createAdmin();
    const paying = await createUser({ email: 'pagante@example.com' });
    const trial = await createUser({ email: 'teste@example.com', subscription: 'NONE' });
    const expired = await createUser({ email: 'expirado@example.com', subscription: 'NONE' });
    await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
       VALUES ($1, (SELECT id FROM plans WHERE code = 'mensal'), 'TRIALING', now() + interval '2 days'),
              ($2, (SELECT id FROM plans WHERE code = 'mensal'), 'TRIALING', now() - interval '1 day')`,
      [trial.id, expired.id]
    );
    await query('UPDATE settings SET whatsapp_disconnected_at = now() WHERE user_id = $1', [paying.id]);
    await createClient(paying.id, { name: 'Cliente Secreto', phone: '5551999770001' });

    const agent = await loginAgent(harness.app, admin);
    const response = await agent.get('/admin/overview');
    expect(response.status).toBe(200);
    expect(response.body.summary).toMatchObject({
      accounts: 3,
      paying: 1,
      trial: 1,
      blocked: 1,
      trialEndingSoon: 1,
      whatsappDisconnected: 1,
      mrrCents: 4990
    });
    const byEmail = Object.fromEntries(
      (response.body.accounts as Array<{ email: string }>).map((account) => [account.email, account])
    ) as Record<string, any>;
    expect(byEmail['pagante@example.com'].access.reason).toBe('OK');
    expect(byEmail['pagante@example.com'].clients).toBe(1);
    expect(byEmail['pagante@example.com'].whatsappDisconnected).toBe(true);
    expect(byEmail['teste@example.com'].access.reason).toBe('TRIAL');
    expect(byEmail['expirado@example.com'].access.state).toBe('BLOCKED');
    // Nada dos clientes finais nem segredos.
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('Cliente Secreto');
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('webhook');
  });

  it('estender teste: reativa conta com teste vencido; recusa conta pagante e valores fora do limite', async () => {
    const admin = await createAdmin();
    const expired = await createUser({ subscription: 'NONE' });
    const noPlan = await createUser({ subscription: 'NONE' });
    const paying = await createUser();
    await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
       VALUES ($1, (SELECT id FROM plans WHERE code = 'mensal'), 'TRIALING', now() - interval '5 days')`,
      [expired.id]
    );
    const agent = await loginAgent(harness.app, admin);
    const expiredAgent = await loginAgent(harness.app, expired);
    expect((await expiredAgent.get('/clients')).status).toBe(402);

    const extended = await agent.post(`/admin/accounts/${expired.id}/extend-trial`).send({ days: 7 });
    expect(extended.status).toBe(200);
    const days = (new Date(extended.body.trialEndsAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect((await expiredAgent.get('/clients')).status).toBe(200);

    // Conta sem assinatura nenhuma ganha um teste.
    expect((await agent.post(`/admin/accounts/${noPlan.id}/extend-trial`).send({ days: 3 })).status).toBe(200);
    const noPlanAgent = await loginAgent(harness.app, noPlan);
    expect((await noPlanAgent.get('/clients')).status).toBe(200);

    const refused = await agent.post(`/admin/accounts/${paying.id}/extend-trial`).send({ days: 7 });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NOT_IN_TRIAL');
    expect((await agent.post(`/admin/accounts/${admin.id}/extend-trial`).send({ days: 7 })).status).toBe(409);
    expect((await agent.post(`/admin/accounts/${expired.id}/extend-trial`).send({ days: 0 })).status).toBe(400);
    expect((await agent.post(`/admin/accounts/${expired.id}/extend-trial`).send({ days: 365 })).status).toBe(400);
    expect(
      (await agent.post('/admin/accounts/00000000-0000-4000-8000-000000000000/extend-trial').send({ days: 7 })).status
    ).toBe(404);
  });
});

describe('e-mails do ciclo de vida e resumo mensal', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  async function trialUser(email: string, endsIn: string, options: { verified?: boolean } = {}) {
    const user = await createUser({ email, subscription: 'NONE', emailVerified: options.verified });
    await query(
      `INSERT INTO subscriptions (user_id, plan_id, status, trial_ends_at)
       VALUES ($1, (SELECT id FROM plans WHERE code = 'mensal'), 'TRIALING', now() + $2::interval)`,
      [user.id, endsIn]
    );
    return user;
  }

  it('avisa uma única vez que o teste está acabando e que acabou', async () => {
    await trialUser('acabando@example.com', '36 hours');
    await trialUser('folgado@example.com', '5 days');
    await trialUser('acabou@example.com', '-1 day');
    await trialUser('antigo@example.com', '-10 days');
    await trialUser('naoconfirmou@example.com', '36 hours', { verified: false });
    await createUser({ email: 'pagante@example.com' });

    const first = await runLifecycleEmails(harness.deps);
    expect(first).toEqual({ trialEnding: 1, trialEnded: 1, paymentOverdue: 0, failed: 0 });
    const bySubject = Object.fromEntries(harness.sentEmails.map((mail) => [mail.to, mail]));
    expect(bySubject['acabando@example.com']!.subject).toContain('termina em breve');
    expect(bySubject['acabando@example.com']!.text).toContain('http://localhost:3000/planos');
    expect(bySubject['acabou@example.com']!.subject).toContain('terminou');
    expect(harness.sentEmails).toHaveLength(2);

    // Rodar de novo (o agendador roda de hora em hora) não repete.
    const second = await runLifecycleEmails(harness.deps);
    expect(second).toEqual({ trialEnding: 0, trialEnded: 0, paymentOverdue: 0, failed: 0 });
    expect(harness.sentEmails).toHaveLength(2);

    // O teste que estava acabando venceu: agora sai o aviso de encerramento.
    const later = await runLifecycleEmails(harness.deps, new Date(Date.now() + 40 * 3_600_000));
    expect(later.trialEnded).toBe(1);
    expect(harness.sentEmails[2]!.to).toBe('acabando@example.com');
  });

  it('quem já iniciou o pagamento não recebe o aviso de teste; falha no envio é tentada de novo', async () => {
    const checkout = await trialUser('nocheckout@example.com', '36 hours');
    await query(`UPDATE subscriptions SET gateway_subscription_id = 'sub_x' WHERE user_id = $1`, [checkout.id]);
    await trialUser('retry@example.com', '36 hours');

    harness.failNextEmail();
    const failed = await runLifecycleEmails(harness.deps);
    expect(failed).toEqual({ trialEnding: 0, trialEnded: 0, paymentOverdue: 0, failed: 1 });
    expect(harness.sentEmails).toHaveLength(0);

    const retried = await runLifecycleEmails(harness.deps);
    expect(retried.trialEnding).toBe(1);
    expect(harness.sentEmails.map((mail) => mail.to)).toEqual(['retry@example.com']);
  });

  it('mensalidade em atraso: um e-mail por cobrança vencida', async () => {
    const user = await createUser({ email: 'atrasado@example.com' });
    const sub = await queryOne<{ id: string }>(
      `UPDATE subscriptions SET status = 'PAST_DUE', current_period_end = now() - interval '1 day'
        WHERE user_id = $1 RETURNING id`,
      [user.id]
    );
    await query(
      `INSERT INTO subscription_payments (subscription_id, gateway_payment_id, amount_cents, status, due_date)
       VALUES ($1, 'pay_venc_1', 4990, 'OVERDUE', (now() - interval '1 day')::date)`,
      [sub!.id]
    );

    expect((await runLifecycleEmails(harness.deps)).paymentOverdue).toBe(1);
    expect(harness.sentEmails[0]!.to).toBe('atrasado@example.com');
    expect(harness.sentEmails[0]!.text).toContain('R$');
    expect(harness.sentEmails[0]!.text).toContain('49,90');
    expect((await runLifecycleEmails(harness.deps)).paymentOverdue).toBe(0);

    // Pagou: volta a ACTIVE e não há novo aviso.
    await query(`UPDATE subscriptions SET status = 'ACTIVE' WHERE id = $1`, [sub!.id]);
    await query(`UPDATE subscription_payments SET status = 'CONFIRMED' WHERE subscription_id = $1`, [sub!.id]);
    expect((await runLifecycleEmails(harness.deps)).paymentOverdue).toBe(0);
    expect(harness.sentEmails).toHaveLength(1);
  });

  it('mês anterior: limites e nome', () => {
    expect(previousMonth('2026-11-02')).toEqual({
      first: '2026-10-01',
      last: '2026-10-31',
      label: 'outubro de 2026',
      ref: '2026-10'
    });
    expect(previousMonth('2026-01-01')).toMatchObject({ first: '2025-12-01', last: '2025-12-31', ref: '2025-12' });
    expect(previousMonth('2024-03-03')).toMatchObject({ first: '2024-02-01', last: '2024-02-29' });
  });

  it('resumo mensal: sai no começo do mês, uma vez, só para contas com movimento e com o resumo ligado', async () => {
    const today = todayISO();
    const month = previousMonth(today);
    const reportDay = `${today.slice(0, 8)}02`;

    const active = await createUser({ email: 'movimento@example.com' });
    const quiet = await createUser({ email: 'parado@example.com' });
    const optedOut = await createUser({ email: 'desligou@example.com' });
    await query('UPDATE settings SET monthly_report_enabled = FALSE WHERE user_id = $1', [optedOut.id]);

    // Conta com movimento: 2 pagas no mês anterior (uma com taxa) e 1 em atraso.
    for (const [index, net] of [null, 9500].entries()) {
      const { charge } = await chargeFor(active.id, `555199988000${index}`, month.first, { amountCents: 10000 });
      await query(
        `UPDATE charges SET status = 'PAID', paid_at = ($2::date + interval '12 hours'), net_amount_cents = $3
          WHERE id = $1`,
        [charge.id, month.last, net]
      );
    }
    const { charge: late } = await chargeFor(active.id, '5551999880009', month.last, { amountCents: 7000 });
    await query(`UPDATE charges SET status = 'OVERDUE' WHERE id = $1`, [late.id]);
    // Conta que desligou o resumo também tem movimento.
    const { charge: other } = await chargeFor(optedOut.id, '5551999880010', month.first);
    await query(`UPDATE charges SET status = 'PAID', paid_at = $2::date + interval '12 hours' WHERE id = $1`, [
      other.id,
      month.first
    ]);
    void quiet;

    // Fora dos primeiros dias do mês: nada.
    expect(await sendMonthlyReports(harness.deps, `${today.slice(0, 8)}10`)).toEqual({ sent: 0, failed: 0 });

    expect(await sendMonthlyReports(harness.deps, reportDay)).toEqual({ sent: 1, failed: 0 });
    expect(harness.sentEmails).toHaveLength(1);
    const mail = harness.sentEmails[0]!;
    expect(mail.to).toBe('movimento@example.com');
    expect(mail.subject).toContain(month.label);
    expect(mail.text).toContain('R$');
    expect(mail.text).toContain('200,00');
    expect(mail.text).toContain('2 faturas');
    expect(mail.text).toContain('195,00');
    expect(mail.text).toContain('1 fatura em atraso');
    expect(mail.text).toContain('70,00');

    // No dia seguinte (ainda na janela) não repete.
    expect(await sendMonthlyReports(harness.deps, `${today.slice(0, 8)}03`)).toEqual({ sent: 0, failed: 0 });
    expect(harness.sentEmails).toHaveLength(1);
  });
});
