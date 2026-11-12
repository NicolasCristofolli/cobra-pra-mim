'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Check, AlertTriangle, Ban } from 'lucide-react';
import { formatBRL, formatDateBR, formatInstantDateBR } from '@/lib/format';
import type { PublicCharge } from '@/lib/types';

type State =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ready'; charge: PublicCharge };

/** Enquanto a fatura está em aberto, confere de tempos em tempos se o Pix caiu. */
const REFRESH_MS = 10_000;

async function fetchCharge(token: string): Promise<State> {
  try {
    const response = await fetch(`/api/public/charges/${encodeURIComponent(token)}`, {
      cache: 'no-store'
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'error' };
    return { kind: 'ready', charge: (await response.json()) as PublicCharge };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * Página pública da fatura: o cliente final abre pelo link recebido no
 * WhatsApp, sem login, e vê valor, vencimento, situação e o Pix.
 */
export default function PublicInvoicePage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const next = await fetchCharge(params.token);
      if (!active) return;
      // Falha passageira não apaga uma fatura que já está na tela.
      setState((current) => (next.kind === 'error' && current.kind === 'ready' ? current : next));
      const stillOpen =
        next.kind === 'error' ||
        (next.kind === 'ready' && (next.charge.status === 'PENDING' || next.charge.status === 'OVERDUE'));
      if (stillOpen) timer = setTimeout(load, REFRESH_MS);
    };
    load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [params.token]);

  async function copyPix(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Navegador sem permissão de área de transferência: o código fica visível para copiar à mão.
    }
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-sand-50 px-4 py-8 sm:items-center">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-sand-100">
          {state.kind === 'loading' && (
            <p className="px-6 py-16 text-center text-sm text-sand-500">Carregando fatura…</p>
          )}

          {state.kind === 'not_found' && (
            <div className="px-6 py-14 text-center">
              <Ban className="mx-auto h-8 w-8 text-sand-400" />
              <h1 className="mt-3 text-base font-bold text-sand-900">Fatura não encontrada</h1>
              <p className="mt-1.5 text-sm text-sand-600">
                Confira se o link está completo ou peça um novo a quem enviou a cobrança.
              </p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="px-6 py-14 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-flame-600" />
              <h1 className="mt-3 text-base font-bold text-sand-900">Não foi possível carregar</h1>
              <p className="mt-1.5 text-sm text-sand-600">
                Tentando de novo em instantes. Se continuar, atualize a página.
              </p>
            </div>
          )}

          {state.kind === 'ready' && <Invoice charge={state.charge} copied={copied} onCopy={copyPix} />}
        </div>
        <p className="mt-4 text-center text-xs text-sand-400">Cobrança enviada com Cobra pra mim</p>
      </div>
    </main>
  );
}

function Invoice({
  charge,
  copied,
  onCopy
}: {
  charge: PublicCharge;
  copied: boolean;
  onCopy: (code: string) => void;
}) {
  const open = charge.status === 'PENDING' || charge.status === 'OVERDUE';

  return (
    <>
      <header className="border-b border-sand-100 px-6 pb-5 pt-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-sand-500">
          Cobrança de {charge.sellerName}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-sand-900">
          {formatBRL(charge.amountCents)}
        </h1>
        <p className="mt-1 text-sm text-sand-600">{charge.description}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <StatusPill status={charge.status} />
          <span className="text-sand-500">Vencimento: {formatDateBR(charge.dueDate)}</span>
        </div>
      </header>

      <div className="px-6 py-6">
        {charge.status === 'PAID' && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-leaf-600" />
            <p className="mt-3 text-base font-bold text-sand-900">Pagamento confirmado</p>
            <p className="mt-1 text-sm text-sand-600">
              {charge.paidAt ? `Recebido em ${formatInstantDateBR(charge.paidAt)}. ` : ''}
              {charge.clientFirstName ? `Obrigado, ${charge.clientFirstName}!` : 'Obrigado!'}
            </p>
          </div>
        )}

        {charge.status === 'CANCELED' && (
          <p className="text-center text-sm text-sand-600">
            Esta cobrança foi cancelada. Não é necessário pagar.
          </p>
        )}

        {open && charge.pixCopyPaste && (
          <div className="space-y-4">
            {charge.pixQrCodeUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={charge.pixQrCodeUrl}
                alt="QR Code do Pix"
                className="mx-auto h-52 w-52 rounded-2xl ring-1 ring-sand-100"
              />
            )}
            <p className="text-center text-[13px] text-sand-600">
              {charge.pixQrCodeUrl
                ? 'Aponte a câmera do app do seu banco para o QR Code ou use o código abaixo.'
                : 'No app do seu banco, escolha Pix copia e cola e use o código abaixo.'}
            </p>
            <p className="break-all rounded-xl bg-sand-50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-sand-700">
              {charge.pixCopyPaste}
            </p>
            <button
              type="button"
              onClick={() => onCopy(charge.pixCopyPaste!)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf-500"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Código copiado!' : 'Copiar código Pix'}
            </button>
            <p className="text-center text-xs text-sand-500">
              Esta página atualiza sozinha quando o pagamento for confirmado.
            </p>
          </div>
        )}

        {open && !charge.pixCopyPaste && charge.invoiceUrl && (
          <a
            href={charge.invoiceUrl}
            className="flex w-full items-center justify-center rounded-xl bg-primary-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-primary-700"
          >
            Pagar agora
          </a>
        )}

        {open && !charge.pixCopyPaste && !charge.invoiceUrl && (
          <p className="text-center text-sm text-sand-600">
            O pagamento desta cobrança é combinado direto com {charge.sellerName}.
          </p>
        )}
      </div>
    </>
  );
}

function StatusPill({ status }: { status: PublicCharge['status'] }) {
  const map = {
    PENDING: ['Em aberto', 'bg-flame-50 text-flame-700 ring-flame-100'],
    OVERDUE: ['Vencida', 'bg-danger-50 text-danger-700 ring-danger-100'],
    PAID: ['Paga', 'bg-leaf-50 text-leaf-700 ring-leaf-100'],
    CANCELED: ['Cancelada', 'bg-sand-100 text-sand-600 ring-sand-200']
  } as const;
  const [label, tone] = map[status];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}
