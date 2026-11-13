'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Clock,
  Lightbulb,
  Send,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { CashflowChart, DonutChart, DonutLegendRow } from '@/components/charts';
import { OnboardingCard } from '@/components/onboarding-card';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  ChargeBadge,
  EmptyState,
  Spinner,
  cx
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { useUser } from '@/components/user-context';
import type { CashflowPoint, Charge, Metrics } from '@/lib/types';

interface StatusTotals {
  paid: number;
  pending: number;
  overdue: number;
}

interface ClientTotals {
  total: number;
  inadimplentes: number;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function DashboardPage() {
  const user = useUser();
  const { push } = useToast();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [cashflow, setCashflow] = useState<CashflowPoint[]>([]);
  const [dueToday, setDueToday] = useState<Charge[] | null>(null);
  const [statusTotals, setStatusTotals] = useState<StatusTotals | null>(null);
  const [clientTotals, setClientTotals] = useState<ClientTotals | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    // As contagens (faturas por situação, clientes) vêm prontas em /metrics:
    // 3 requisições em vez de 7, sem baixar a lista inteira de clientes.
    const [metricsData, cashflowData, dueTodayData] = await Promise.all([
      api<Metrics>('/dashboard/metrics'),
      api<CashflowPoint[]>('/dashboard/cashflow?days=14'),
      api<Charge[]>('/dashboard/due-today')
    ]);
    setMetrics(metricsData);
    setCashflow(cashflowData);
    setDueToday(dueTodayData);
    setClientTotals({
      total: metricsData.clientsTotal,
      inadimplentes: metricsData.clientsOverdue
    });
    setStatusTotals({
      paid: metricsData.statusCounts.paid,
      pending: metricsData.statusCounts.open,
      overdue: metricsData.statusCounts.overdue
    });
  }, []);

  useEffect(() => {
    load().catch(() => push('error', 'Não foi possível carregar o painel.'));
  }, [load, push]);

  // Tempo real: o webhook publica em /dashboard/events (SSE). Se o stream
  // cair, degrada para polling a cada 30s.
  useEffect(() => {
    const source = new EventSource('/api/dashboard/events');
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === 'payment') {
          push('success', 'Pagamento recebido! Painel atualizado. 💸');
          load().catch(() => undefined);
        }
      } catch {
        /* mensagens de heartbeat são ignoradas */
      }
    };
    source.onopen = () => {
      // Stream de volta (ex.: depois de um deploy): o polling não é mais necessário.
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    source.onerror = () => {
      // Não fecha o stream: o EventSource reconecta sozinho. Enquanto isso,
      // o painel se atualiza por polling.
      if (!pollRef.current) {
        pollRef.current = setInterval(() => load().catch(() => undefined), 30_000);
      }
    };
    return () => {
      source.close();
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [load, push]);

  async function notifyNow(chargeId: string) {
    setNotifyingId(chargeId);
    try {
      const result = await api<{ sent: boolean; reason?: string }>(
        `/charges/${chargeId}/notify`,
        { method: 'POST' }
      );
      if (result.sent) push('success', 'Cobrança enviada no WhatsApp do cliente.');
      else push('error', result.reason ?? 'Não foi possível enviar agora.');
      await load();
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setNotifyingId(null);
    }
  }

  if (!metrics || dueToday === null || statusTotals === null || clientTotals === null) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const statusTotal = statusTotals.paid + statusTotals.pending + statusTotals.overdue;
  const receiveRate =
    metrics.totalBilledCents > 0
      ? Math.round((metrics.totalReceivedCents / metrics.totalBilledCents) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Saudação do design */}
      <header className="flex items-center gap-3.5">
        <Avatar name={user.name} />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-sand-900">
            {greeting()}, {user.name.split(' ')[0]}
          </h1>
          <p className="mt-0.5 text-[13px] text-sand-600">Aqui está o resumo do seu negócio.</p>
        </div>
      </header>

      <OnboardingCard />

      {metrics.whatsappDisconnected && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-100"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 font-semibold">
            Seu WhatsApp está desconectado: as cobranças automáticas não estão sendo enviadas.
          </p>
          <Link
            href="/configuracoes"
            className="shrink-0 rounded-lg bg-danger-600 px-3 py-1.5 text-[13px] font-bold text-white shadow-sm hover:bg-danger-700"
          >
            Reconectar
          </Link>
        </div>
      )}
      {!metrics.whatsappDisconnected && metrics.failedSends24h > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-flame-50 px-4 py-3 text-sm text-flame-700 ring-1 ring-inset ring-flame-100"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 font-semibold">
            {metrics.failedSends24h === 1
              ? '1 envio falhou nas últimas 24 horas.'
              : `${metrics.failedSends24h} envios falharam nas últimas 24 horas.`}{' '}
            Confira a conexão do WhatsApp e a chave do gateway.
          </p>
          <Link
            href="/configuracoes"
            className="shrink-0 rounded-lg bg-flame-600 px-3 py-1.5 text-[13px] font-bold text-white shadow-sm hover:bg-flame-700"
          >
            Ver configurações
          </Link>
        </div>
      )}

      {/* KPIs principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-primary-500 p-5">
          <div className="flex items-center justify-between">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[.18]">
              <Wallet className="h-4 w-4 text-white" />
            </span>
            <ArrowUpRight className="h-[15px] w-[15px] text-white/60" />
          </div>
          <p className="mt-3 text-[11.5px] font-semibold text-white/75">Faturamento</p>
          <p className="money mt-0.5 text-xl font-bold text-white">
            {formatBRL(metrics.totalBilledCents)}
          </p>
          <p className="mt-1 text-[10.5px] text-white/60">Total emitido até hoje</p>
        </div>

        <Card className="p-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-leaf-50">
            <TrendingUp className="h-4 w-4 text-leaf-600" />
          </span>
          <p className="mt-3 text-[11.5px] font-semibold text-sand-400">Lucro</p>
          <p className="money mt-0.5 text-xl font-bold text-leaf-600">
            {formatBRL(metrics.netProfitCents)}
          </p>
          <p className="mt-1 text-[10.5px] text-sand-400">Já recebido, líquido de taxas</p>
        </Card>

        <Card className="p-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-flame-50">
            <Clock className="h-4 w-4 text-flame-500" />
          </span>
          <p className="mt-3 text-[11.5px] font-semibold text-sand-400">Pendente</p>
          <p className="money mt-0.5 text-xl font-bold text-flame-600">
            {formatBRL(metrics.activeChargesAmountCents)}
          </p>
          <p className="mt-1 text-[10.5px] text-sand-400">
            {metrics.activeChargesCount} fatura{metrics.activeChargesCount === 1 ? '' : 's'} em
            aberto
          </p>
        </Card>

        <Card className="p-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-danger-50">
            <AlertCircle className="h-4 w-4 text-danger-600" />
          </span>
          <p className="mt-3 text-[11.5px] font-semibold text-sand-400">Inadimplência</p>
          <p className="money mt-0.5 text-xl font-bold text-danger-600">
            {metrics.defaultRatePercent.toLocaleString('pt-BR')}%
          </p>
          <p className="mt-1 text-[10.5px] text-sand-400">
            {metrics.maturedUnpaid} de {metrics.maturedCount} vencidas sem pagamento
          </p>
        </Card>
      </div>

      {/* Donuts do design — dados reais */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 text-[13.5px] font-bold text-sand-900">Status das cobranças</h2>
          <div className="flex flex-wrap items-center gap-5">
            <DonutChart
              segments={[
                { name: 'Pagas', value: statusTotals.paid, color: 'success' },
                { name: 'Em aberto', value: statusTotals.pending, color: 'warning' },
                { name: 'Vencidas', value: statusTotals.overdue, color: 'danger' }
              ]}
              centerLabel={String(statusTotal)}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <DonutLegendRow
                color="success"
                label="Pagas"
                value={`${percent(statusTotals.paid, statusTotal)}%`}
              />
              <DonutLegendRow
                color="warning"
                label="Em aberto"
                value={`${percent(statusTotals.pending, statusTotal)}%`}
              />
              <DonutLegendRow
                color="danger"
                label="Vencidas"
                value={`${percent(statusTotals.overdue, statusTotal)}%`}
              />
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-[13.5px] font-bold text-sand-900">Taxa de recebimento</h2>
          <div className="flex flex-wrap items-center gap-5">
            <DonutChart
              segments={[
                { name: 'Recebido', value: receiveRate, color: 'success' },
                { name: 'Restante', value: 100 - receiveRate, color: 'track' }
              ]}
              centerLabel={`${receiveRate}%`}
              centerClassName="text-[17px] font-bold text-leaf-700"
            />
            <p className="text-xs font-semibold leading-relaxed text-sand-600">
              {formatBRL(metrics.totalReceivedCents)} recebidos de{' '}
              {formatBRL(metrics.totalBilledCents)} faturados.
            </p>
          </div>
        </Card>
      </div>

      {/* Fluxo de caixa (Recharts) + vencendo hoje */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Fluxo de caixa — últimos 14 dias"
            subtitle="Recebido por dia de pagamento vs. pendente por vencimento"
            action={
              <div className="flex items-center gap-4 text-xs text-sand-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-leaf-600" /> Recebido
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-flame-500" /> Pendente
                </span>
              </div>
            }
          />
          <div className="p-5">
            <CashflowChart data={cashflow} />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Vencendo hoje"
            subtitle={
              dueToday.length === 0
                ? undefined
                : `${dueToday.length} fatura${dueToday.length > 1 ? 's' : ''} para acompanhar`
            }
          />
          {dueToday.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nada vence hoje"
              description="O motor de cobrança avisa seus clientes automaticamente no dia do vencimento."
            />
          ) : (
            <ul className="divide-y divide-sand-100">
              {dueToday.map((charge) => (
                <li key={charge.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5">
                  <div className="min-w-[140px] flex-1">
                    <p className="truncate text-[13px] font-bold text-sand-900">
                      {charge.clientName}
                    </p>
                    <p className="truncate text-xs text-sand-500">{charge.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="money text-sm font-bold text-sand-900">
                      {formatBRL(charge.amountCents)}
                    </span>
                    <ChargeBadge status={charge.status} />
                    <Button
                      size="sm"
                      variant="outline"
                      loading={notifyingId === charge.id}
                      onClick={() => notifyNow(charge.id)}
                      title="Enviar cobrança agora no WhatsApp"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Enviar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Banner de insight — verde-preto da marca */}
      <div className="rounded-2xl bg-ink px-6 py-5">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-leaf-500/20">
            <Lightbulb className="h-[18px] w-[18px] text-leaf-400" />
          </span>
          <div>
            <p className="text-sm font-bold text-white">
              {receiveRate >= 70
                ? `Você já recebeu ${receiveRate}% de tudo que faturou.`
                : `Sua taxa de recebimento está em ${receiveRate}%.`}
            </p>
            <p className="mt-0.5 text-[12.5px] text-white/65">
              {metrics.maturedUnpaid > 0
                ? `${metrics.maturedUnpaid} fatura${metrics.maturedUnpaid > 1 ? 's' : ''} vencida${metrics.maturedUnpaid > 1 ? 's' : ''} aguardando pagamento — os lembretes automáticos continuam ativos.`
                : 'Nenhuma fatura vencida sem pagamento. Continue assim!'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
