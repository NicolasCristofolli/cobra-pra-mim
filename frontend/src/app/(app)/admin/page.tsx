'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Search, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FilterChip,
  IconInput,
  Modal,
  Select,
  Spinner,
  Th,
  type BadgeVariant
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { daysUntil, formatBRL, formatDateBR, formatDateTimeBR, formatInstantDateBR } from '@/lib/format';
import type { AdminAccount, AdminOverview } from '@/lib/types';

type Filter = 'all' | 'paying' | 'trial' | 'blocked' | 'attention';

const FILTERS: Array<{ value: Filter; label: string; variant: BadgeVariant }> = [
  { value: 'paying', label: 'Pagantes', variant: 'success' },
  { value: 'trial', label: 'Em teste', variant: 'brand' },
  { value: 'blocked', label: 'Bloqueadas', variant: 'neutral' },
  { value: 'attention', label: 'Precisam de atenção', variant: 'danger' }
];

/** Situação da conta em uma etiqueta. */
function accountBadge(account: AdminAccount): { label: string; variant: BadgeVariant } {
  if (account.role === 'ADMIN') return { label: 'Administrador', variant: 'neutral' };
  if (!account.emailVerified) return { label: 'E-mail não confirmado', variant: 'warning' };
  switch (account.access.reason) {
    case 'OK':
      return account.subscriptionStatus === 'CANCELED'
        ? { label: 'Cancelada (até o fim do período)', variant: 'warning' }
        : { label: 'Pagante', variant: 'success' };
    case 'TRIAL':
      return { label: `Teste (${daysUntil(account.trialEndsAt)} d)`, variant: 'brand' };
    case 'PAST_DUE':
      return { label: 'Em atraso', variant: 'warning' };
    case 'PENDING_PAYMENT':
      return { label: 'Aguardando pagamento', variant: 'neutral' };
    case 'NO_PLAN':
      return { label: 'Sem plano', variant: 'neutral' };
    default:
      return { label: 'Expirada', variant: 'danger' };
  }
}

const needsAttention = (account: AdminAccount) =>
  account.role === 'USER' && (account.whatsappDisconnected || account.failedSends24h > 0);

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[11.5px] font-semibold text-sand-400">{label}</p>
      <p className={`money mt-0.5 text-xl font-bold ${tone ?? 'text-sand-900'}`}>{value}</p>
      {hint && <p className="mt-1 text-[10.5px] text-sand-400">{hint}</p>}
    </Card>
  );
}

export default function AdminPage() {
  const { push } = useToast();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [extending, setExtending] = useState<AdminAccount | null>(null);
  const [extendDays, setExtendDays] = useState(7);
  const [extendLoading, setExtendLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverview>('/admin/overview'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setDenied(true);
      else push('error', (error as Error).message);
    }
  }, [push]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = useMemo(() => {
    if (!data) return [];
    const term = query.trim().toLowerCase();
    return data.accounts.filter((account) => {
      if (term && !account.name.toLowerCase().includes(term) && !account.email.toLowerCase().includes(term)) {
        return false;
      }
      if (filter === 'all') return true;
      if (account.role === 'ADMIN') return false;
      if (filter === 'paying') return account.access.reason === 'OK';
      if (filter === 'trial') return account.access.reason === 'TRIAL';
      if (filter === 'blocked') return account.access.state === 'BLOCKED';
      return needsAttention(account);
    });
  }, [data, query, filter]);

  async function extendTrial() {
    if (!extending) return;
    setExtendLoading(true);
    try {
      await api(`/admin/accounts/${extending.id}/extend-trial`, {
        method: 'POST',
        body: JSON.stringify({ days: extendDays })
      });
      push('success', `Teste de ${extending.name} estendido em ${extendDays} dias.`);
      setExtending(null);
      await load();
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setExtendLoading(false);
    }
  }

  if (denied) {
    return (
      <Card>
        <EmptyState
          icon={ShieldCheck}
          title="Área restrita"
          description="Esta página é só para administradores da plataforma."
        />
      </Card>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const { summary, engine } = data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-sand-900">Administração</h1>
        <p className="mt-1 text-[13px] text-sand-600">
          Contas da plataforma, assinaturas e saúde dos envios. Os clientes e as cobranças de cada
          conta não aparecem aqui.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Stat
          label="Contas"
          value={String(summary.accounts)}
          hint={`${summary.unverified} sem e-mail confirmado`}
        />
        <Stat
          label="Pagantes"
          value={String(summary.paying)}
          hint={`${summary.pastDue} em atraso · ${summary.blocked} bloqueadas`}
          tone="text-leaf-600"
        />
        <Stat
          label="Em teste"
          value={String(summary.trial)}
          hint={`${summary.trialEndingSoon} acabam em até 3 dias`}
          tone="text-primary-600"
        />
        <Stat
          label="Receita recorrente mensal"
          value={formatBRL(summary.mrrCents)}
          hint="Assinaturas ativas (anual ÷ 12)"
        />
      </div>

      {(summary.whatsappDisconnected > 0 || summary.failedSends24h > 0 || engine.lastRunOk === false) && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-flame-50 px-4 py-3 text-sm text-flame-700 ring-1 ring-inset ring-flame-100"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 font-semibold">
            {[
              engine.lastRunOk === false ? 'A última execução do motor de cobrança falhou.' : null,
              summary.whatsappDisconnected > 0
                ? `${summary.whatsappDisconnected} conta${summary.whatsappDisconnected > 1 ? 's' : ''} com WhatsApp desconectado.`
                : null,
              summary.failedSends24h > 0
                ? `${summary.failedSends24h} envio${summary.failedSends24h > 1 ? 's' : ''} com falha nas últimas 24 horas.`
                : null
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
          <Button size="sm" variant="outline" onClick={() => setFilter('attention')}>
            Ver contas
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <IconInput
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome ou e-mail"
          className="w-full max-w-[280px]"
        />
        {FILTERS.map(({ value, label, variant }) => (
          <FilterChip
            key={value}
            variant={variant}
            active={filter === value}
            onClick={() => setFilter((current) => (current === value ? 'all' : value))}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon={Search} title="Nenhuma conta com esses filtros" />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <Th>Conta</Th>
                  <Th>Situação</Th>
                  <Th>Configuração</Th>
                  <Th>Uso</Th>
                  <Th>Cadastro</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const badge = accountBadge(account);
                  const canExtend =
                    account.role === 'USER' &&
                    (account.subscriptionStatus === 'TRIALING' || account.subscriptionStatus === null);
                  return (
                    <tr key={account.id} className="border-t border-sand-100 align-top">
                      <td className="px-5 py-3">
                        <p className="text-[13.5px] font-bold text-sand-900">{account.name}</p>
                        <p className="break-all text-xs text-sand-500">{account.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <p className="mt-1 text-xs text-sand-500">
                          {account.planName ?? 'Sem plano'}
                          {account.access.reason === 'OK' && account.currentPeriodEnd
                            ? ` · até ${formatInstantDateBR(account.currentPeriodEnd)}`
                            : ''}
                          {account.access.reason === 'TRIAL' && account.trialEndsAt
                            ? ` · até ${formatInstantDateBR(account.trialEndsAt)}`
                            : ''}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-xs text-sand-600">
                        <p className="flex items-center gap-1.5">
                          {account.whatsappConfigured && !account.whatsappDisconnected ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-leaf-600" />
                          ) : (
                            <AlertCircle
                              className={`h-3.5 w-3.5 ${account.whatsappDisconnected ? 'text-danger-600' : 'text-sand-300'}`}
                            />
                          )}
                          WhatsApp{' '}
                          {account.whatsappDisconnected
                            ? 'desconectado'
                            : account.whatsappConfigured
                              ? 'conectado'
                              : 'não conectado'}
                        </p>
                        <p className="mt-1 flex items-center gap-1.5">
                          {account.gatewayProvider ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-leaf-600" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-sand-300" />
                          )}
                          {account.gatewayProvider === 'ASAAS'
                            ? 'Asaas'
                            : account.gatewayProvider === 'MERCADO_PAGO'
                              ? 'Mercado Pago'
                              : 'Sem gateway'}
                        </p>
                      </td>
                      <td className="px-5 py-3 text-xs text-sand-600">
                        <p>
                          <span className="font-bold text-sand-900">{account.clients}</span> clientes ·{' '}
                          <span className="font-bold text-sand-900">{account.charges}</span> cobranças
                        </p>
                        <p className="mt-1">
                          Último envio: {account.lastSentAt ? formatDateTimeBR(account.lastSentAt) : 'nunca'}
                        </p>
                        {account.failedSends24h > 0 && (
                          <p className="mt-1 font-bold text-danger-600">
                            {account.failedSends24h} falha{account.failedSends24h > 1 ? 's' : ''} em 24h
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium text-sand-600">
                        {formatInstantDateBR(account.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canExtend && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setExtendDays(7);
                              setExtending(account);
                            }}
                          >
                            Estender teste
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Motor de cobrança"
          subtitle={
            engine.lastRunAt
              ? `Última execução: ${formatDateTimeBR(engine.lastRunAt)} (${engine.lastRunOk ? 'ok' : 'com erro'}). Roda de hora em hora.`
              : 'Ainda não rodou neste servidor.'
          }
        />
        {engine.recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-sand-500">Nenhuma execução com envios até agora.</p>
        ) : (
          <ul className="divide-y divide-sand-100">
            {engine.recent.map((run) => (
              <li key={run.finishedAt} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                <Badge variant={run.ok ? 'success' : 'danger'}>{run.ok ? 'OK' : 'Falhou'}</Badge>
                <span className="font-semibold text-sand-900">{formatDateBR(run.ranOn)}</span>
                <span className="text-sand-500">{formatDateTimeBR(run.finishedAt).slice(-5)}</span>
                <span className="text-sand-600">
                  {run.notified} enviadas · {run.notifyFailed} falhas · {run.generated} recorrentes geradas
                </span>
                {run.error && <span className="w-full break-all text-xs text-danger-600">{run.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={extending !== null}
        onClose={() => setExtending(null)}
        title="Estender teste grátis"
        subtitle={extending ? `${extending.name} · ${extending.email}` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtending(null)}>
              Cancelar
            </Button>
            <Button loading={extendLoading} onClick={extendTrial}>
              Estender
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm leading-relaxed text-sand-600">
          A conta volta a ter acesso completo pelo período escolhido, contado a partir de agora (ou
          do fim do teste atual, se ainda estiver valendo).
        </p>
        <Select value={extendDays} onChange={(event) => setExtendDays(Number(event.target.value))}>
          {[3, 7, 14, 30].map((days) => (
            <option key={days} value={days}>
              Mais {days} dias
            </option>
          ))}
        </Select>
      </Modal>
    </div>
  );
}
