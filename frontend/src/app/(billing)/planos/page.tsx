'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, CreditCard, Lock } from 'lucide-react';
import { CheckoutSteps } from '@/components/checkout-steps';
import { Badge, Button, Card, ConfirmDialog, Field, Input, Spinner, cx } from '@/components/ui';
import { useToast } from '@/components/toast';
import { api, ApiError } from '@/lib/api';
import {
  formatBRL,
  formatDateBR,
  formatInstantDateBR,
  isValidDocument,
  maskCpfCnpj
} from '@/lib/format';
import type { BillingStatus, Plan } from '@/lib/types';

interface Headline {
  tone: 'neutral' | 'warning' | 'danger' | 'success';
  title: string;
  text: string;
}

function headlineFor(status: BillingStatus): Headline {
  const { access, subscription } = status;
  const until = formatInstantDateBR(access.blocksAt);

  switch (access.reason) {
    case 'ADMIN':
      return {
        tone: 'success',
        title: 'Conta administradora',
        text: 'Seu acesso é liberado sem assinatura. Os planos abaixo são os que os clientes veem.'
      };
    case 'NO_PLAN':
      return {
        tone: 'neutral',
        title: 'Escolha seu plano',
        text: 'Sua conta foi criada. Para ativá-la, escolha um plano e conclua o pagamento.'
      };
    case 'PENDING_PAYMENT':
      return {
        tone: 'warning',
        title: 'Falta só o pagamento',
        text: 'Sua conta será ativada assim que o pagamento for confirmado. Pix confirma em segundos.'
      };
    case 'EXPIRED':
      return {
        tone: 'danger',
        title: 'Sua assinatura expirou',
        text:
          'O painel e as cobranças automáticas estão pausados. Seus clientes e faturas continuam guardados: renove para retomar de onde parou.'
      };
    case 'PAST_DUE':
      return {
        tone: 'danger',
        title: 'Pagamento em atraso',
        text: `Seu acesso continua liberado até ${until}. Depois disso, o painel e as cobranças automáticas serão bloqueados.`
      };
    case 'TRIAL':
      return {
        tone: 'warning',
        title: 'Período de cortesia',
        text: `Seu acesso gratuito vai até ${until}. Assine agora: a primeira cobrança só vence no fim da cortesia.`
      };
    default:
      return subscription?.status === 'CANCELED'
        ? {
            tone: 'warning',
            title: 'Assinatura cancelada',
            text: `Você tem acesso até ${until}. Para continuar depois disso, assine de novo abaixo.`
          }
        : {
            tone: 'success',
            title: 'Assinatura ativa',
            text: `Plano ${subscription?.planName ?? ''} em dia. Próxima renovação em ${until}.`
          };
  }
}

const HEADLINE_TONE: Record<Headline['tone'], string> = {
  neutral: 'border-sand-200/70 bg-white',
  warning: 'border-flame-100 bg-flame-50',
  danger: 'border-danger-100 bg-danger-50',
  success: 'border-leaf-100 bg-leaf-50'
};

function cycleSuffix(plan: Plan): string {
  return plan.cycle === 'YEARLY' ? '/ano' : '/mês';
}

export default function PlanosPage() {
  const router = useRouter();
  const { push } = useToast();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [document, setDocument] = useState('');
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    const [billing, planList] = await Promise.all([
      api<BillingStatus>('/billing/status'),
      api<Plan[]>('/billing/plans')
    ]);
    setStatus(billing);
    setPlans(planList);
    setSelected((current) => current ?? billing.subscription?.planCode ?? planList[0]?.code ?? null);
  }, []);

  useEffect(() => {
    load().catch(() => setError('Não foi possível carregar os planos. Recarregue a página.'));
  }, [load]);

  async function checkout(event?: FormEvent) {
    event?.preventDefault();
    if (!selected) return;
    if (!isValidDocument(document)) {
      setDocumentError('Informe um CPF ou CNPJ válido. Ele vai na nota da assinatura.');
      return;
    }
    setDocumentError(null);
    setError(null);
    setSubmitting(true);
    try {
      const { checkoutUrl } = await api<{ checkoutUrl: string | null }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planCode: selected, cpfCnpj: document })
      });
      if (checkoutUrl) {
        // Página segura do Asaas (Pix, boleto ou cartão). Ela volta para
        // /checkout/retorno quando o pagamento termina.
        window.location.assign(checkoutUrl);
      } else {
        router.push('/checkout/retorno');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível iniciar o pagamento.');
      setSubmitting(false);
    }
  }

  async function cancel() {
    setCanceling(true);
    try {
      const result = await api<{ accessUntil: string | null }>('/billing/cancel', { method: 'POST' });
      push(
        'success',
        result.accessUntil
          ? `Assinatura cancelada. Você mantém o acesso até ${formatInstantDateBR(result.accessUntil)}.`
          : 'Assinatura cancelada.'
      );
      setConfirmCancel(false);
      await load();
    } catch (err) {
      push('error', err instanceof ApiError ? err.message : 'Falha ao cancelar');
    } finally {
      setCanceling(false);
    }
  }

  if (!status) {
    return (
      <div className="flex justify-center py-20">
        {error ? <p className="text-sm text-danger-600">{error}</p> : <Spinner />}
      </div>
    );
  }

  const headline = headlineFor(status);
  const { access, subscription, openPayment } = status;
  const paying = subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE';
  // Em dia: não há o que contratar, só renovar antes (quando o Asaas já gerou a cobrança).
  const upToDate = paying && access.state === 'FULL';
  // Em atraso com boleto aberto: o caminho é pagar o boleto, não trocar de plano.
  const showPlanPicker = !upToDate && !(access.reason === 'PAST_DUE' && openPayment?.checkoutUrl);
  const canCancel =
    subscription && ['ACTIVE', 'PAST_DUE', 'TRIALING', 'PENDING_PAYMENT'].includes(subscription.status) &&
    access.reason !== 'NO_PLAN';

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <CheckoutSteps current={access.state === 'BLOCKED' ? (access.reason === 'PENDING_PAYMENT' ? 2 : 1) : 3} />
        <div className={cx('rounded-2xl border p-5', HEADLINE_TONE[headline.tone])}>
          <div className="flex items-start gap-3">
            {headline.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-leaf-700" />
            ) : headline.tone === 'danger' ? (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-600" />
            ) : (
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold tracking-tight text-sand-900">{headline.title}</h1>
              <p className="mt-1 text-sm leading-relaxed text-sand-600">{headline.text}</p>
              {openPayment?.checkoutUrl && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    variant={headline.tone === 'danger' ? 'danger' : 'primary'}
                    onClick={() => window.location.assign(openPayment.checkoutUrl!)}
                  >
                    {openPayment.status === 'OVERDUE' ? 'Pagar agora' : 'Ir para o pagamento'}
                  </Button>
                  <span className="text-sm text-sand-600">
                    {formatBRL(openPayment.amountCents)} · vencimento {formatDateBR(openPayment.dueDate)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showPlanPicker && plans.length > 0 && (
        <form onSubmit={checkout} className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {plans.map((plan) => {
              const isSelected = plan.code === selected;
              const monthly = plan.cycle === 'YEARLY' ? Math.round(plan.priceCents / 12) : null;
              return (
                <button
                  type="button"
                  key={plan.code}
                  onClick={() => setSelected(plan.code)}
                  aria-pressed={isSelected}
                  className={cx(
                    'rounded-2xl border bg-white p-5 text-left shadow-card transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500',
                    isSelected ? 'border-primary-500 ring-1 ring-primary-500' : 'border-sand-200/70 hover:border-sand-300'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[15px] font-bold text-sand-900">{plan.name}</span>
                    {subscription?.planCode === plan.code && <Badge variant="brand">Seu plano</Badge>}
                  </div>
                  <p className="mt-3 text-2xl font-bold tracking-tight text-sand-900">
                    {formatBRL(plan.priceCents)}
                    <span className="text-sm font-semibold text-sand-500">{cycleSuffix(plan)}</span>
                  </p>
                  {monthly && (
                    <p className="text-xs font-semibold text-leaf-700">equivale a {formatBRL(monthly)}/mês</p>
                  )}
                  {plan.description && <p className="mt-2 text-sm text-sand-600">{plan.description}</p>}
                </button>
              );
            })}
          </div>

          <Card className="space-y-4 p-5">
            <Field
              label="CPF ou CNPJ do titular"
              error={documentError}
              hint="Exigido pelo Asaas para emitir a cobrança."
            >
              <Input
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                value={document}
                onChange={(event) => setDocument(maskCpfCnpj(event.target.value))}
              />
            </Field>
            {error && <p className="text-sm font-semibold text-danger-600">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs text-sand-500">
                <Lock className="h-3.5 w-3.5" /> Pagamento seguro pelo Asaas: Pix, boleto ou cartão
              </span>
              <Button type="submit" size="lg" loading={submitting} disabled={!selected}>
                Continuar para o pagamento
              </Button>
            </div>
          </Card>
        </form>
      )}

      {upToDate && subscription && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-sm font-bold text-sand-900">
              Plano {subscription.planName} · {formatBRL(subscription.priceCents)}
              {subscription.cycle === 'YEARLY' ? '/ano' : '/mês'}
            </p>
            <p className="text-sm text-sand-500">
              Pago até {formatInstantDateBR(subscription.currentPeriodEnd)}
            </p>
          </div>
        </Card>
      )}

      {canCancel && (
        <div className="text-center">
          <button
            onClick={() => setConfirmCancel(true)}
            className="text-[13px] font-semibold text-sand-500 underline-offset-4 hover:text-danger-600 hover:underline"
          >
            Cancelar assinatura
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar a assinatura?"
        description="As próximas cobranças não serão geradas. Você mantém o acesso até o fim do período já pago. Depois disso, o painel e as mensagens automáticas param."
        confirmLabel="Cancelar assinatura"
        loading={canceling}
        onConfirm={cancel}
        onClose={() => setConfirmCancel(false)}
      />
    </div>
  );
}
