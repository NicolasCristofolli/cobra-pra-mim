import { query, queryOne } from '../db';
import { env } from '../config/env';
import { addDaysISO, formatDateBR, parseISODate, toISODate, todayISO } from '../lib/dates';
import { formatBRL } from '../lib/format';
import type { AppDeps } from './deps';
import type { MailMessage } from './mailer';
import { findAccessByUser } from './subscription/subscription.repo';

/**
 * E-mails do ciclo de vida da conta:
 *  - TRIAL_ENDING: o teste grátis acaba em até 2 dias;
 *  - TRIAL_ENDED: o teste acabou e a conta ficou bloqueada;
 *  - PAYMENT_OVERDUE: a mensalidade venceu e não foi paga;
 *  - MONTHLY_REPORT: resumo do mês anterior (services/…/sendMonthlyReports).
 *
 * Cada ocorrência sai UMA vez: a linha em lifecycle_emails (user, kind, ref) é
 * gravada antes do envio e apagada se o envio falhar, para tentar de novo
 * na próxima hora.
 */

export type LifecycleKind = 'TRIAL_ENDING' | 'TRIAL_ENDED' | 'PAYMENT_OVERDUE' | 'MONTHLY_REPORT';

export interface LifecycleReport {
  trialEnding: number;
  trialEnded: number;
  paymentOverdue: number;
  failed: number;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const firstNameOf = (name: string) => name.split(' ')[0] ?? name;

const siteUrl = (path: string) => `${env.frontendOrigin.replace(/\/$/, '')}${path}`;

/** Monta as versões texto e HTML de um e-mail simples com um botão. */
function buildEmail(input: {
  to: string;
  subject: string;
  name: string;
  paragraphs: string[];
  cta: { label: string; url: string };
  footnote?: string;
}): MailMessage {
  const first = firstNameOf(input.name);
  return {
    to: input.to,
    subject: input.subject,
    text:
      `Olá, ${first}!\n\n` +
      input.paragraphs.join('\n\n') +
      `\n\n${input.cta.label}: ${input.cta.url}` +
      (input.footnote ? `\n\n${input.footnote}` : ''),
    html:
      `<p>Olá, ${escapeHtml(first)}!</p>` +
      input.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`).join('') +
      `<p><a href="${input.cta.url}" style="display:inline-block;padding:12px 20px;background:#3545bc;` +
      `color:#fff;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(input.cta.label)}</a></p>` +
      (input.footnote ? `<p style="color:#666">${escapeHtml(input.footnote)}</p>` : '')
  };
}

/**
 * Envia o e-mail se esta ocorrência ainda não foi enviada. Devolve
 * 'sent', 'skipped' (já enviado antes) ou 'failed'.
 */
async function sendOnce(
  deps: Pick<AppDeps, 'mailer'>,
  userId: string,
  kind: LifecycleKind,
  ref: string,
  message: MailMessage
): Promise<'sent' | 'skipped' | 'failed'> {
  const claimed = await queryOne<{ user_id: string }>(
    `INSERT INTO lifecycle_emails (user_id, kind, ref) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, kind, ref) DO NOTHING
     RETURNING user_id`,
    [userId, kind, ref]
  );
  if (!claimed) return 'skipped';
  try {
    await deps.mailer.send(message);
    return 'sent';
  } catch (error) {
    console.error(`[lifecycle] falha ao enviar ${kind} para ${userId}:`, error);
    await query('DELETE FROM lifecycle_emails WHERE user_id = $1 AND kind = $2 AND ref = $3', [
      userId,
      kind,
      ref
    ]).catch(() => undefined);
    return 'failed';
  }
}

interface TrialRow {
  id: string;
  name: string;
  email: string;
  trial_ends_at: Date;
  trial_end_date: string;
}

// Só contas de verdade: e-mail confirmado, não-admin, em teste e que ainda
// não iniciaram o pagamento (quem já está no checkout não precisa do lembrete).
const TRIAL_SELECT = `
  SELECT u.id, u.name, u.email, s.trial_ends_at,
         to_char(s.trial_ends_at AT TIME ZONE $2, 'YYYY-MM-DD') AS trial_end_date
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
   WHERE s.status = 'TRIALING'
     AND s.gateway_subscription_id IS NULL
     AND s.trial_ends_at IS NOT NULL
     AND u.role = 'USER'
     AND u.email_verified_at IS NOT NULL`;

export async function runLifecycleEmails(
  deps: Pick<AppDeps, 'mailer'>,
  now: Date = new Date()
): Promise<LifecycleReport> {
  const report: LifecycleReport = { trialEnding: 0, trialEnded: 0, paymentOverdue: 0, failed: 0 };
  const count = (result: 'sent' | 'skipped' | 'failed', key: keyof Omit<LifecycleReport, 'failed'>) => {
    if (result === 'sent') report[key]++;
    else if (result === 'failed') report.failed++;
  };
  const plansUrl = siteUrl('/planos');

  // 1) Teste acabando em até 2 dias.
  const ending = await query<TrialRow>(
    `${TRIAL_SELECT}
       AND s.trial_ends_at > $1
       AND s.trial_ends_at <= $1::timestamptz + interval '2 days'`,
    [now, env.appTz]
  );
  for (const row of ending) {
    count(
      await sendOnce(
        deps,
        row.id,
        'TRIAL_ENDING',
        row.trial_end_date,
        buildEmail({
          to: row.email,
          subject: 'Seu teste grátis termina em breve — Cobra pra mim',
          name: row.name,
          paragraphs: [
            `Seu teste grátis do Cobra pra mim termina em ${formatDateBR(row.trial_end_date)}.`,
            'Para suas cobranças continuarem saindo sozinhas no WhatsApp, escolha um plano antes dessa data. ' +
              'Seus clientes, cobranças e configurações ficam exatamente como estão.'
          ],
          cta: { label: 'Escolher meu plano', url: plansUrl },
          footnote: 'Sem plano, as mensagens automáticas param no fim do teste.'
        })
      ),
      'trialEnding'
    );
  }

  // 2) Teste encerrado nos últimos 3 dias (depois disso, não insiste).
  const ended = await query<TrialRow>(
    `${TRIAL_SELECT}
       AND s.trial_ends_at <= $1
       AND s.trial_ends_at > $1::timestamptz - interval '3 days'`,
    [now, env.appTz]
  );
  for (const row of ended) {
    count(
      await sendOnce(
        deps,
        row.id,
        'TRIAL_ENDED',
        row.trial_end_date,
        buildEmail({
          to: row.email,
          subject: 'Seu teste grátis terminou — Cobra pra mim',
          name: row.name,
          paragraphs: [
            'Seu teste grátis do Cobra pra mim terminou e as cobranças automáticas estão pausadas.',
            'Seus clientes, cobranças e configurações continuam salvos. Assim que você escolher um plano, ' +
              'o envio volta de onde parou.'
          ],
          cta: { label: 'Reativar minha conta', url: plansUrl }
        })
      ),
      'trialEnded'
    );
  }

  // 3) Mensalidade vencida e não paga (a assinatura entra em atraso pelo
  //    webhook do Asaas; a conta só bloqueia depois da carência).
  const overdue = await query<{
    id: string;
    name: string;
    email: string;
    gateway_payment_id: string;
    amount_cents: number;
    due_date: string;
    checkout_url: string | null;
  }>(
    `SELECT DISTINCT ON (u.id)
            u.id, u.name, u.email, sp.gateway_payment_id, sp.amount_cents, sp.due_date, sp.checkout_url
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       JOIN subscription_payments sp ON sp.subscription_id = s.id AND sp.status = 'OVERDUE'
      WHERE s.status = 'PAST_DUE'
        AND u.role = 'USER'
        AND u.email_verified_at IS NOT NULL
        AND sp.due_date > ($1::timestamptz AT TIME ZONE $2)::date - 30
      ORDER BY u.id, sp.due_date DESC`,
    [now, env.appTz]
  );
  for (const row of overdue) {
    count(
      await sendOnce(
        deps,
        row.id,
        'PAYMENT_OVERDUE',
        row.gateway_payment_id,
        buildEmail({
          to: row.email,
          subject: 'Não identificamos o pagamento da sua assinatura — Cobra pra mim',
          name: row.name,
          paragraphs: [
            `A mensalidade do Cobra pra mim de ${formatBRL(row.amount_cents)}, com vencimento em ` +
              `${formatDateBR(row.due_date)}, ainda não foi paga.`,
            'Sua conta continua funcionando por alguns dias. Depois disso, as cobranças automáticas ' +
              'dos seus clientes são pausadas até a regularização.'
          ],
          cta: { label: 'Pagar agora', url: plansUrl },
          footnote: 'Se você já pagou, desconsidere este e-mail: a confirmação pode levar algumas horas.'
        })
      ),
      'paymentOverdue'
    );
  }

  return report;
}

/* ---------------- Resumo mensal ---------------- */

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro'
];

/** Primeiro e último dia do mês anterior ao de `today`. */
export function previousMonth(today: string): { first: string; last: string; label: string; ref: string } {
  const { y, m } = parseISODate(today);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const first = toISODate(year, month, 1);
  const last = addDaysISO(toISODate(y, m, 1), -1);
  return {
    first,
    last,
    label: `${MONTH_NAMES[month - 1]} de ${year}`,
    ref: first.slice(0, 7)
  };
}

/**
 * Resumo do mês anterior para o dono da conta: quanto recebeu, quanto ficou
 * em atraso. Sai nos primeiros dias do mês, uma vez por conta, e só para
 * contas com movimento (ninguém recebe um e-mail de zeros).
 */
export async function sendMonthlyReports(
  deps: Pick<AppDeps, 'mailer'>,
  today: string = todayISO()
): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  // Só nos 3 primeiros dias do mês (margem para o servidor ter ficado fora no dia 1).
  if (parseISODate(today).d > 3) return result;
  const month = previousMonth(today);

  const rows = await query<{
    id: string;
    name: string;
    email: string;
    paid_count: string;
    paid_cents: string;
    net_cents: string;
    due_count: string;
    overdue_count: string;
    overdue_cents: string;
  }>(
    `SELECT u.id, u.name, u.email,
            COUNT(ch.id) FILTER (WHERE ch.status = 'PAID'
              AND (ch.paid_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date) AS paid_count,
            COALESCE(SUM(ch.amount_cents) FILTER (WHERE ch.status = 'PAID'
              AND (ch.paid_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date), 0)::bigint AS paid_cents,
            COALESCE(SUM(COALESCE(ch.net_amount_cents, ch.amount_cents)) FILTER (WHERE ch.status = 'PAID'
              AND (ch.paid_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date), 0)::bigint AS net_cents,
            COUNT(ch.id) FILTER (WHERE ch.status <> 'CANCELED'
              AND ch.due_date BETWEEN $1::date AND $2::date) AS due_count,
            COUNT(ch.id) FILTER (WHERE ch.status = 'OVERDUE') AS overdue_count,
            COALESCE(SUM(ch.amount_cents) FILTER (WHERE ch.status = 'OVERDUE'), 0)::bigint AS overdue_cents
       FROM users u
       JOIN settings st ON st.user_id = u.id AND st.monthly_report_enabled
       LEFT JOIN charges ch ON ch.user_id = u.id
      WHERE u.email_verified_at IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM lifecycle_emails le
               WHERE le.user_id = u.id AND le.kind = 'MONTHLY_REPORT' AND le.ref = $4
            )
      GROUP BY u.id`,
    [month.first, month.last, env.appTz, month.ref]
  );

  for (const row of rows) {
    const paidCount = Number(row.paid_count);
    const overdueCount = Number(row.overdue_count);
    if (paidCount === 0 && overdueCount === 0 && Number(row.due_count) === 0) continue;
    // Conta bloqueada não recebe relatório (já recebe os avisos de assinatura).
    if ((await findAccessByUser(row.id)).state === 'BLOCKED') continue;

    const paragraphs = [
      paidCount > 0
        ? `Em ${month.label} você recebeu ${formatBRL(Number(row.paid_cents))} em ${paidCount} ` +
          `fatura${paidCount > 1 ? 's' : ''} pelo Cobra pra mim` +
          (Number(row.net_cents) !== Number(row.paid_cents)
            ? ` (${formatBRL(Number(row.net_cents))} líquidos das taxas do gateway).`
            : '.')
        : `Em ${month.label} nenhuma fatura foi paga pelo Cobra pra mim.`,
      overdueCount > 0
        ? `Hoje você tem ${overdueCount} fatura${overdueCount > 1 ? 's' : ''} em atraso, somando ` +
          `${formatBRL(Number(row.overdue_cents))}. Os lembretes automáticos continuam ativos.`
        : 'Você não tem nenhuma fatura em atraso. 🎉'
    ];
    const outcome = await sendOnce(
      deps,
      row.id,
      'MONTHLY_REPORT',
      month.ref,
      buildEmail({
        to: row.email,
        subject: `Seu resumo de ${month.label} — Cobra pra mim`,
        name: row.name,
        paragraphs,
        cta: { label: 'Abrir meu painel', url: siteUrl('/dashboard') },
        footnote: 'Para não receber este resumo, desative em Mensagens > Envio e relatórios.'
      })
    );
    if (outcome === 'sent') result.sent++;
    else if (outcome === 'failed') result.failed++;
  }
  return result;
}
