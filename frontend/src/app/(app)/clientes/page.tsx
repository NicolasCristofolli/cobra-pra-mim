'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Pencil, Plus, ScrollText, Search, StickyNote, Trash2, Users } from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Button,
  Card,
  ClientBadge,
  ConfirmDialog,
  EmptyState,
  Field,
  FilterChip,
  IconButton,
  IconInput,
  Input,
  Modal,
  Spinner,
  Textarea,
  Th,
  type BadgeVariant
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateBR, formatPhoneBR } from '@/lib/format';
import type { Client, ClientStatus } from '@/lib/types';

interface ClientForm {
  name: string;
  phone: string;
  email: string;
  document: string;
  notes: string;
}

const EMPTY_FORM: ClientForm = { name: '', phone: '', email: '', document: '', notes: '' };

// Cores casadas com os badges de status da tabela.
const STATUS_FILTERS: Array<{ value: ClientStatus; label: string; variant: BadgeVariant }> = [
  { value: 'ADIMPLENTE', label: 'Em dia', variant: 'success' },
  { value: 'INADIMPLENTE', label: 'Inadimplente', variant: 'danger' },
  { value: 'SEM_COBRANCAS', label: 'Sem cobrança', variant: 'neutral' }
];

export default function ClientesPage() {
  // useSearchParams exige um limite de Suspense no build estático do Next.
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      }
    >
      <ClientesContent />
    </Suspense>
  );
}

function ClientesContent() {
  const { push } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const [statusFilter, setStatusFilter] = useState<ClientStatus | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);

  // Busca vinda da barra global (?q=) — inclusive quando já estamos na página.
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<Client | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Cliente recém-criado: dispara o modal "deseja criar uma cobrança?".
  const [createdClient, setCreatedClient] = useState<Client | null>(null);

  const load = useCallback(async (search: string) => {
    // A busca do backend cobre nome, telefone, e-mail e CPF/CNPJ.
    const path = search ? `/clients?q=${encodeURIComponent(search)}` : '/clients';
    setClients(await api<Client[]>(path));
  }, []);

  // Busca com debounce de 300ms.
  useEffect(() => {
    const timer = setTimeout(() => {
      load(query).catch((error) => push('error', (error as Error).message));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, load, push]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(client: Client) {
    setEditing(client);
    setForm({
      name: client.name,
      phone: client.phone,
      email: client.email ?? '',
      document: client.document ?? '',
      notes: client.notes ?? ''
    });
    setFormError(null);
    setModalOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email || null,
      document: form.document,
      notes: form.notes || null
    };
    try {
      if (editing) {
        await api(`/clients/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        push('success', 'Cliente atualizado.');
      } else {
        const created = await api<Client>('/clients', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        setCreatedClient(created);
      }
      setModalOpen(false);
      await load(query);
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

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    try {
      const result = await api<{ ok: boolean; canceledCharges: number }>(
        `/clients/${deleting.id}`,
        { method: 'DELETE' }
      );
      push(
        'success',
        result.canceledCharges > 0
          ? `Cliente excluído. ${result.canceledCharges} fatura${
              result.canceledCharges > 1 ? 's' : ''
            } em aberto cancelada${result.canceledCharges > 1 ? 's' : ''}.`
          : 'Cliente excluído.'
      );
      setDeleting(null);
      await load(query);
    } catch (error) {
      push('error', (error as Error).message);
      setDeleting(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  const visibleClients =
    clients === null
      ? null
      : statusFilter
        ? clients.filter((client) => client.status === statusFilter)
        : clients;

  return (
    <div className="space-y-[18px]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[19px] font-bold tracking-tight text-sand-900">Clientes</h1>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Novo cliente
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2.5">
        <IconInput
          icon={Search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nome, e-mail ou CPF"
          className="w-full max-w-[280px]"
        />
        {STATUS_FILTERS.map(({ value, label, variant }) => (
          <FilterChip
            key={value}
            variant={variant}
            active={statusFilter === value}
            onClick={() => setStatusFilter((current) => (current === value ? null : value))}
          >
            {label}
          </FilterChip>
        ))}
      </div>

      {visibleClients === null ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : visibleClients.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title={
              query || statusFilter ? 'Nenhum cliente encontrado' : 'Nenhum cliente ainda'
            }
            description={
              query || statusFilter
                ? 'Tente outro termo de busca ou remova os filtros.'
                : 'Cadastre seu primeiro cliente para começar a cobrar no automático.'
            }
            action={
              query || statusFilter ? undefined : (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4" /> Cadastrar cliente
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
                  <Th>WhatsApp</Th>
                  <Th>Cobranças</Th>
                  <Th>Status</Th>
                  <Th>Cadastro</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {visibleClients.map((client) => (
                  <tr
                    key={client.id}
                    className="border-t border-sand-100 transition-colors hover:bg-primary-50/50"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={client.name} size="sm" />
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-bold text-sand-900">{client.name}</p>
                          {client.email && (
                            <p className="truncate text-xs text-sand-500">{client.email}</p>
                          )}
                          {client.notes && (
                            <p
                              className="mt-0.5 flex max-w-xs items-start gap-1 text-xs italic text-sand-400"
                              title={client.notes}
                            >
                              <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                              <span className="truncate">{client.notes}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] font-medium text-sand-600">
                      {formatPhoneBR(client.phone)}
                    </td>
                    <td className="px-5 py-3 text-xs text-sand-600">
                      <span className="font-bold text-sand-900">{client.openCharges}</span>{' '}
                      abertas
                      {client.overdueCharges > 0 && (
                        <>
                          {' · '}
                          <span className="font-bold text-danger-600">
                            {client.overdueCharges} vencida
                            {client.overdueCharges > 1 ? 's' : ''}
                          </span>
                        </>
                      )}
                      {' · '}
                      <span>{client.paidCharges} pagas</span>
                    </td>
                    <td className="px-5 py-3">
                      <ClientBadge status={client.status} />
                    </td>
                    <td className="px-5 py-3 text-[13px] font-medium text-sand-600">
                      {formatDateBR(client.createdAt?.slice(0, 10) ?? null)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-0.5">
                        <IconButton onClick={() => openEdit(client)} title="Editar">
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          onClick={() => setDeleting(client)}
                          title="Excluir"
                          className="hover:bg-danger-50 hover:text-danger-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar cliente' : 'Novo cliente'}
        subtitle="Nome, WhatsApp e CPF/CNPJ são obrigatórios."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nome">
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Nome completo"
              required
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="WhatsApp" hint="DDD + número. O DDI 55 é adicionado automaticamente.">
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
                placeholder="(11) 99999-0000"
                required
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="cliente@email.com"
              />
            </Field>
          </div>
          <Field label="CPF/CNPJ" hint="Obrigatório — o gateway usa o documento para emitir a cobrança.">
            <Input
              value={form.document}
              onChange={(event) => setForm({ ...form, document: event.target.value })}
              placeholder="000.000.000-00"
              required
            />
          </Field>
          <Field label="Observações">
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Ex.: prefere ser cobrada de manhã"
            />
          </Field>

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
              {editing ? 'Salvar alterações' : 'Salvar cliente'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirmação de cadastro com atalho para a primeira cobrança */}
      <Modal
        open={createdClient !== null}
        onClose={() => setCreatedClient(null)}
        title="Cliente cadastrado!"
        subtitle={createdClient?.name}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-leaf-50">
            <CheckCircle2 className="h-5 w-5 text-leaf-600" />
          </span>
          <p className="text-sm leading-relaxed text-sand-600">
            <span className="font-bold text-sand-900">{createdClient?.name}</span> já está na
            sua carteira. Quer aproveitar e criar a primeira cobrança para esse cliente agora?
          </p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreatedClient(null)}>
            Agora não
          </Button>
          <Button
            onClick={() => {
              if (!createdClient) return;
              router.push(`/cobrancas?novoCliente=${createdClient.id}`);
            }}
          >
            <ScrollText className="h-4 w-4" /> Criar cobrança
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        loading={deleteLoading}
        title={`Excluir ${deleting?.name ?? ''}?`}
        confirmLabel="Excluir cliente"
        description="As faturas em aberto deste cliente serão canceladas automaticamente. As faturas pagas permanecem no histórico financeiro, desvinculadas do cadastro."
      />
    </div>
  );
}
