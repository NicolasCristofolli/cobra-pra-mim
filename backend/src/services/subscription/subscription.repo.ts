import type { PoolClient } from 'pg';
import { query, queryOne } from '../../db';
import { resolveAccess, type Access, type SubscriptionStatus } from './access';

/** Pool (padrão) ou o cliente de uma transação aberta: dentro de withTransaction, passe o `tx`. */
type Db = Pick<PoolClient, 'query'>;

export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'FAILED';

export interface PlanRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  cycle: BillingCycle;
  grace_days: number;
  active: boolean;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  canceled_at: Date | null;
  gateway_customer_id: string | null;
  gateway_subscription_id: string | null;
}

export type SubscriptionWithPlan = SubscriptionRow & {
  plan_code: string;
  plan_name: string;
  price_cents: number;
  cycle: BillingCycle;
  grace_days: number;
};

export interface PaymentRow {
  id: string;
  gateway_payment_id: string;
  amount_cents: number;
  status: PaymentStatus;
  due_date: string;
  paid_at: Date | null;
  checkout_url: string | null;
}

const WITH_PLAN = `
  SELECT s.*, p.code AS plan_code, p.name AS plan_name, p.price_cents,
         p.cycle, p.grace_days
    FROM subscriptions s
    JOIN plans p ON p.id = s.plan_id`;

export function listActivePlans(): Promise<PlanRow[]> {
  return query<PlanRow>('SELECT * FROM plans WHERE active ORDER BY sort_order, price_cents');
}

export function findActivePlanByCode(code: string): Promise<PlanRow | null> {
  return queryOne<PlanRow>('SELECT * FROM plans WHERE code = $1 AND active', [code]);
}

export async function findSubscriptionByUser(
  userId: string,
  db?: Db
): Promise<SubscriptionWithPlan | null> {
  const sql = `${WITH_PLAN} WHERE s.user_id = $1`;
  if (db) return (await db.query<SubscriptionWithPlan>(sql, [userId])).rows[0] ?? null;
  return queryOne<SubscriptionWithPlan>(sql, [userId]);
}

/**
 * Acesso do usuário: considera o papel (admin) e a assinatura. UMA consulta
 * só — roda em toda requisição autenticada (loadAccess).
 */
export async function findAccessByUser(userId: string): Promise<Access> {
  const row = await queryOne<{
    role: string;
    status: SubscriptionStatus | null;
    current_period_end: Date | null;
    trial_ends_at: Date | null;
    grace_days: number | null;
  }>(
    `SELECT u.role, s.status, s.current_period_end, s.trial_ends_at, p.grace_days
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       LEFT JOIN plans p ON p.id = s.plan_id
      WHERE u.id = $1`,
    [userId]
  );
  const sub =
    row?.status != null
      ? {
          status: row.status,
          current_period_end: row.current_period_end,
          trial_ends_at: row.trial_ends_at,
          grace_days: row.grace_days ?? 0
        }
      : null;
  return resolveAccess(sub, new Date(), { admin: row?.role === 'ADMIN' });
}

/**
 * Cobrança em aberto que ainda vale a pena pagar: a mais recente cujo período
 * (vencimento + ciclo) não acabou. Pagar um boleto mais antigo que isso
 * deixaria o período pago no passado e a conta continuaria bloqueada. Nesse
 * caso o checkout cria uma assinatura nova.
 */
export async function findOpenPayment(
  subscriptionId: string,
  db?: Db
): Promise<PaymentRow | null> {
  const sql = `SELECT sp.* FROM subscription_payments sp
       JOIN subscriptions s ON s.id = sp.subscription_id
       JOIN plans p ON p.id = s.plan_id
      WHERE sp.subscription_id = $1
        AND sp.status IN ('PENDING', 'OVERDUE')
        AND sp.checkout_url IS NOT NULL
        AND sp.due_date + CASE WHEN p.cycle = 'YEARLY' THEN interval '1 year'
                               ELSE interval '1 month' END > now()
      ORDER BY sp.due_date DESC LIMIT 1`;
  if (db) return (await db.query<PaymentRow>(sql, [subscriptionId])).rows[0] ?? null;
  return queryOne<PaymentRow>(sql, [subscriptionId]);
}

export async function findSubscriptionForUpdate(
  tx: PoolClient,
  where: { gatewaySubscriptionId: string }
): Promise<SubscriptionWithPlan | null> {
  const result = await tx.query<SubscriptionWithPlan>(
    `${WITH_PLAN} WHERE s.gateway_subscription_id = $1 FOR UPDATE OF s`,
    [where.gatewaySubscriptionId]
  );
  return result.rows[0] ?? null;
}
