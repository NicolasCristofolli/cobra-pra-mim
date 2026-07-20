'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, MessageSquareText, Send } from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Button,
  Card,
  ChargeBadge,
  EmptyState,
  Field,
  Spinner,
  Textarea
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatBRL, formatDateBR, formatDateTimeBR } from '@/lib/format';
import type { Charge, ChargeList, Settings } from '@/lib/types';

const TEMPLATE_VARS = [
  '{nome_cliente}',
  '{valor}',
  '{data_vencimento}',
  '{descricao}',
  '{link_pix}'
] as const;

/** Preview local com os mesmos placeholders do backend. */
function renderPreview(template: string): string {
  const due = new Date();
  due.setDate(due.getDate() + 3);
  const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
    due.getDate()
  ).padStart(2, '0')}`;
  const sample: Record<string, string> = {
    nome_cliente: 'Maria Souza',
    valor: formatBRL(15000),
    data_vencimento: formatDateBR(iso),
    descricao: 'Mensalidade',
    link_pix: '00020126580014BR.GOV.BCB.PIX...DEMO'
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => sample[key] ?? '');
}

function WhatsAppPreview({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-[#e5ddd5] p-4">
      <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#dcf8c6] px-3.5 py-2.5 shadow-card">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-sand-900">{text}</p>
      </div>
    </div>
  );
}

function VariableChips({ onPick }: { onPick: (variable: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {TEMPLATE_VARS.map((variable) => (
        <button
          key={variable}
          type="button"
          onClick={() => onPick(variable)}
          className="rounded-full bg-primary-50 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-700 ring-1 ring-inset ring-primary-500/20 hover:bg-primary-100"
        >
          {variable}
        </button>
      ))}
    </div>
  );
}

export default function MensagensPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messageTemplate, setMessageTemplate] = useState('');
  const [paidTemplate, setPaidTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [sentLog, setSentLog] = useState<Charge[] | null>(null);

  useEffect(() => {
    api<Settings>('/settings')
      .then((data) => {
        setSettings(data);
        setMessageTemplate(data.messageTemplate);
        setPaidTemplate(data.paidTemplate);
      })
      .catch((error) => push('error', (error as Error).message));

    // Histórico real: cobranças que já receberam notificação no WhatsApp.
    api<ChargeList>('/charges?page=1&pageSize=50')
      .then((list) =>
        setSentLog(
          list.items
            .filter((charge) => charge.lastNotifiedAt !== null)
            .sort((a, b) => (b.lastNotifiedAt ?? '').localeCompare(a.lastNotifiedAt ?? ''))
            .slice(0, 8)
        )
      )
      .catch((error) => push('error', (error as Error).message));
  }, [push]);

  async function save() {
    setSaving(true);
    try {
      // PUT parcial: só os templates — as chaves de gateway ficam intactas.
      const updated = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({ messageTemplate, paidTemplate })
      });
      setSettings(updated);
      setMessageTemplate(updated.messageTemplate);
      setPaidTemplate(updated.paidTemplate);
      push('success', 'Templates salvos.');
    } catch (error) {
      push('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!settings || sentLog === null) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-sand-900">Mensagens</h1>
          <p className="mt-1 text-[13px] text-sand-600">
            Templates automáticos enviados por WhatsApp.
          </p>
        </div>
        <Button size="sm" onClick={save} loading={saving}>
          Salvar templates
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-50">
              <Clock className="h-[15px] w-[15px] text-primary-600" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-bold text-sand-900">Cobrança</h2>
              <p className="text-xs text-sand-500">Enviada no dia do vencimento.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field>
              <Textarea
                rows={6}
                value={messageTemplate}
                onChange={(event) => setMessageTemplate(event.target.value)}
              />
            </Field>
            <VariableChips
              onPick={(variable) =>
                setMessageTemplate((current) => `${current} ${variable}`.trimStart())
              }
            />
            <WhatsAppPreview text={renderPreview(messageTemplate)} />
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-leaf-50">
              <CheckCircle2 className="h-[15px] w-[15px] text-leaf-600" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-bold text-sand-900">
                Confirmação de pagamento
              </h2>
              <p className="text-xs text-sand-500">Enviada quando o Pix cai.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field>
              <Textarea
                rows={6}
                value={paidTemplate}
                onChange={(event) => setPaidTemplate(event.target.value)}
              />
            </Field>
            <VariableChips
              onPick={(variable) =>
                setPaidTemplate((current) => `${current} ${variable}`.trimStart())
              }
            />
            <WhatsAppPreview text={renderPreview(paidTemplate)} />
          </div>
        </Card>
      </div>

      <Card>
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-[13.5px] font-bold text-sand-900">Enviadas recentemente</h2>
        </div>
        {sentLog.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Nenhum envio ainda"
            description="Quando uma cobrança for enviada por WhatsApp, ela aparece aqui com data e hora."
          />
        ) : (
          <div className="flex flex-col">
            {sentLog.map((charge) => (
              <div
                key={charge.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-sand-100 px-5 py-3"
              >
                <Avatar name={charge.clientName ?? '?'} size="sm" />
                <div className="min-w-[140px] flex-1">
                  <p className="truncate text-[12.5px] font-bold text-sand-900">
                    {charge.clientName ?? 'Cliente excluído'}
                  </p>
                  <p className="truncate text-[11.5px] text-sand-500">
                    {charge.description} · {formatBRL(charge.amountCents)}
                  </p>
                </div>
                <ChargeBadge status={charge.status} />
                <span className="shrink-0 text-xs font-medium text-sand-400 sm:w-32 sm:text-right">
                  {formatDateTimeBR(charge.lastNotifiedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p className="flex items-center gap-2 text-xs text-sand-500">
        <MessageSquareText className="h-4 w-4 text-primary-600" />
        Variáveis: <code className="font-mono">{'{nome_cliente}'}</code>,{' '}
        <code className="font-mono">{'{valor}'}</code>,{' '}
        <code className="font-mono">{'{data_vencimento}'}</code>,{' '}
        <code className="font-mono">{'{descricao}'}</code> e{' '}
        <code className="font-mono">{'{link_pix}'}</code> (copia-e-cola do Pix).
      </p>
    </div>
  );
}
