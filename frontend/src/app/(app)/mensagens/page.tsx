'use client';

import { useEffect, useState } from 'react';
import { AlarmClock, BellRing, CheckCircle2, Clock, MessageSquareText, Send, ShieldCheck } from 'lucide-react';
import { useToast } from '@/components/toast';
import {
  Avatar,
  Button,
  Card,
  ChargeBadge,
  EmptyState,
  Field,
  Input,
  Select,
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
  '{link_pix}',
  '{link_fatura}'
] as const;

/** "3, 7" → [3, 7]. Devolve null se houver algo que não seja um dia de 1 a 60. */
function parseDays(text: string): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const day = Number(part);
    if (day < 1 || day > 60) return null;
    if (!days.includes(day)) days.push(day);
  }
  if (days.length > 5) return null;
  return days.sort((a, b) => a - b);
}

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
    link_pix: '00020126580014BR.GOV.BCB.PIX...DEMO',
    link_fatura: 'https://cobrapramim.cloud/f/3f9a…'
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
  const [reminderTemplate, setReminderTemplate] = useState('');
  const [overdueTemplate, setOverdueTemplate] = useState('');
  const [daysBefore, setDaysBefore] = useState('');
  const [daysAfter, setDaysAfter] = useState('');
  const [dailyLimit, setDailyLimit] = useState('150');
  const [sendHour, setSendHour] = useState(8);
  const [skipNonBusinessDays, setSkipNonBusinessDays] = useState(false);
  const [monthlyReportEnabled, setMonthlyReportEnabled] = useState(true);

  function hydrate(data: Settings) {
    setSettings(data);
    setMessageTemplate(data.messageTemplate);
    setPaidTemplate(data.paidTemplate);
    setReminderTemplate(data.reminderTemplate);
    setOverdueTemplate(data.overdueTemplate);
    setDaysBefore(data.reminderDaysBefore.join(', '));
    setDaysAfter(data.reminderDaysAfter.join(', '));
    setDailyLimit(String(data.dailyMessageLimit));
    setSendHour(data.sendHour);
    setSkipNonBusinessDays(data.skipNonBusinessDays);
    setMonthlyReportEnabled(data.monthlyReportEnabled);
  }
  const [saving, setSaving] = useState(false);
  const [sentLog, setSentLog] = useState<Charge[] | null>(null);

  useEffect(() => {
    api<Settings>('/settings')
      .then(hydrate)
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
    const reminderDaysBefore = parseDays(daysBefore);
    const reminderDaysAfter = parseDays(daysAfter);
    if (!reminderDaysBefore || !reminderDaysAfter) {
      push('error', 'Régua inválida: use até 5 números de 1 a 60 separados por vírgula (ex.: 3, 7).');
      return;
    }
    const dailyMessageLimit = Number(dailyLimit);
    if (!Number.isInteger(dailyMessageLimit) || dailyMessageLimit < 1 || dailyMessageLimit > 1000) {
      push('error', 'O limite diário precisa ser um número entre 1 e 1000.');
      return;
    }
    setSaving(true);
    try {
      // PUT parcial: só mensagens e régua — as chaves de gateway ficam intactas.
      const updated = await api<Settings>('/settings', {
        method: 'PUT',
        body: JSON.stringify({
          messageTemplate,
          paidTemplate,
          reminderTemplate,
          overdueTemplate,
          reminderDaysBefore,
          reminderDaysAfter,
          dailyMessageLimit,
          sendHour,
          skipNonBusinessDays,
          monthlyReportEnabled
        })
      });
      hydrate(updated);
      push('success', 'Alterações salvas.');
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
            Régua de cobrança e modelos das mensagens enviadas por WhatsApp.
          </p>
        </div>
        <Button size="sm" onClick={save} loading={saving}>
          Salvar alterações
        </Button>
      </header>

      {/* Régua de cobrança */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-50">
            <AlarmClock className="h-[15px] w-[15px] text-primary-600" />
          </span>
          <div>
            <h2 className="text-[13.5px] font-bold text-sand-900">Régua de cobrança</h2>
            <p className="text-xs text-sand-500">
              Quando cada cliente recebe mensagem. A cobrança do dia do vencimento sai sempre.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Lembrar antes do vencimento (dias)"
            hint="Ex.: 3 = lembrete 3 dias antes. Vazio = não lembrar antes."
          >
            <Input
              value={daysBefore}
              onChange={(event) => setDaysBefore(event.target.value)}
              placeholder="3"
              inputMode="numeric"
            />
          </Field>
          <Field
            label="Cobrar depois do vencimento (dias)"
            hint="Ex.: 3, 7 = lembretes com 3 e 7 dias de atraso. Vazio = não cobrar depois."
          >
            <Input
              value={daysAfter}
              onChange={(event) => setDaysAfter(event.target.value)}
              placeholder="3, 7"
              inputMode="numeric"
            />
          </Field>
          <Field
            label="Limite de mensagens por dia"
            hint="Protege seu número: ao atingir o limite, o restante sai no dia seguinte."
          >
            <Input
              value={dailyLimit}
              onChange={(event) => setDailyLimit(event.target.value.replace(/\D/g, ''))}
              placeholder="150"
              inputMode="numeric"
            />
          </Field>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-sand-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-leaf-600" />
          Faturas pagas ou canceladas saem da régua na hora, e clientes marcados com “Não enviar
          mensagens” nunca recebem.
        </p>
      </Card>

      {/* Horário de envio, dias úteis e resumo mensal */}
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-50">
            <Clock className="h-[15px] w-[15px] text-primary-600" />
          </span>
          <div>
            <h2 className="text-[13.5px] font-bold text-sand-900">Envio e relatórios</h2>
            <p className="text-xs text-sand-500">
              Quando as mensagens automáticas saem e o que você recebe por e-mail.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field
            label="Horário de envio"
            hint="As mensagens do dia saem a partir desta hora (horário de Brasília)."
          >
            <Select value={sendHour} onChange={(event) => setSendHour(Number(event.target.value))}>
              {Array.from({ length: 15 }, (_, index) => index + 6).map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-sand-50 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-sand-300 text-primary-600 focus:ring-leaf-500"
              checked={skipNonBusinessDays}
              onChange={(event) => setSkipNonBusinessDays(event.target.checked)}
            />
            <span className="text-[13px] leading-snug text-sand-700">
              <span className="font-semibold text-sand-900">Enviar só em dias úteis</span>
              <br />
              Nada sai em sábados, domingos e feriados nacionais. A cobrança que vence nesses dias
              é enviada no próximo dia útil.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-sand-50 px-3 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-sand-300 text-primary-600 focus:ring-leaf-500"
              checked={monthlyReportEnabled}
              onChange={(event) => setMonthlyReportEnabled(event.target.checked)}
            />
            <span className="text-[13px] leading-snug text-sand-700">
              <span className="font-semibold text-sand-900">Resumo mensal por e-mail</span>
              <br />
              No começo de cada mês, quanto você recebeu no mês anterior e quanto está em atraso.
            </span>
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-50">
              <BellRing className="h-[15px] w-[15px] text-primary-600" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-bold text-sand-900">Lembrete antes do vencimento</h2>
              <p className="text-xs text-sand-500">Enviado nos dias configurados na régua.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field>
              <Textarea
                rows={6}
                value={reminderTemplate}
                onChange={(event) => setReminderTemplate(event.target.value)}
              />
            </Field>
            <VariableChips
              onPick={(variable) =>
                setReminderTemplate((current) => `${current} ${variable}`.trimStart())
              }
            />
            <WhatsAppPreview text={renderPreview(reminderTemplate)} />
          </div>
        </Card>

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
            <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-danger-50">
              <AlarmClock className="h-[15px] w-[15px] text-danger-600" />
            </span>
            <div>
              <h2 className="text-[13.5px] font-bold text-sand-900">Cobrança em atraso</h2>
              <p className="text-xs text-sand-500">Enviada depois do vencimento, nos dias da régua.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Field>
              <Textarea
                rows={6}
                value={overdueTemplate}
                onChange={(event) => setOverdueTemplate(event.target.value)}
              />
            </Field>
            <VariableChips
              onPick={(variable) =>
                setOverdueTemplate((current) => `${current} ${variable}`.trimStart())
              }
            />
            <WhatsAppPreview text={renderPreview(overdueTemplate)} />
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
        <code className="font-mono">{'{descricao}'}</code>,{' '}
        <code className="font-mono">{'{link_pix}'}</code> (copia-e-cola do Pix) e{' '}
        <code className="font-mono">{'{link_fatura}'}</code> (página da fatura com QR Code).
      </p>
    </div>
  );
}
