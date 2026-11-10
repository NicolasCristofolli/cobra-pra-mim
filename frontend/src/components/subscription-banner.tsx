'use client';

import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { daysUntil, formatInstantDateBR } from '@/lib/format';
import type { User } from '@/lib/types';
import { cx } from './ui';

const TRIAL_NOTICE_DAYS = 5;

/**
 * Aviso no topo do app. A assinatura atrasada ainda libera o acesso (carência),
 * mas o aviso fica fixo até o pagamento. Contas expiradas nem chegam aqui: o
 * middleware do Next já as manda para /planos.
 */
export function SubscriptionBanner({ user }: { user: User }) {
  const { access, subscription } = user;
  const days = daysUntil(access.blocksAt);
  const when = formatInstantDateBR(access.blocksAt);

  let tone: 'danger' | 'warning';
  let message: string;
  let cta: string;

  if (access.state === 'WARNING') {
    tone = 'danger';
    message =
      days <= 1
        ? `Pagamento em atraso. Seu acesso será bloqueado amanhã (${when}).`
        : `Pagamento em atraso. Seu acesso será bloqueado em ${days} dias (${when}).`;
    cta = 'Pagar agora';
  } else if (access.reason === 'TRIAL' && days <= TRIAL_NOTICE_DAYS) {
    tone = 'warning';
    message = `Seu período de cortesia termina em ${when}. Escolha um plano para não perder o acesso.`;
    cta = 'Escolher plano';
  } else if (subscription?.status === 'CANCELED' && access.state === 'FULL') {
    tone = 'warning';
    message = `Assinatura cancelada. Você tem acesso até ${when}.`;
    cta = 'Reativar';
  } else {
    return null;
  }

  const Icon = tone === 'danger' ? AlertTriangle : Clock;

  return (
    <div
      role="alert"
      className={cx(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-sm lg:px-8',
        tone === 'danger'
          ? 'border-danger-100 bg-danger-50 text-danger-700'
          : 'border-flame-100 bg-flame-50 text-flame-700'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 font-semibold">{message}</p>
      <Link
        href="/planos"
        className={cx(
          'shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-bold text-white shadow-sm',
          tone === 'danger' ? 'bg-danger-600 hover:bg-danger-700' : 'bg-flame-600 hover:bg-flame-700'
        )}
      >
        {cta}
      </Link>
    </div>
  );
}
