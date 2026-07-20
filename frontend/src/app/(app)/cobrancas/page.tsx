'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Ban,
  CheckCircle2,
  Copy,
  Pencil,
  Plus,
  ScrollText,
  Search,
  Send,
  Trash2
} from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChargeBadge,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  IconInput,
  Input,
  Modal,
  Select,
  Spinner,
  Th,
  cx,
  type BadgeVariant
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import {
  RECURRENCE_LABEL,
  centsToInputText,
  formatBRL,
  formatDateBR,
  formatDateTimeBR,
  formatPhoneBR,
  inputTextToCents
} from '@/lib/format';
import type { Charge, ChargeList, ChargeStatus, Client, Recurrence } from '@/lib/types';

const PAGE_SIZE = 20;

// Cores casadas com os badges de status da tabela.
const STATUS_FILTERS: Array<{ value: ChargeStatus; label: string; variant: BadgeVariant }> = [
  { value: 'PENDING', label: 'Em aberto', variant: 'warning' },
  { value: 'SENT', label: 'Enviadas', variant: 'brand' },
  { value: 'PAID', label: 'Pagas', variant: 'success' },
  { value: 'OVERDUE', label: 'Vencidas', variant: 'danger' },
  { value: 'CANCELED', label: 'Canceladas', variant: 'neutral' }
];

function todayInput(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** '2027-03' → '2027-03-31' (último dia do mês, sem pegadinha de fuso). */
function lastDayOfMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
}

export default function CobrancasPage() {
  // useSearchParams exige um limite de Suspense no build estático do Next.
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      }
    >
      <CobrancasContent />
    </Suspense>
  );
}

function CobrancasContent() {
  const { push } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const presetClientId = searchParams.get('novoCliente');

  const [query, setQuery] = useState(urlQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery);
  const [status, setStatus] = useState<'' | ChargeStatus>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ChargeList | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState<Charge | null>(null);
  const [deleting, setDeleting] = useState<Charge | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientListOpen, setClientListOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amountCents, setAmountCents] = useState(0);
  const [dueDate, setDueDate] = useState(todayInput());
  const [recurrence, setRecurrence] = useState<Recurrence>('NONE');
  // Data limite: mês/ano (YYYY-MM) nas semanais/mensais, só o ano nas anuais.
  const [endMonth, setEndMonth] = useState('');
  const [endYear, setEndYear] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editing, setEditing] = useState<Charge | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editAmountCents, setEditAmountCents] = useState(0);
  const [editDueDate, setEditDueDate] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Busca vinda da barra global (?q=) — inclusive quando já estamos na página.
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  // Fluxo "cliente recém-cadastrado": abre o modal com o cliente já escolhido.
  useEffect(() => {
    if (!presetClientId) return;
    void openCreate(presetClientId);
    // Limpa o parâmetro para não reabrir o modal em refresh/navegação.
    router.replace('/cobrancas', { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetClientId]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (status) params.set('status', status);
    setData(await api<ChargeList>(`/charges?${params.toString()}`));
  }, [debouncedQuery, status, page]);

  useEffect(() => {
    load().catch((error) => push('error', (error as Error).message));
  }, [load, push]);

  async function openCreate(preselectId?: string) {
    setClientId('');
    setClientSearch('');
    setClientListOpen(false);
    setDescription('');
    setAmountCents(0);
    setDueDate(todayInput());
    setRecurrence('NONE');
    setEndMonth('');
    setEndYear('');
    setFormError(null);
    setModalOpen(true);
    let list = clients;
    if (!list) {
      try {
        list = await api<Client[]>('/clients');
        setClients(list);
      } catch (error) {
        setFormError((error as Error).message);
        return;
      }
    }
    if (preselectId) {
      const preset = list.find((client) => client.id === preselectId);
      if (preset) selectClient(preset);
    }
  }

  function selectClient(client: Client) {
    setClientId(client.id);
    setClientSearch(`${client.name} — ${formatPhoneBR(client.phone)}`);
    setClientListOpen(false);
  }

  const filteredClients = (clients ?? []).filter((client) => {
    const term = clientSearch.trim().toLowerCase();
    if (!term) return true;
    if (client.name.toLowerCase().includes(term)) return true;
    const digits = term.replace(/\D/g, '');
    return digits.length > 0 && client.phone.includes(digits);
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!clientId) {
      setFormError('Escolha um cliente da lista de sugestões.');
      return;
    }
    if (amountCents <= 0) {
      setFormError('Informe um valor maior que zero.');
      return;
    }
    let recurrenceEndDate: string | null = null;
    if (recurrence === 'WEEKLY' || recurrence === 'MONTHLY') {
      if (!endMonth) {
        setFormError('Informe até qual mês/ano a recorrência deve rodar.');
        return;
      }
      recurrenceEndDate = lastDayOfMonth(endMonth);
    } else if (recurrence === 'YEARLY' && endYear) {
      recurrenceEndDate = `${endYear}-12-31`;
    }
    if (recurrenceEndDate && recurrenceEndDate < dueDate) {
      setFormError('A data limite precisa ser igual ou posterior ao primeiro vencimento.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api('/charges', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          description,
          amountCents,
          dueDate,
          recurrence,
          recurrenceEndDate
        })
      });
      push(
        'success',
        recurrence === 'NONE'
          ? 'Cobrança criada. Ela será enviada automaticamente no vencimento.'
          : 'Série recorrente criada. O motor gera e envia cada ciclo sozinho.'
      );
      setModalOpen(false);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues?.length) {
        setFormError(error.issues.map((issue) => issue.message).join(' · '));
      } else {
        setFormError((error as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  async function action(
    charge: Charge,
    kind: 'pay' | 'notify',
    successMessage: string
  ) {
    setActingId(charge.id);
    try {
      const result = await api<{ sent?: boolean; reason?: string }>(
        `/charges/${charge.id}/${kind}`,
        { method: 'POST' }
      );
      if (kind === 'notify' && result.sent === false) {
        push('error', result.reason ?? 'Não foi possível enviar.');
      } else {
        push('success', successMessage);
      }
      await load();
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setActingId(null);
    }
  }

  function openEdit(charge: Charge) {
    setEditing(charge);
    setEditDescription(charge.description);
    setEditAmountCents(charge.amountCents);
    setEditDueDate(charge.dueDate.slice(0, 10));
    setEditError(null);
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (editAmountCents <= 0) {
      setEditError('Informe um valor maior que zero.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api(`/charges/${editing.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          description: editDescription,
          amountCents: editAmountCents,
          dueDate: editDueDate
        })
      });
      push('success', 'Cobrança atualizada.');
      setEditing(null);
      await load();
    } catch (error) {
      if (error instanceof ApiError && error.issues?.length) {
        setEditError(error.issues.map((issue) => issue.message).join(' · '));
      } else {
        setEditError((error as Error).message);
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmCancel() {
    if (!canceling) return;
    setActingId(canceling.id);
    try {
      await api(`/charges/${canceling.id}/cancel`, { method: 'POST' });
      push('success', 'Fatura cancelada.');
      setCanceling(null);
      await load();
    } catch (error) {
      push('error', (error as Error).message);
      setCanceling(null);
    } finally {
      setActingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setActingId(deleting.id);
    try {
      await api(`/charges/${deleting.id}`, { method: 'DELETE' });
      push('success', 'Cobrança excluída.');
      setDeleting(null);
      await load();
    } catch (error) {
      push('error', (error as Error).message);
      setDeleting(null);
    } finally {
      setActingId(null);
    }
  }

  async function copyPix(charge: Charge) {
    if (!charge.pixCopyPaste) return;
    await navigator.clipboard.writeText(charge.pixCopyPaste);
    push('success', 'Pix copia-e-cola copiado!');
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="space-y-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[19px] font-bold tracking-tight text-sand-900">Cobranças</h1>
        <Button size="sm" onClick={() => openCreate()}>
          <Plus className="h-4 w-4" /> Nova cobrança
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2.5">
        <IconInput
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cliente ou descrição"
          className="w-full max-w-[240px]"
        />
        {STATUS_FILTERS.map(({ value, label, variant }) => (
          <FilterChip
            key={value}
            variant={variant}
            active={status === value}
            onClick={() => {
              setStatus((current) => (current === value ? '' : value));
              setPage(1);
            }}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {data === null ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon={ScrollText}
            title="Nenhuma cobrança por aqui"
            description={
              debouncedQuery || status
                ? 'Nenhum resultado com esses filtros.'
                : 'Crie a primeira cobrança — avulsa ou recorrente — e deixe o resto com a gente.'
            }
            action={
              debouncedQuery || status ? undefined : (
                <Button onClick={() => openCreate()}>
                  <Plus className="h-4 w-4" /> Nova cobrança
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Descrição</Th>
                  <Th>Valor</Th>
                  <Th>Vencimento</Th>
                  <Th>Pagamento</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((charge) => {
                  const open =
                    charge.status === 'PENDING' ||
                    charge.status === 'SENT' ||
                    charge.status === 'OVERDUE';
                  // Excluível: fatura cancelada ou órfã (cliente excluído).
                  const deletable =
                    charge.status === 'CANCELED' || charge.clientId === null;
                  const busy = actingId === charge.id;
                  return (
                    <tr
                      key={charge.id}
                      className="border-t border-sand-100 transition-colors hover:bg-primary-50/50"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={charge.clientName ?? '?'} size="sm" />
                          <div className="min-w-0">
                            <p
                              className={cx(
                                'text-[13px] font-bold',
                                charge.clientName ? 'text-sand-900' : 'italic text-sand-400'
                              )}
                            >
                              {charge.clientName ?? 'Cliente excluído'}
                            </p>
                            {charge.clientPhone && (
                              <p className="text-xs text-sand-500">
                                {formatPhoneBR(charge.clientPhone)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[220px] px-5 py-3">
                        <p className="truncate text-[13px] font-medium text-sand-700">
                          {charge.description}
                        </p>
                        {charge.recurrence !== 'NONE' && (
                          <Badge variant="brand" className="mt-1">
                            {RECURRENCE_LABEL[charge.recurrence]}
                            {charge.recurrenceEndDate
                              ? ` até ${formatDateBR(charge.recurrenceEndDate)}`
                              : ''}
                          </Badge>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <p className="money text-[13px] font-bold text-sand-900">
                          {formatBRL(charge.amountCents)}
                        </p>
                        {charge.status === 'PAID' && charge.netAmountCents !== null && (
                          <p className="money text-xs text-sand-500">
                            líq. {formatBRL(charge.netAmountCents)}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium text-sand-600">
                        {formatDateBR(charge.dueDate)}
                      </td>
                      <td className="px-5 py-3 text-[13px] font-medium text-sand-600">
                        {formatDateTimeBR(charge.paidAt)}
                      </td>
                      <td className="px-5 py-3">
                        <ChargeBadge status={charge.status} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-0.5">
                          {charge.pixCopyPaste && (
                            <IconButton
                              onClick={() => copyPix(charge)}
                              title="Copiar Pix copia-e-cola"
                            >
                              <Copy className="h-4 w-4" />
                            </IconButton>
                          )}
                          {(charge.status === 'PENDING' || charge.status === 'SENT') && (
                            <IconButton
                              onClick={() => openEdit(charge)}
                              disabled={busy}
                              title="Editar cobrança"
                            >
                              <Pencil className="h-4 w-4" />
                            </IconButton>
                          )}
                          {open && (
                            <>
                              <IconButton
                                onClick={() =>
                                  action(charge, 'notify', 'Cobrança enviada no WhatsApp.')
                                }
                                disabled={busy}
                                title="Enviar agora no WhatsApp"
                              >
                                <Send className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                onClick={() =>
                                  action(charge, 'pay', 'Fatura marcada como paga.')
                                }
                                disabled={busy}
                                title="Marcar como paga (recebi por fora)"
                                className="hover:bg-leaf-50 hover:text-leaf-700"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                onClick={() => setCanceling(charge)}
                                disabled={busy}
                                title="Cancelar fatura"
                                className="hover:bg-danger-50 hover:text-danger-600"
                              >
                                <Ban className="h-4 w-4" />
                              </IconButton>
                            </>
                          )}
                          {deletable && (
                            <IconButton
                              onClick={() => setDeleting(charge)}
                              disabled={busy}
                              title="Excluir cobrança definitivamente"
                              className="hover:bg-danger-50 hover:text-danger-600"
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {data.total > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-100 px-5 py-3 text-sm text-sand-600">
              <span>
                {data.total} cobrança{data.total > 1 ? 's' : ''} · página {page} de {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Nova cobrança"
        subtitle="Avulsa ou recorrente — o envio no vencimento é automático."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Cliente" hint="Digite o nome ou telefone e escolha uma sugestão.">
            {clients === null ? (
              <div className="flex items-center gap-2 py-2 text-sm text-sand-500">
                <Spinner className="h-4 w-4" /> Carregando clientes…
              </div>
            ) : (
              <div className="relative">
                <Input
                  value={clientSearch}
                  onChange={(event) => {
                    setClientSearch(event.target.value);
                    setClientId('');
                    setClientListOpen(true);
                  }}
                  onFocus={() => setClientListOpen(true)}
                  // Timeout: deixa o onMouseDown da opção rodar antes de fechar.
                  onBlur={() => setTimeout(() => setClientListOpen(false), 150)}
                  placeholder="Maria Souza"
                  autoComplete="off"
                  required
                />
                {clientListOpen && (
                  <ul className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-sand-200 bg-white py-1 shadow-float">
                    {filteredClients.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-sand-500">
                        Nenhum cliente encontrado. Cadastre-o na tela de Clientes.
                      </li>
                    ) : (
                      filteredClients.map((client) => (
                        <li key={client.id}>
                          <button
                            type="button"
                            onMouseDown={() => selectClient(client)}
                            className={cx(
                              'flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-primary-50',
                              client.id === clientId && 'bg-primary-50'
                            )}
                          >
                            <span className="font-semibold text-sand-900">{client.name}</span>
                            <span className="text-xs text-sand-500">
                              {formatPhoneBR(client.phone)}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label="Descrição">
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Mensalidade de julho"
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-sand-500">
                  R$
                </span>
                <Input
                  inputMode="numeric"
                  value={centsToInputText(amountCents)}
                  onChange={(event) => setAmountCents(inputTextToCents(event.target.value))}
                  className="money pl-10 text-right"
                />
              </div>
            </Field>
            <Field label="Vencimento">
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                required
              />
            </Field>
          </div>
          <Field
            label="Recorrência"
            hint="Nas recorrentes, o próximo ciclo é gerado automaticamente com o mesmo dia-âncora (dia 31 vira 28/29 em fevereiro e volta ao 31 depois)."
          >
            <Select
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value as Recurrence)}
            >
              <option value="NONE">Avulsa (uma vez)</option>
              <option value="WEEKLY">Semanal</option>
              <option value="MONTHLY">Mensal</option>
              <option value="YEARLY">Anual</option>
            </Select>
          </Field>

          {(recurrence === 'WEEKLY' || recurrence === 'MONTHLY') && (
            <Field
              label="Até qual mês/ano"
              hint="A recorrência para de gerar cobranças depois do fim deste mês."
            >
              <Input
                type="month"
                value={endMonth}
                min={dueDate.slice(0, 7)}
                onChange={(event) => setEndMonth(event.target.value)}
                required
              />
            </Field>
          )}
          {recurrence === 'YEARLY' && (
            <Field
              label="Até qual ano (opcional)"
              hint="Deixe em branco para renovar todo ano, sem limite."
            >
              <Input
                type="number"
                inputMode="numeric"
                min={Number(dueDate.slice(0, 4))}
                max={2100}
                value={endYear}
                onChange={(event) => setEndYear(event.target.value)}
                placeholder={String(Number(dueDate.slice(0, 4)) + 2)}
              />
            </Field>
          )}

          {formError && (
            <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-inset ring-danger-100">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Criar cobrança
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title="Editar cobrança"
        subtitle="Disponível enquanto a fatura está pendente."
      >
        <form onSubmit={submitEdit} className="space-y-4">
          <Field label="Descrição">
            <Input
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor">
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-sand-500">
                  R$
                </span>
                <Input
                  inputMode="numeric"
                  value={centsToInputText(editAmountCents)}
                  onChange={(event) =>
                    setEditAmountCents(inputTextToCents(event.target.value))
                  }
                  className="money pl-10 text-right"
                />
              </div>
            </Field>
            <Field label="Vencimento">
              <Input
                type="date"
                value={editDueDate}
                onChange={(event) => setEditDueDate(event.target.value)}
                required
              />
            </Field>
          </div>

          {editError && (
            <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-inset ring-danger-100">
              {editError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" loading={editSaving}>
              Salvar alterações
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={canceling !== null}
        onClose={() => setCanceling(null)}
        onConfirm={confirmCancel}
        loading={actingId === canceling?.id}
        title="Cancelar esta fatura?"
        confirmLabel="Cancelar fatura"
        description={
          canceling?.recurrence !== 'NONE'
            ? 'Esta fatura faz parte de uma série recorrente. Se for a última da série, a recorrência é encerrada e nenhum ciclo futuro será gerado.'
            : 'A fatura ficará marcada como cancelada e não será mais cobrada.'
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={actingId === deleting?.id}
        title="Excluir esta cobrança?"
        confirmLabel="Excluir cobrança"
        description="A cobrança será apagada definitivamente e sai do histórico. Essa ação não pode ser desfeita."
      />
    </div>
  );
}
