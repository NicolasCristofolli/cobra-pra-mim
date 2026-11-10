'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Clock } from 'lucide-react';
import { CheckoutSteps } from '@/components/checkout-steps';
import { Button, Card, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import type { BillingStatus } from '@/lib/types';

const POLL_MS = 3_000;
// Pix confirma em segundos. Depois de 10 minutos, para de consultar e deixa
// a pessoa voltar quando quiser (boleto leva até 3 dias úteis).
const POLL_LIMIT_MS = 10 * 60_000;

/**
 * Retorno do checkout do Asaas. Esta página NÃO ativa nada: só acompanha o
 * status até o webhook do Asaas confirmar o pagamento (passo 3).
 */
export default function CheckoutReturnPage() {
  const router = useRouter();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const startedAt = useRef(Date.now());

  const activated = status !== null && status.access.state !== 'BLOCKED' && status.subscription?.status === 'ACTIVE';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    async function poll() {
      try {
        const next = await api<BillingStatus>('/billing/status');
        if (stopped) return;
        setStatus(next);
        if (next.access.state !== 'BLOCKED' && next.subscription?.status === 'ACTIVE') return;
      } catch {
        // Falha pontual de rede: tenta de novo no próximo ciclo.
      }
      if (Date.now() - startedAt.current > POLL_LIMIT_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // Ativou: segue para o painel sozinho.
  useEffect(() => {
    if (!activated) return;
    const timer = setTimeout(() => router.replace('/dashboard'), 2_500);
    return () => clearTimeout(timer);
  }, [activated, router]);

  const checkoutUrl = status?.openPayment?.checkoutUrl ?? null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <CheckoutSteps current={activated ? 3 : 2} />
      <Card className="p-8 text-center">
        {!status ? (
          <Spinner className="mx-auto h-8 w-8" />
        ) : activated ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-leaf-600" />
            <h1 className="mt-4 text-xl font-bold tracking-tight text-sand-900">Conta ativada!</h1>
            <p className="mt-2 text-sm text-sand-600">
              Pagamento confirmado. Levando você para o painel…
            </p>
            <Button className="mt-6" onClick={() => router.replace('/dashboard')}>
              Ir para o painel agora
            </Button>
          </>
        ) : (
          <>
            {gaveUp ? (
              <Clock className="mx-auto h-12 w-12 text-flame-600" />
            ) : (
              <Spinner className="mx-auto h-12 w-12" />
            )}
            <h1 className="mt-4 text-xl font-bold tracking-tight text-sand-900">
              {gaveUp ? 'Ainda não recebemos a confirmação' : 'Aguardando a confirmação do pagamento'}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-sand-600">
              {gaveUp
                ? 'Pagamentos por boleto podem levar até 3 dias úteis. Sua conta é ativada sozinha quando o Asaas confirmar: pode fechar esta página.'
                : 'Pix costuma confirmar em poucos segundos. Esta página atualiza sozinha.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {checkoutUrl && (
                <Button onClick={() => window.location.assign(checkoutUrl)}>
                  Abrir o pagamento
                </Button>
              )}
              <Link
                href="/planos"
                className="inline-flex items-center rounded-xl border border-sand-200 bg-white px-4 py-2 text-sm font-semibold text-sand-900 hover:bg-sand-50"
              >
                Trocar de plano
              </Link>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
