'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { Onboarding } from '@/lib/types';
import { cx } from './ui';

type StepKey = keyof Onboarding['steps'];

const STEPS: Array<{ key: StepKey; title: string; text: string; href: string; action: string }> = [
  {
    key: 'whatsapp',
    title: 'Conecte seu WhatsApp',
    text: 'Leia o QR Code com o celular que vai enviar as cobranças.',
    href: '/configuracoes',
    action: 'Conectar'
  },
  {
    key: 'gateway',
    title: 'Conecte o Asaas ou o Mercado Pago',
    text: 'É por onde o Pix é gerado e a baixa do pagamento acontece sozinha.',
    href: '/configuracoes',
    action: 'Configurar'
  },
  {
    key: 'client',
    title: 'Cadastre ou importe seus clientes',
    text: 'Um por um ou de uma vez, com uma planilha.',
    href: '/clientes',
    action: 'Abrir clientes'
  },
  {
    key: 'charge',
    title: 'Crie a primeira cobrança',
    text: 'Avulsa ou recorrente. O envio no vencimento é automático.',
    href: '/cobrancas',
    action: 'Criar cobrança'
  },
  {
    key: 'sent',
    title: 'Veja a primeira mensagem sair',
    text: 'Em Cobranças, use “Enviar agora” para testar com um cliente (ou com o seu número).',
    href: '/cobrancas',
    action: 'Enviar agora'
  }
];

/**
 * Cartão "Primeiros passos" do painel: mostra o que falta para a conta
 * cobrar sozinha. Some quando tudo está feito ou quando o usuário dispensa.
 */
export function OnboardingCard() {
  const [status, setStatus] = useState<Onboarding | null>(null);

  const load = useCallback(() => {
    api<Onboarding>('/dashboard/onboarding')
      .then(setStatus)
      // Falhou: o painel segue normalmente, só sem o cartão.
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!status || status.completed || status.dismissed) return null;

  // O primeiro passo pendente é o que fica em destaque.
  const nextKey = STEPS.find((step) => !status.steps[step.key])?.key;
  const percent = Math.round((status.done / status.total) * 100);

  function dismiss() {
    setStatus((current) => (current ? { ...current, dismissed: true } : current));
    api('/dashboard/onboarding/dismiss', { method: 'POST' }).catch(() => undefined);
  }

  return (
    <section
      aria-label="Primeiros passos"
      className="overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 bg-primary-50 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-500">
            <Rocket className="h-4 w-4 text-white" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold tracking-tight text-sand-900">Primeiros passos</h2>
            <p className="text-[13px] text-sand-600">
              {status.done} de {status.total} concluídos. Falta pouco para cobrar no automático.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          title="Não mostrar mais"
          aria-label="Não mostrar mais os primeiros passos"
          className="rounded-lg p-1.5 text-sand-400 hover:bg-white hover:text-sand-700"
        >
          <X className="h-4 w-4" />
        </button>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-primary-100"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary-500 transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ol className="divide-y divide-sand-100">
        {STEPS.map((step, index) => {
          const done = status.steps[step.key];
          const isNext = step.key === nextKey;
          return (
            <li key={step.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
              <span
                className={cx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  done
                    ? 'bg-leaf-500 text-white'
                    : isNext
                      ? 'bg-primary-500 text-white'
                      : 'bg-sand-100 text-sand-500'
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-[180px] flex-1">
                <p
                  className={cx(
                    'text-[13.5px] font-bold',
                    done ? 'text-sand-400 line-through' : 'text-sand-900'
                  )}
                >
                  {step.title}
                </p>
                {!done && <p className="text-xs text-sand-500">{step.text}</p>}
              </div>
              {!done && (
                <Link
                  href={step.href}
                  className={cx(
                    'inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-bold',
                    isNext
                      ? 'bg-primary-500 text-white shadow-sm hover:bg-primary-600'
                      : 'text-primary-600 hover:bg-primary-50'
                  )}
                >
                  {step.action}
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
