import type {
  PaymentRow,
  PlanRow,
  SubscriptionWithPlan
} from '../../services/subscription/subscription.repo';

export function serializePlan(plan: PlanRow) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    priceCents: plan.price_cents,
    cycle: plan.cycle
  };
}

export function serializeSubscription(sub: SubscriptionWithPlan | null) {
  if (!sub) return null;
  return {
    status: sub.status,
    planCode: sub.plan_code,
    planName: sub.plan_name,
    priceCents: sub.price_cents,
    cycle: sub.cycle,
    currentPeriodEnd: sub.current_period_end?.toISOString() ?? null,
    trialEndsAt: sub.trial_ends_at?.toISOString() ?? null,
    canceledAt: sub.canceled_at?.toISOString() ?? null
  };
}

export function serializePayment(payment: PaymentRow | null) {
  if (!payment) return null;
  return {
    status: payment.status,
    amountCents: payment.amount_cents,
    dueDate: payment.due_date,
    checkoutUrl: payment.checkout_url
  };
}
