import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../db';
import { env } from '../../config/env';
import {
  addDaysISO,
  nextDueDate,
  projectOccurrences,
  todayISO,
  type RecurrenceKind
} from '../../lib/dates';
import { asyncHandler } from '../../lib/errors';
import { subscribe, unsubscribe } from '../../lib/events';
import { serializeCharge, type ChargeRow } from '../charges/charges.repo';

const router = Router();

/** Fator de normalização mensal por tipo de recorrência (MRR). */
const MONTHLY_FACTOR: Record<Exclude<RecurrenceKind, 'NONE'>, number> = {
  WEEKLY: 52 / 12,
  MONTHLY: 1,
  YEARLY: 1 / 12
};

router.get(
  '/metrics',
  asyncHandler(async (req, res) => {
    const today = todayISO();
    const horizon = addDaysISO(today, 30);

    // Uma única passada na tabela resolve todos os agregados escalares.
    const totals = await queryOne<{
      total_billed: string;
      total_received: string;
      net_profit: string;
      active_count: string;
      active_amount: string;
      matured_count: string;
      matured_unpaid: string;
      paid_count: string;
      open_count: string;
    }>(
      `SELECT
         COALESCE(SUM(amount_cents) FILTER (WHERE status <> 'CANCELED'), 0)::bigint AS total_billed,
         COALESCE(SUM(amount_cents) FILTER (WHERE status = 'PAID'), 0)::bigint      AS total_received,
         COALESCE(SUM(COALESCE(net_amount_cents, amount_cents))
                  FILTER (WHERE status = 'PAID'), 0)::bigint                        AS net_profit,
         COUNT(*) FILTER (WHERE status IN ('PENDING', 'SENT', 'OVERDUE'))                   AS active_count,
         COALESCE(SUM(amount_cents)
                  FILTER (WHERE status IN ('PENDING', 'SENT', 'OVERDUE')), 0)::bigint       AS active_amount,
         COUNT(*) FILTER (WHERE status IN ('PAID', 'OVERDUE'))            AS matured_count,
         COUNT(*) FILTER (WHERE status = 'OVERDUE')                      AS matured_unpaid,
         COUNT(*) FILTER (WHERE status = 'PAID')                         AS paid_count,
         COUNT(*) FILTER (WHERE status IN ('PENDING', 'SENT'))           AS open_count
       FROM charges
       WHERE user_id = $1`,
      [req.userId]
    );

    // Totais de clientes para o painel (evita baixar a lista inteira só para contar).
    const clientTotals = await queryOne<{ total: string; overdue: string }>(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM charges ch
                 WHERE ch.client_id = c.id AND ch.status = 'OVERDUE'
              )) AS overdue
         FROM clients c
        WHERE c.user_id = $1 AND c.deleted_at IS NULL`,
      [req.userId]
    );

    // MRR: última fatura de cada série recorrente. Ficam de fora as séries
    // encerradas: última fatura cancelada, cliente excluído ou data limite
    // (recurrence_end_date) já atingida.
    const latestOfSeries = await query<{
      recurrence: RecurrenceKind;
      amount_cents: number;
      anchor_day: number | null;
      due_date: string;
      recurrence_end_date: string | null;
    }>(
      `SELECT recurrence, amount_cents, anchor_day, due_date, recurrence_end_date
         FROM (
           SELECT DISTINCT ON (series_id)
                  recurrence, amount_cents, anchor_day, due_date, status,
                  recurrence_end_date, client_id
             FROM charges
            WHERE user_id = $1 AND recurrence <> 'NONE'
            ORDER BY series_id, due_date DESC
         ) latest
        WHERE status <> 'CANCELED'
          AND EXISTS (
                SELECT 1 FROM clients cl
                 WHERE cl.id = latest.client_id AND cl.deleted_at IS NULL
              )`,
      [req.userId]
    );
    const seriesHeads = latestOfSeries.filter(
      (head) =>
        !head.recurrence_end_date ||
        nextDueDate(head.due_date, head.recurrence, head.anchor_day) <= head.recurrence_end_date
    );

    const mrrCents = Math.round(
      seriesHeads.reduce((sum, head) => {
        const factor = MONTHLY_FACTOR[head.recurrence as Exclude<RecurrenceKind, 'NONE'>] ?? 0;
        return sum + head.amount_cents * factor;
      }, 0)
    );

    // Projeção 30 dias = faturas em aberto já materializadas na janela
    // + ocorrências futuras (ainda não materializadas) das séries ativas.
    const openInWindow = await queryOne<{ amount: string }>(
      `SELECT COALESCE(SUM(amount_cents), 0)::bigint AS amount
         FROM charges
        WHERE user_id = $1
          AND status IN ('PENDING', 'SENT', 'OVERDUE')
          AND due_date >= $2::date AND due_date <= $3::date`,
      [req.userId, today, horizon]
    );

    let projectedRecurringCents = 0;
    for (const head of seriesHeads) {
      const occurrences = projectOccurrences(
        head.due_date,
        head.recurrence,
        head.anchor_day,
        addDaysISO(today, -1),
        // A série não gera ciclos depois da data limite.
        head.recurrence_end_date && head.recurrence_end_date < horizon
          ? head.recurrence_end_date
          : horizon
      );
      projectedRecurringCents += occurrences.length * head.amount_cents;
    }

    const maturedCount = Number(totals?.matured_count ?? 0);
    const maturedUnpaid = Number(totals?.matured_unpaid ?? 0);

    res.json({
      totalBilledCents: Number(totals?.total_billed ?? 0),
      totalReceivedCents: Number(totals?.total_received ?? 0),
      netProfitCents: Number(totals?.net_profit ?? 0),
      activeChargesCount: Number(totals?.active_count ?? 0),
      activeChargesAmountCents: Number(totals?.active_amount ?? 0),
      // Inadimplência: vencidas ÷ (pagas + vencidas). Faturas ainda não vencidas
      // (PENDING/SENT com due_date futuro) ficam de fora do cálculo — não são
      // inadimplência, ainda não chegou a hora de pagar.
      defaultRatePercent:
        maturedCount === 0 ? 0 : Number(((maturedUnpaid / maturedCount) * 100).toFixed(1)),
      maturedCount,
      maturedUnpaid,
      // Contagens para o gráfico de status. "Em aberto" = PENDING + SENT
      // (fatura enviada e ainda não vencida continua em aberto).
      statusCounts: {
        paid: Number(totals?.paid_count ?? 0),
        open: Number(totals?.open_count ?? 0),
        overdue: maturedUnpaid
      },
      clientsTotal: Number(clientTotals?.total ?? 0),
      clientsOverdue: Number(clientTotals?.overdue ?? 0),
      mrrCents,
      projection30dCents: Number(openInWindow?.amount ?? 0) + projectedRecurringCents
    });
  })
);

const cashflowSchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(14)
});

router.get(
  '/cashflow',
  asyncHandler(async (req, res) => {
    const { days } = cashflowSchema.parse(req.query);
    const today = todayISO();

    const rows = await query<{ day: string; received: string; pending: string }>(
      `SELECT gs::date AS day,
              COALESCE(SUM(c.amount_cents) FILTER (
                WHERE c.status = 'PAID'
                  AND (c.paid_at AT TIME ZONE $4)::date = gs::date
              ), 0)::bigint AS received,
              COALESCE(SUM(c.amount_cents) FILTER (
                WHERE c.status IN ('PENDING', 'SENT', 'OVERDUE')
                  AND c.due_date = gs::date
              ), 0)::bigint AS pending
         FROM generate_series(
                $2::date - ($3::int - 1) * INTERVAL '1 day',
                $2::date,
                INTERVAL '1 day'
              ) AS gs
         LEFT JOIN charges c
           ON c.user_id = $1
          AND (
                (c.status = 'PAID' AND (c.paid_at AT TIME ZONE $4)::date = gs::date)
             OR (c.status IN ('PENDING', 'SENT', 'OVERDUE') AND c.due_date = gs::date)
              )
        GROUP BY gs::date
        ORDER BY gs::date`,
      [req.userId, today, days, env.appTz]
    );

    res.json(
      rows.map((row) => ({
        day: row.day,
        receivedCents: Number(row.received),
        pendingCents: Number(row.pending)
      }))
    );
  })
);

router.get(
  '/due-today',
  asyncHandler(async (req, res) => {
    const today = todayISO();
    const rows = await query<ChargeRow>(
      `SELECT ch.*, cl.name AS client_name, cl.phone AS client_phone
         FROM charges ch
         JOIN clients cl ON cl.id = ch.client_id
        WHERE ch.user_id = $1
          AND ch.due_date = $2::date
          AND ch.status IN ('PENDING', 'SENT', 'OVERDUE')
        ORDER BY cl.name`,
      [req.userId, today]
    );
    res.json(rows.map(serializeCharge));
  })
);

/** Server-Sent Events: o webhook publica "payment" e o dashboard recarrega. */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  subscribe(req.userId, res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(req.userId, res);
  });
});

export default router;
