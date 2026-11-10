import { Router } from 'express';
import type { PoolClient } from 'pg';
import { env } from '../../config/env';
import { withTransaction } from '../../db';
import { safeEqual } from '../../lib/crypto';
import { asyncHandler } from '../../lib/errors';
import {
  findSubscriptionForUpdate,
  type PaymentStatus,
  type SubscriptionWithPlan
} from '../../services/subscription/subscription.repo';

interface AsaasPayment {
  id: string;
  subscription?: string;
  value?: number;
  dueDate?: string;
  invoiceUrl?: string;
}

interface AsaasEvent {
  id?: string;
  event?: string;
  payment?: AsaasPayment;
  subscription?: { id?: string };
}

const PAID_EVENTS = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
const REVERSED_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE'
]);
const SUBSCRIPTION_ENDED_EVENTS = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

async function upsertPayment(
  tx: PoolClient,
  subscriptionId: string,
  payment: AsaasPayment,
  status: PaymentStatus | null
): Promise<void> {
  if (payment.value == null || !payment.dueDate) return;
  // status null = evento informativo (CREATED/UPDATED): não rebaixa um pagamento já confirmado.
  await tx.query(
    `INSERT INTO subscription_payments
       (subscription_id, gateway_payment_id, amount_cents, due_date, checkout_url, status, paid_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::text::platform_payment_status, 'PENDING'),
             CASE WHEN $6::text = 'CONFIRMED' THEN now() END)
     ON CONFLICT (gateway_payment_id) DO UPDATE
        SET amount_cents = EXCLUDED.amount_cents,
            due_date     = EXCLUDED.due_date,
            checkout_url = COALESCE(EXCLUDED.checkout_url, subscription_payments.checkout_url),
            status       = COALESCE($6::text::platform_payment_status, subscription_payments.status),
            paid_at      = CASE WHEN $6::text = 'CONFIRMED'
                                THEN COALESCE(subscription_payments.paid_at, now())
                                ELSE subscription_payments.paid_at END,
            updated_at   = now()`,
    [
      subscriptionId,
      payment.id,
      Math.round(payment.value * 100),
      payment.dueDate,
      payment.invoiceUrl ?? null,
      status
    ]
  );
}

/** Aplica o evento à assinatura. Devolve o que foi feito (para log e testes). */
async function applyEvent(
  tx: PoolClient,
  sub: SubscriptionWithPlan,
  event: string,
  payment: AsaasPayment | undefined
): Promise<string> {
  if (SUBSCRIPTION_ENDED_EVENTS.has(event)) {
    await tx.query(
      `UPDATE subscriptions
          SET status = 'CANCELED', canceled_at = COALESCE(canceled_at, now()), updated_at = now()
        WHERE id = $1 AND status <> 'EXPIRED'`,
      [sub.id]
    );
    return 'canceled';
  }
  if (!payment) return 'ignored';

  if (PAID_EVENTS.has(event)) {
    await upsertPayment(tx, sub.id, payment, 'CONFIRMED');
    // Cada pagamento cobre [vencimento, vencimento + ciclo]. GREATEST torna o
    // evento idempotente e indiferente à ordem (CONFIRMED e RECEIVED chegam
    // para o mesmo pagamento de cartão).
    await tx.query(
      `UPDATE subscriptions
          SET status = 'ACTIVE',
              canceled_at = NULL,
              current_period_end = GREATEST(
                COALESCE(current_period_end, '-infinity'::timestamptz),
                ($2::date + CASE WHEN $3 = 'YEARLY' THEN interval '1 year'
                                 ELSE interval '1 month' END)::timestamp AT TIME ZONE $4
              ),
              updated_at = now()
        WHERE id = $1`,
      [sub.id, payment.dueDate, sub.cycle, env.appTz]
    );
    return 'activated';
  }

  if (event === 'PAYMENT_OVERDUE') {
    await upsertPayment(tx, sub.id, payment, 'OVERDUE');
    // Só avisa: o bloqueio vem da data (fim do período + carência).
    await tx.query(
      `UPDATE subscriptions SET status = 'PAST_DUE', updated_at = now()
        WHERE id = $1 AND status = 'ACTIVE'`,
      [sub.id]
    );
    return 'past_due';
  }

  if (REVERSED_EVENTS.has(event)) {
    await upsertPayment(tx, sub.id, payment, 'REFUNDED');
    await tx.query(
      `UPDATE subscriptions SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [sub.id]
    );
    return 'expired';
  }

  if (event === 'PAYMENT_DELETED') {
    await upsertPayment(tx, sub.id, payment, 'FAILED');
    return 'payment_deleted';
  }

  if (event === 'PAYMENT_CREATED' || event === 'PAYMENT_UPDATED') {
    await upsertPayment(tx, sub.id, payment, null);
    return 'payment_saved';
  }

  return 'ignored';
}

/**
 * Webhook da conta Asaas da PLATAFORMA (passo 3 do fluxo: ativa a conta).
 * Configure no painel do Asaas da plataforma:
 *   URL:   https://api.cobrapramim.cloud/webhooks/platform/asaas
 *   Token: o mesmo valor de ASAAS_PLATFORM_WEBHOOK_TOKEN
 */
export default function platformWebhookRouter(): Router {
  const router = Router();

  router.post(
    '/asaas',
    asyncHandler(async (req, res) => {
      const expected = env.asaasPlatformWebhookToken;
      const provided = req.get('asaas-access-token') ?? '';
      if (!expected || !provided || !safeEqual(provided, expected)) {
        res.status(401).json({ error: 'Não autorizado' });
        return;
      }

      const body = (req.body ?? {}) as AsaasEvent;
      const event = body.event;
      const gatewaySubscriptionId = body.payment?.subscription ?? body.subscription?.id;
      if (!event || !gatewaySubscriptionId) {
        // Cobrança avulsa ou evento sem assinatura: não é da plataforma.
        res.json({ received: true, handled: false });
        return;
      }
      const eventId =
        body.id ?? `${event}:${body.payment?.id ?? gatewaySubscriptionId}`;

      const result = await withTransaction(async (tx) => {
        const sub = await findSubscriptionForUpdate(tx, { gatewaySubscriptionId });
        // Assinatura antiga (trocada no checkout) ou de outro sistema: ignora
        // sem gravar o evento.
        if (!sub) return 'unknown_subscription';

        const inserted = await tx.query(
          `INSERT INTO platform_webhook_events (id, type) VALUES ($1, $2)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [eventId, event]
        );
        if (inserted.rowCount === 0) return 'duplicate';

        return applyEvent(tx, sub, event, body.payment);
      });

      console.log(`[platform-webhook] ${event} ${gatewaySubscriptionId}: ${result}`);
      res.json({ received: true, result });
    })
  );

  return router;
}
