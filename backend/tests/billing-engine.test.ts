import { beforeEach, describe, expect, it } from 'vitest';
import { query, queryOne } from '../src/db';
import { addDaysISO, nextDueDate, todayISO } from '../src/lib/dates';
import { createCharge, type ChargeRow } from '../src/modules/charges/charges.repo';
import { runBillingCycle, notifyChargeNow } from '../src/services/billing-engine';
import {
  buildTestApp,
  createClient,
  createUser,
  truncateAll,
  type TestHarness
} from './helpers';

describe('motor de cobrança (ciclo diário)', () => {
  let harness: TestHarness;
  const today = todayISO();

  beforeEach(async () => {
    await truncateAll();
    harness = buildTestApp();
  });

  it('fatura recorrente vencendo hoje: gera Pix, envia WhatsApp e materializa o próximo ciclo', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, {
      name: 'João da Silva',
      phone: '5551999110001'
    });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'Mensalidade',
      amountCents: 15000,
      dueDate: today,
      recurrence: 'MONTHLY'
    });

    const report = await runBillingCycle(harness.deps, today);

    expect(report.notified).toBe(1);
    expect(report.generated).toBe(1);
    expect(report.notifyFailed).toBe(0);

    // Pix gerado via gateway fake e persistido na fatura.
    expect(harness.gatewayCalls).toHaveLength(1);
    expect(harness.gatewayCalls[0]!.externalReference).toBe(charge.id);
    const updated = await queryOne<ChargeRow>('SELECT * FROM charges WHERE id = $1', [
      charge.id
    ]);
    expect(updated!.gateway_charge_id).toBe('fake_pay_1');
    expect(updated!.pix_copy_paste).toContain('FAKEPIX');
    expect(updated!.last_notified_at).not.toBeNull();
    expect(updated!.next_generated).toBe(true);

    // Mensagem com nome, valor BRL, data BR e o copia-e-cola.
    expect(harness.sentMessages).toHaveLength(1);
    const { message, phone } = harness.sentMessages[0]!;
    expect(phone).toBe('5551999110001');
    expect(message).toContain('João da Silva');
    expect(message).toContain('150,00');
    expect(message).toContain('FAKEPIX');

    // Próximo ciclo: mesma série, vencimento calculado pela âncora.
    const next = await queryOne<ChargeRow>(
      `SELECT * FROM charges WHERE series_id = $1 AND id <> $2`,
      [charge.series_id, charge.id]
    );
    expect(next).not.toBeNull();
    expect(next!.due_date).toBe(nextDueDate(today, 'MONTHLY', charge.anchor_day));
    expect(next!.status).toBe('PENDING');
    expect(next!.amount_cents).toBe(15000);
  });

  it('marca como OVERDUE pendentes vencidas e as notifica se nunca foram avisadas', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, {
      name: 'Academia',
      phone: '5551988220004'
    });
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Equipamentos',
      amountCents: 120000,
      dueDate: addDaysISO(today, -2),
      recurrence: 'NONE'
    });

    const report = await runBillingCycle(harness.deps, today);

    expect(report.overdueMarked).toBe(1);
    expect(report.notified).toBe(1);
    const row = await queryOne<{ status: string; last_notified_at: string | null }>(
      `SELECT status, last_notified_at FROM charges WHERE user_id = $1`,
      [user.id]
    );
    expect(row!.status).toBe('OVERDUE');
    expect(row!.last_notified_at).not.toBeNull();
  });

  it('é idempotente: rodar o ciclo duas vezes no mesmo dia não reenvia nem duplica faturas', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'X', phone: '5551900000001' });
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Mensal',
      amountCents: 9900,
      dueDate: today,
      recurrence: 'MONTHLY'
    });

    await runBillingCycle(harness.deps, today);
    const second = await runBillingCycle(harness.deps, today);

    expect(second.notified).toBe(0);
    expect(second.generated).toBe(0);
    expect(harness.sentMessages).toHaveLength(1);
    const count = await queryOne<{ n: string }>(
      'SELECT COUNT(*) AS n FROM charges WHERE user_id = $1',
      [user.id]
    );
    expect(Number(count!.n)).toBe(2); // a de hoje + a do próximo mês
  });

  it('catch-up: série parada há 3 meses gera a cadeia inteira até o futuro em um ciclo', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'Y', phone: '5551900000002' });
    // Última fatura materializada venceu ~3 meses atrás (dia 15 para evitar
    // ambiguidades de fim de mês neste cenário).
    const { y, m } = (() => {
      const [yy, mm] = today.split('-').map(Number) as [number, number, number];
      const backM = mm - 3;
      return backM >= 1 ? { y: yy, m: backM } : { y: yy - 1, m: backM + 12 };
    })();
    const oldDue = `${y}-${String(m).padStart(2, '0')}-15`;
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Assinatura',
      amountCents: 5000,
      dueDate: oldDue,
      recurrence: 'MONTHLY'
    });

    const report = await runBillingCycle(harness.deps, today);

    const rows = await query<ChargeRow>(
      'SELECT * FROM charges WHERE user_id = $1 ORDER BY due_date',
      [user.id]
    );
    // Cadeia completa sem buracos e exatamente UMA fatura no futuro.
    expect(report.generated).toBe(rows.length - 1);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const future = rows.filter((r) => r.due_date > today);
    expect(future).toHaveLength(1);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.due_date).toBe(
        nextDueDate(rows[i - 1]!.due_date, 'MONTHLY', rows[i - 1]!.anchor_day)
      );
    }
  });

  it('falha transitória no WhatsApp: não marca como notificada e o ciclo seguinte reenvia', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'Z', phone: '5551900000003' });
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Serviço',
      amountCents: 4000,
      dueDate: today,
      recurrence: 'NONE'
    });

    harness.failNextSend();
    const first = await runBillingCycle(harness.deps, today);
    expect(first.notifyFailed).toBe(1);
    expect(first.notified).toBe(0);

    const failLog = await queryOne<{ success: boolean; error: string }>(
      `SELECT success, error FROM notification_logs WHERE user_id = $1`,
      [user.id]
    );
    expect(failLog!.success).toBe(false);
    expect(failLog!.error).toContain('instabilidade');

    // Amanhã (ou re-execução): a fatura virou OVERDUE sem notificação → reenvia.
    const retryDay = addDaysISO(today, 1);
    const second = await runBillingCycle(harness.deps, retryDay);
    expect(second.notified).toBe(1);
    expect(harness.sentMessages).toHaveLength(1);
  });

  it('respeita a data limite (recurrence_end_date): não gera ciclos após o prazo', async () => {
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'Limite', phone: '5551900000007' });
    await createCharge({
      userId: user.id,
      clientId,
      description: 'Mensalidade com fim',
      amountCents: 5000,
      dueDate: today,
      recurrence: 'MONTHLY',
      recurrenceEndDate: today // o próximo ciclo cairia depois do limite
    });

    const report = await runBillingCycle(harness.deps, today);

    expect(report.generated).toBe(0);
    const rows = await query<ChargeRow>('SELECT * FROM charges WHERE user_id = $1', [
      user.id
    ]);
    expect(rows).toHaveLength(1); // a série terminou: nada materializado
    expect(rows[0]!.next_generated).toBe(true);
  });

  it('usuário sem settings é pulado sem derrubar o ciclo dos demais', async () => {
    const semSettings = await createUser({ withSettings: false });
    const comSettings = await createUser();
    const c1 = await createClient(semSettings.id, { name: 'A', phone: '5551900000004' });
    const c2 = await createClient(comSettings.id, { name: 'B', phone: '5551900000005' });
    await createCharge({
      userId: semSettings.id,
      clientId: c1,
      description: 'F1',
      amountCents: 1000,
      dueDate: today,
      recurrence: 'NONE'
    });
    await createCharge({
      userId: comSettings.id,
      clientId: c2,
      description: 'F2',
      amountCents: 2000,
      dueDate: today,
      recurrence: 'NONE'
    });

    const report = await runBillingCycle(harness.deps, today);
    expect(report.usersSkipped).toBe(1);
    expect(report.notified).toBe(1);
    expect(harness.sentMessages[0]!.phone).toBe('5551900000005');
  });

  it('anti-spam: pausa (interSendDelay) só entre envios consecutivos do MESMO usuário/chip', async () => {
    const userA = await createUser();
    const userB = await createUser();
    const cA = await createClient(userA.id, { name: 'A', phone: '5551900000010' });
    const cB = await createClient(userB.id, { name: 'B', phone: '5551900000011' });
    // 3 faturas do usuário A + 2 do usuário B, todas vencendo hoje.
    for (const [userId, clientId, n] of [
      [userA.id, cA, 3],
      [userB.id, cB, 2]
    ] as const) {
      for (let i = 0; i < n; i++) {
        await createCharge({
          userId,
          clientId,
          description: `F${i}`,
          amountCents: 1000 + i,
          dueDate: today,
          recurrence: 'NONE'
        });
      }
    }

    let delays = 0;
    const deps = {
      ...harness.deps,
      interSendDelay: async () => {
        delays++;
      }
    };

    const report = await runBillingCycle(deps, today);

    expect(report.notified).toBe(5);
    // 2 pausas entre as 3 faturas de A + 1 entre as 2 de B; NENHUMA na troca
    // de usuário (chips diferentes).
    expect(delays).toBe(3);
  });

  it('sem WhatsApp configurado: fatura fica elegível (sem last_notified_at) e notifyChargeNow explica', async () => {
    const noWhats = buildTestApp({ withWhatsApp: false });
    const user = await createUser();
    const clientId = await createClient(user.id, { name: 'C', phone: '5551900000006' });
    const charge = await createCharge({
      userId: user.id,
      clientId,
      description: 'F',
      amountCents: 3000,
      dueDate: today,
      recurrence: 'NONE'
    });

    const report = await runBillingCycle(noWhats.deps, today);
    expect(report.notifyFailed).toBe(1);

    const row = await queryOne<{ last_notified_at: string | null }>(
      'SELECT last_notified_at FROM charges WHERE id = $1',
      [charge.id]
    );
    expect(row!.last_notified_at).toBeNull();

    const outcome = await notifyChargeNow(noWhats.deps, user.id, charge.id);
    expect(outcome.sent).toBe(false);
    expect(outcome.reason).toContain('WhatsApp');
  });
});
