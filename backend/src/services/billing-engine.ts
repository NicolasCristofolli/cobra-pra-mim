import { query, queryOne } from '../db';
import { env } from '../config/env';
import { nextDueDate, parseISODate, todayISO } from '../lib/dates';
import { normalizePhone } from '../lib/format';
import {
  buildChargeVars,
  DEFAULT_OVERDUE_TEMPLATE,
  DEFAULT_REMINDER_TEMPLATE,
  renderTemplate
} from '../lib/template';
import {
  findChargeById,
  markNotified,
  markReminderSent,
  saveGatewayData,
  type ChargeRow
} from '../modules/charges/charges.repo';
import {
  findSettingsByUserId,
  type SettingsRow
} from '../modules/settings/settings.routes';
import type { AppDeps } from './deps';
import type { GatewayPort } from './gateway';
import { findAccessByUser } from './subscription/subscription.repo';

export interface CycleReport {
  today: string;
  generated: number;      // faturas recorrentes materializadas
  overdueMarked: number;  // pendentes que viraram atrasadas
  notified: number;       // mensagens enviadas (cobrança do dia + lembretes da régua)
  notifyFailed: number;   // falhas de envio/gateway (ficam para retry/manual)
  usersSkipped: number;   // usuários sem settings (nunca deveria ocorrer)
  blockedSkipped: number; // faturas de usuários com assinatura bloqueada (não enviadas)
  limitSkipped: number;   // não enviadas porque o usuário atingiu o limite diário do chip
  disconnectedSkipped: number; // não enviadas porque o WhatsApp do usuário está desconectado
}

/**
 * Que mensagem a fatura recebe hoje:
 *  - CHARGE: a cobrança principal (dia do vencimento, ou atrasada que nunca
 *    recebeu mensagem);
 *  - REMINDER: lembrete ANTES do vencimento (régua);
 *  - OVERDUE_REMINDER: lembrete DEPOIS do vencimento (régua).
 */
export type NotifyStage = 'CHARGE' | 'REMINDER' | 'OVERDUE_REMINDER';

/** Quantos usuários (chips) o ciclo notifica ao mesmo tempo. */
const NOTIFY_CONCURRENCY = 5;

let stopRequested = false;
let runningCycle: Promise<unknown> | null = null;

/**
 * Pede para o ciclo em andamento parar no próximo ponto seguro (entre dois
 * envios) e espera ele terminar. Usado no desligamento do processo, para um
 * restart no meio do ciclo não cortar um envio pela metade (mensagem enviada
 * mas não registrada = reenvio em duplicidade no dia seguinte).
 */
export async function stopBillingCycle(): Promise<void> {
  stopRequested = true;
  if (runningCycle) await runningCycle.catch(() => undefined);
}

interface NotifiableRow extends ChargeRow {
  // O JOIN interno com clients garante cliente presente nas notificáveis.
  client_id: string;
  client_name: string;
  client_phone: string;
  client_email: string | null;
  client_document: string | null;
}

const NOTIFIABLE_SELECT = `
  SELECT ch.*, cl.name      AS client_name,
         cl.phone           AS client_phone,
         cl.email           AS client_email,
         cl.document        AS client_document,
         cl.whatsapp_opt_out AS client_opt_out
    FROM charges ch
    JOIN clients cl ON cl.id = ch.client_id`;

/** Dias de `from` até `to` (positivo se `to` é depois). */
function daysBetween(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

function stageOf(charge: ChargeRow, today: string): NotifyStage {
  if (charge.last_notified_at === null && charge.due_date <= today) return 'CHARGE';
  return charge.due_date > today ? 'REMINDER' : 'OVERDUE_REMINDER';
}

async function insertLog(entry: {
  userId: string;
  chargeId: string | null;
  kind: NotifyStage | 'PAYMENT_CONFIRMED';
  phone: string;
  message: string;
  success: boolean;
  error?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO notification_logs (user_id, charge_id, kind, phone, message, success, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.chargeId,
      entry.kind,
      entry.phone,
      entry.message,
      entry.success,
      entry.error ?? null
    ]
  );
}

/**
 * Garante que a fatura tem um Pix pagável no gateway. Atualiza o registro e
 * devolve os campos novos. Lança se o gateway falhar (o chamador decide o destino).
 */
async function ensurePix(
  gateway: GatewayPort,
  charge: NotifiableRow
): Promise<Pick<ChargeRow, 'pix_copy_paste' | 'pix_qr_code_url' | 'invoice_url' | 'gateway_charge_id'>> {
  const today = todayISO();
  // Gateway cujo Pix morre no fim do dia do vencimento (Mercado Pago): uma
  // fatura atrasada com Pix gerado em outro dia precisa de um Pix novo.
  const expired =
    gateway.pixExpiresOnDueDate === true &&
    charge.due_date < today &&
    (charge.pix_generated_on === null || charge.pix_generated_on < today);

  if (charge.gateway_charge_id && !expired) {
    return {
      gateway_charge_id: charge.gateway_charge_id,
      pix_copy_paste: charge.pix_copy_paste,
      pix_qr_code_url: charge.pix_qr_code_url,
      invoice_url: charge.invoice_url
    };
  }

  // Fatura já vencida: os gateways recusam Pix com vencimento no passado,
  // então o Pix nasce vencendo hoje (a fatura continua com a data original).
  const result = await gateway.createPixCharge({
    amountCents: charge.amount_cents,
    dueDate: charge.due_date < today ? today : charge.due_date,
    description: charge.description,
    externalReference: charge.id,
    client: {
      id: charge.client_id,
      name: charge.client_name,
      phone: charge.client_phone,
      email: charge.client_email,
      document: charge.client_document
    }
  });

  await saveGatewayData(charge.id, {
    gatewayChargeId: result.gatewayChargeId,
    pixCopyPaste: result.pixCopyPaste,
    pixQrCodeUrl: result.pixQrCodeUrl,
    invoiceUrl: result.invoiceUrl
  });

  return {
    gateway_charge_id: result.gatewayChargeId,
    pix_copy_paste: result.pixCopyPaste,
    pix_qr_code_url: result.pixQrCodeUrl,
    invoice_url: result.invoiceUrl
  };
}

/**
 * PASSO 1 — Materializa os próximos ciclos de séries recorrentes.
 *
 * Idempotente por construção: UNIQUE(series_id, due_date) + flag
 * next_generated. Se o servidor ficou dias fora do ar, o laço interno gera a
 * cadeia inteira até o vencimento cair no futuro (catch-up).
 */
async function spawnRecurringCharges(today: string): Promise<number> {
  const dueSeries = await query<ChargeRow>(
    `SELECT * FROM charges
      WHERE recurrence <> 'NONE'
        AND next_generated = FALSE
        AND status <> 'CANCELED'
        -- Cliente excluído (soft delete: deleted_at preenchido) pausa a série.
        -- Se a exclusão for desfeita, o laço abaixo recupera os ciclos perdidos.
        AND EXISTS (
              SELECT 1 FROM clients cl
               WHERE cl.id = charges.client_id AND cl.deleted_at IS NULL
            )
        AND due_date <= $1
      ORDER BY due_date`,
    [today]
  );

  let generated = 0;
  for (const head of dueSeries) {
    let current = head;
    for (let guard = 0; guard < 120 && current.due_date <= today; guard++) {
      const nextDue = nextDueDate(current.due_date, current.recurrence, current.anchor_day);

      // Data limite da série (end_date): o próximo ciclo cairia depois do
      // prazo → a série terminou. Marca a cabeça como processada e para.
      if (current.recurrence_end_date && nextDue > current.recurrence_end_date) {
        await query(
          `UPDATE charges SET next_generated = TRUE, updated_at = now() WHERE id = $1`,
          [current.id]
        );
        break;
      }

      const inserted = await queryOne<ChargeRow>(
        `INSERT INTO charges
           (user_id, client_id, series_id, description, amount_cents, due_date,
            recurrence, anchor_day, recurrence_end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (series_id, due_date) DO NOTHING
         RETURNING *`,
        [
          current.user_id,
          current.client_id,
          current.series_id,
          current.description,
          current.amount_cents,
          nextDue,
          current.recurrence,
          current.anchor_day,
          current.recurrence_end_date
        ]
      );

      await query(
        `UPDATE charges SET next_generated = TRUE, updated_at = now() WHERE id = $1`,
        [current.id]
      );

      const nextRow =
        inserted ??
        (await queryOne<ChargeRow>(
          'SELECT * FROM charges WHERE series_id = $1 AND due_date = $2',
          [current.series_id, nextDue]
        ));
      if (inserted) generated++;
      if (!nextRow) break;
      current = nextRow;
    }
  }
  return generated;
}

/** PASSO 2 — Pendentes/enviadas com vencimento passado viram OVERDUE. */
async function markOverdue(today: string): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE charges
        SET status = 'OVERDUE', updated_at = now()
      WHERE status IN ('PENDING', 'SENT') AND due_date < $1
      RETURNING id`,
    [today]
  );
  return result.length;
}

/**
 * PASSO 3 — Quem recebe mensagem hoje:
 *  a) cobrança principal: vence HOJE, ou está atrasada e nunca recebeu
 *     mensagem (resiliência a falhas de envio em dias anteriores);
 *  b) régua, antes do vencimento: faltam exatamente N dias, com N em
 *     settings.reminder_days_before;
 *  c) régua, depois do vencimento: passaram exatamente N dias, com N em
 *     settings.reminder_days_after (só para quem já recebeu a principal).
 * Cada lembrete da régua sai uma única vez (charge_reminders). Clientes
 * excluídos ou que pediram para não receber mensagens ficam de fora.
 */
async function findChargesToNotify(today: string): Promise<NotifiableRow[]> {
  return query<NotifiableRow>(
    `${NOTIFIABLE_SELECT}
       LEFT JOIN settings s ON s.user_id = ch.user_id
      WHERE cl.deleted_at IS NULL
        AND cl.whatsapp_opt_out = FALSE
        AND (
              ( ch.last_notified_at IS NULL
                AND ( (ch.status = 'PENDING' AND ch.due_date = $1::date)
                      OR ch.status = 'OVERDUE' ) )
           OR ( ch.status IN ('PENDING', 'SENT')
                AND ch.due_date > $1::date
                AND (ch.due_date - $1::date) = ANY (s.reminder_days_before)
                AND NOT EXISTS (
                      SELECT 1 FROM charge_reminders r
                       WHERE r.charge_id = ch.id AND r.offset_days = ($1::date - ch.due_date)
                    ) )
           OR ( ch.status = 'OVERDUE'
                AND ch.last_notified_at IS NOT NULL
                AND ($1::date - ch.due_date) = ANY (s.reminder_days_after)
                AND NOT EXISTS (
                      SELECT 1 FROM charge_reminders r
                       WHERE r.charge_id = ch.id AND r.offset_days = ($1::date - ch.due_date)
                    ) )
            )
      ORDER BY ch.user_id, ch.due_date`,
    [today]
  );
}

interface SendOutcome {
  sent: boolean;
  /** true = a mensagem chegou a ser disparada contra a Evolution (mesmo que
   * tenha falhado) — é o que conta para o espaçamento anti-spam do ciclo. */
  attempted: boolean;
  reason?: string;
}

function templateFor(settings: SettingsRow, stage: NotifyStage): string {
  if (stage === 'REMINDER') return settings.reminder_template ?? DEFAULT_REMINDER_TEMPLATE;
  if (stage === 'OVERDUE_REMINDER') return settings.overdue_template ?? DEFAULT_OVERDUE_TEMPLATE;
  return settings.message_template;
}

async function sendChargeMessage(
  deps: AppDeps,
  settings: SettingsRow,
  charge: NotifiableRow,
  stage: NotifyStage,
  today: string
): Promise<SendOutcome> {
  // 1) Pix primeiro: se há gateway configurado, a mensagem DEVE ir com o
  //    copia-e-cola. Falha de gateway → não envia mensagem "manca"; fica
  //    para retry (last_notified_at continua NULL) e o erro é auditável.
  const gateway = deps.gatewayFactory(settings);
  let pixFields = {
    pix_copy_paste: charge.pix_copy_paste,
    invoice_url: charge.invoice_url
  };
  if (gateway) {
    try {
      const ensured = await ensurePix(gateway, charge);
      pixFields = {
        pix_copy_paste: ensured.pix_copy_paste,
        invoice_url: ensured.invoice_url
      };
    } catch (error) {
      const reason = `Falha ao gerar Pix no gateway: ${(error as Error).message}`;
      await insertLog({
        userId: charge.user_id,
        chargeId: charge.id,
        kind: stage,
        phone: charge.client_phone,
        message: '(mensagem não montada — falha no gateway)',
        success: false,
        error: reason
      });
      return { sent: false, attempted: false, reason };
    }
  }

  const whatsapp = deps.whatsappFactory(settings);
  if (!whatsapp) {
    // Sem WhatsApp configurado não há o que enviar; não registra log diário
    // para não poluir a auditoria — a fatura segue elegível quando o usuário
    // configurar o canal.
    return {
      sent: false,
      attempted: false,
      reason: 'WhatsApp não configurado nas Configurações'
    };
  }

  const message = renderTemplate(
    templateFor(settings, stage),
    buildChargeVars({
      clientName: charge.client_name,
      amountCents: charge.amount_cents,
      dueDate: charge.due_date,
      description: charge.description,
      pixCopyPaste: pixFields.pix_copy_paste,
      invoiceUrl: pixFields.invoice_url,
      publicToken: charge.public_token
    })
  );

  try {
    await whatsapp.sendText(normalizePhone(charge.client_phone), message);
    await insertLog({
      userId: charge.user_id,
      chargeId: charge.id,
      kind: stage,
      phone: charge.client_phone,
      message,
      success: true
    });
    // A cobrança principal marca a fatura como notificada (PENDING → SENT);
    // lembrete da régua só registra que aquele dia já foi enviado.
    if (stage === 'CHARGE') await markNotified(charge.id);
    else await markReminderSent(charge.id, daysBetween(charge.due_date, today));
    return { sent: true, attempted: true };
  } catch (error) {
    const reason = `Falha no envio via WhatsApp: ${(error as Error).message}`;
    await insertLog({
      userId: charge.user_id,
      chargeId: charge.id,
      kind: stage,
      phone: charge.client_phone,
      message,
      success: false,
      error: reason
    });
    return { sent: false, attempted: true, reason };
  }
}

/* ---------------- Saúde do WhatsApp ---------------- */

/**
 * PASSO 2.5 — Confere a conexão do WhatsApp de cada conta. Quando o chip cai
 * (celular trocado, sessão encerrada no aparelho), marca
 * settings.whatsapp_disconnected_at e avisa o dono por e-mail UMA vez; o
 * painel mostra o alerta até a reconexão. Sem isso os envios falhariam em
 * silêncio até alguém abrir o painel.
 */
async function checkWhatsappConnections(deps: AppDeps): Promise<void> {
  const rows = await query<SettingsRow & { owner_name: string; owner_email: string }>(
    `SELECT s.*, u.name AS owner_name, u.email AS owner_email
       FROM settings s JOIN users u ON u.id = s.user_id
      WHERE s.whatsapp_provider IS NOT NULL`
  );
  for (const row of rows) {
    const whatsapp = deps.whatsappFactory(row);
    if (!whatsapp?.isConnected) continue;
    let connected: boolean;
    try {
      connected = await whatsapp.isConnected();
    } catch (error) {
      // Provedor fora do ar: não dá para concluir nada sobre este chip.
      console.warn(`[motor] não foi possível consultar o WhatsApp de ${row.user_id}:`, error);
      continue;
    }

    if (connected) {
      if (row.whatsapp_disconnected_at) {
        await query('UPDATE settings SET whatsapp_disconnected_at = NULL WHERE user_id = $1', [
          row.user_id
        ]);
      }
      continue;
    }
    if (row.whatsapp_disconnected_at) continue; // já avisado

    await query('UPDATE settings SET whatsapp_disconnected_at = now() WHERE user_id = $1', [
      row.user_id
    ]);
    const link = `${env.frontendOrigin.replace(/\/$/, '')}/configuracoes`;
    const firstName = row.owner_name.split(' ')[0] ?? row.owner_name;
    try {
      await deps.mailer.send({
        to: row.owner_email,
        subject: 'Seu WhatsApp desconectou — Cobra pra mim',
        text:
          `Olá, ${firstName}!\n\n` +
          `O WhatsApp conectado ao Cobra pra mim está desconectado, então as cobranças ` +
          `automáticas não estão sendo enviadas aos seus clientes.\n\n` +
          `Para voltar a enviar, reconecte lendo o QR Code em:\n${link}\n\n` +
          `As cobranças que deixaram de sair hoje são enviadas no próximo ciclo depois da reconexão.`,
        html:
          `<p>Olá, ${firstName.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}!</p>` +
          `<p>O WhatsApp conectado ao Cobra pra mim está <strong>desconectado</strong>, então as ` +
          `cobranças automáticas não estão sendo enviadas aos seus clientes.</p>` +
          `<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#3545bc;color:#fff;` +
          `border-radius:10px;text-decoration:none;font-weight:600">Reconectar o WhatsApp</a></p>` +
          `<p style="color:#666">As cobranças que deixaram de sair hoje são enviadas no próximo ` +
          `ciclo depois da reconexão.</p>`
      });
    } catch (error) {
      console.error(`[motor] falha ao avisar ${row.user_id} sobre o WhatsApp desconectado:`, error);
    }
  }
}

/** Mensagens automáticas já enviadas com sucesso hoje (fuso do app) por este usuário. */
async function countSentToday(userId: string, today: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM notification_logs
      WHERE user_id = $1 AND success
        AND (created_at AT TIME ZONE $3)::date = $2::date`,
    [userId, today, env.appTz]
  );
  return Number(row?.total ?? 0);
}

/**
 * Ciclo diário completo do motor de cobrança. Chamado pelo CRON (08:00 no
 * fuso APP_TZ por padrão) e reutilizado tal-e-qual pelos testes.
 */
export function runBillingCycle(
  deps: AppDeps,
  today: string = todayISO()
): Promise<CycleReport> {
  const cycle = runCycle(deps, today);
  runningCycle = cycle;
  const clear = () => {
    if (runningCycle === cycle) runningCycle = null;
  };
  cycle.then(clear, clear);
  return cycle;
}

async function runCycle(deps: AppDeps, today: string): Promise<CycleReport> {
  const report: CycleReport = {
    today,
    generated: 0,
    overdueMarked: 0,
    notified: 0,
    notifyFailed: 0,
    usersSkipped: 0,
    blockedSkipped: 0,
    limitSkipped: 0,
    disconnectedSkipped: 0
  };

  report.generated = await spawnRecurringCharges(today);
  report.overdueMarked = await markOverdue(today);
  await checkWhatsappConnections(deps);

  const toNotify = await findChargesToNotify(today);

  // Cada usuário tem o próprio chip (instância da Evolution), então as filas
  // rodam em paralelo entre usuários (até NOTIFY_CONCURRENCY por vez) e em
  // sequência dentro do mesmo usuário. Assim, quem tem muitas faturas não
  // atrasa o envio dos outros.
  const byUser = new Map<string, NotifiableRow[]>();
  for (const charge of toNotify) {
    const queue = byUser.get(charge.user_id);
    if (queue) queue.push(charge);
    else byUser.set(charge.user_id, [charge]);
  }

  const notifyUser = async (userId: string, charges: NotifiableRow[]): Promise<void> => {
    // Assinatura bloqueada: o painel já está fechado, e o motor também para
    // de cobrar os clientes dessa conta. As faturas ficam pendentes e saem
    // no primeiro ciclo depois da renovação.
    if ((await findAccessByUser(userId)).state === 'BLOCKED') {
      report.blockedSkipped += charges.length;
      return;
    }
    const settings = await findSettingsByUserId(userId);
    if (!settings) {
      report.usersSkipped += charges.length;
      return;
    }
    // Chip desconectado (visto agora há pouco em checkWhatsappConnections):
    // nem tenta. As cobranças principais continuam elegíveis para o próximo ciclo.
    if (settings.whatsapp_disconnected_at) {
      report.disconnectedSkipped += charges.length;
      return;
    }

    // Proteção do chip: teto de mensagens automáticas por dia. Volume alto
    // e repentino é o principal gatilho de banimento do número.
    let sentToday = await countSentToday(userId, today);

    // Anti-spam: pausa (deps.interSendDelay) entre disparos consecutivos pelo
    // MESMO chip. Pulos que não tocam a Evolution (sem WhatsApp, falha de
    // gateway) não contam.
    let attemptedBefore = false;
    for (let index = 0; index < charges.length; index++) {
      const charge = charges[index]!;
      // Desligamento em andamento (deploy/restart): para entre um envio e
      // outro. O que sobrou continua elegível e sai no próximo ciclo.
      if (stopRequested) return;
      if (sentToday >= settings.daily_message_limit) {
        report.limitSkipped += charges.length - index;
        return;
      }
      if (deps.interSendDelay && attemptedBefore) await deps.interSendDelay();
      if (stopRequested) return;

      const outcome = await sendChargeMessage(deps, settings, charge, stageOf(charge, today), today);
      if (outcome.attempted) attemptedBefore = true;
      if (outcome.sent) {
        report.notified++;
        sentToday++;
      } else {
        report.notifyFailed++;
      }
    }
  };

  const queues = [...byUser.entries()];
  const worker = async (): Promise<void> => {
    for (let next = queues.shift(); next; next = queues.shift()) {
      try {
        await notifyUser(next[0], next[1]);
      } catch (error) {
        // Erro inesperado de um usuário não derruba o ciclo dos demais.
        report.notifyFailed += 1;
        console.error(`[motor] falha ao notificar as faturas do usuário ${next[0]}:`, error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(NOTIFY_CONCURRENCY, queues.length) }, worker));

  return report;
}

/** Envio imediato de UMA fatura (botão "Enviar agora" no Histórico). */
export async function notifyChargeNow(
  deps: AppDeps,
  userId: string,
  chargeId: string
): Promise<SendOutcome> {
  const settings = await findSettingsByUserId(userId);
  if (!settings) {
    return { sent: false, attempted: false, reason: 'Configurações não encontradas' };
  }

  const charge = await queryOne<NotifiableRow>(
    `${NOTIFIABLE_SELECT}
      WHERE ch.user_id = $1 AND ch.id = $2 AND cl.deleted_at IS NULL`,
    [userId, chargeId]
  );
  if (!charge) return { sent: false, attempted: false, reason: 'Fatura não encontrada' };
  if (charge.client_opt_out) {
    return {
      sent: false,
      attempted: false,
      reason: 'Este cliente pediu para não receber mensagens. Altere no cadastro do cliente para enviar.'
    };
  }

  // Envio manual é sempre a cobrança principal (com o modelo de cobrança).
  return sendChargeMessage(deps, settings, charge, 'CHARGE', todayISO());
}

/** Confirmação de pagamento no WhatsApp — disparada pelo webhook. */
export async function sendPaymentConfirmation(
  deps: AppDeps,
  userId: string,
  chargeId: string
): Promise<void> {
  // A baixa da fatura acontece mesmo bloqueado (o dinheiro é do cliente
  // final), mas a mensagem de confirmação é serviço da plataforma.
  if ((await findAccessByUser(userId)).state === 'BLOCKED') return;

  const settings = await findSettingsByUserId(userId);
  if (!settings) return;

  const whatsapp = deps.whatsappFactory(settings);
  if (!whatsapp) return; // sem canal: a fatura fica PAGA do mesmo jeito

  const charge = await findChargeById(userId, chargeId);
  if (!charge || !charge.client_name || !charge.client_phone) return;
  if (charge.client_opt_out) return; // pediu para não receber mensagens

  const message = renderTemplate(
    settings.paid_template,
    buildChargeVars({
      clientName: charge.client_name,
      amountCents: charge.amount_cents,
      dueDate: charge.due_date,
      description: charge.description,
      pixCopyPaste: charge.pix_copy_paste,
      invoiceUrl: charge.invoice_url,
      publicToken: charge.public_token
    })
  );

  try {
    await whatsapp.sendText(normalizePhone(charge.client_phone), message);
    await insertLog({
      userId,
      chargeId,
      kind: 'PAYMENT_CONFIRMED',
      phone: charge.client_phone,
      message,
      success: true
    });
  } catch (error) {
    await insertLog({
      userId,
      chargeId,
      kind: 'PAYMENT_CONFIRMED',
      phone: charge.client_phone,
      message,
      success: false,
      error: (error as Error).message
    });
  }
}

/* ---------------- Monitoramento ---------------- */

/** Grava o resultado de uma execução do ciclo (consultado por /health/deep). */
export async function recordEngineRun(
  today: string,
  result: { ok: true; report: CycleReport } | { ok: false; error: string }
): Promise<void> {
  await query(
    `INSERT INTO engine_runs (ran_on, ok, report, error) VALUES ($1, $2, $3, $4)`,
    [
      today,
      result.ok,
      result.ok ? JSON.stringify(result.report) : null,
      result.ok ? null : result.error.slice(0, 2000)
    ]
  );
  // Histórico curto: 90 dias bastam para diagnóstico.
  await query(`DELETE FROM engine_runs WHERE finished_at < now() - interval '90 days'`);
}
