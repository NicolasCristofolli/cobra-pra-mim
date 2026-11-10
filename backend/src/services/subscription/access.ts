/**
 * Regra ÚNICA de acesso à plataforma. O status gravado é a referência, mas a
 * decisão é sempre recalculada pela data: se o cron ou um webhook falhar,
 * ninguém fica liberado (ou bloqueado) indevidamente.
 */

export type SubscriptionStatus =
  | 'PENDING_PAYMENT'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'EXPIRED'
  | 'CANCELED';

export type AccessState = 'FULL' | 'WARNING' | 'BLOCKED';
export type AccessReason = 'OK' | 'TRIAL' | 'PAST_DUE' | 'NO_PLAN' | 'PENDING_PAYMENT' | 'EXPIRED';

export interface Access {
  state: AccessState;
  reason: AccessReason;
  /** Quando o acesso atual termina (fim do trial, do período ou da carência). */
  blocksAt: string | null;
}

export interface SubscriptionForAccess {
  status: SubscriptionStatus;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  grace_days: number;
}

const DAY_MS = 86_400_000;

export function resolveAccess(
  sub: SubscriptionForAccess | null,
  now: Date = new Date()
): Access {
  const blocked = (reason: AccessReason): Access => ({ state: 'BLOCKED', reason, blocksAt: null });

  if (!sub) return blocked('NO_PLAN');
  if (sub.status === 'PENDING_PAYMENT') return blocked('PENDING_PAYMENT');
  if (sub.status === 'EXPIRED') return blocked('EXPIRED');

  if (sub.status === 'TRIALING') {
    // Trial vencido e nenhum pagamento: volta a pedir o plano.
    return sub.trial_ends_at && now <= sub.trial_ends_at
      ? { state: 'FULL', reason: 'TRIAL', blocksAt: sub.trial_ends_at.toISOString() }
      : blocked('EXPIRED');
  }

  // ACTIVE, PAST_DUE e CANCELED dependem do fim do período já pago.
  const end = sub.current_period_end;
  if (!end) return blocked('PENDING_PAYMENT');
  if (now <= end) return { state: 'FULL', reason: 'OK', blocksAt: end.toISOString() };

  // Cancelou: sem carência, o acesso acaba junto com o período pago.
  if (sub.status === 'CANCELED') return blocked('EXPIRED');

  const graceEnd = new Date(end.getTime() + sub.grace_days * DAY_MS);
  return now <= graceEnd
    ? { state: 'WARNING', reason: 'PAST_DUE', blocksAt: graceEnd.toISOString() }
    : blocked('EXPIRED');
}
