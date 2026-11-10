import { query, queryOne } from '../db';
import { nextDueDate, todayISO } from '../lib/dates';
import { normalizePhone } from '../lib/format';
import { buildChargeVars, renderTemplate } from '../lib/template';
import {
  findChargeById,
  markNotified,
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
  notified: number;       // mensagens de cobrança enviadas
  notifyFailed: number;   // falhas de envio/gateway (ficam para retry/manual)
  usersSkipped: number;   // usuários sem settings (nunca deveria ocorrer)
  blockedSkipped: number; // faturas de usuários com assinatura bloqueada (não enviadas)
}

interface NotifiableRow extends ChargeRow {
  // O JOIN interno com clients garante cliente presente nas notificáveis.
  client_id: string;
  client_name: string;
  client_phone: string;
  client_email: string | null;
  client_document: string | null;
}

async function insertLog(entry: {
  userId: string;
  chargeId: string | null;
  kind: 'CHARGE' | 'PAYMENT_CONFIRMED';
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
 * Garante que a fatura tem um Pix no gateway. Atualiza o registro e devolve
 * os campos novos. Lança se o gateway falhar (o chamador decide o destino).
 */
async function ensurePix(
  gateway: GatewayPort,
  charge: NotifiableRow
): Promise<Pick<ChargeRow, 'pix_copy_paste' | 'pix_qr_code_url' | 'invoice_url' | 'gateway_charge_id'>> {
  if (charge.gateway_charge_id) {
    return {
      gateway_charge_id: charge.gateway_charge_id,
      pix_copy_paste: charge.pix_copy_paste,
      pix_qr_code_url: charge.pix_qr_code_url,
      invoice_url: charge.invoice_url
    };
  }

  const result = await gateway.createPixCharge({
    amountCents: charge.amount_cents,
    dueDate: charge.due_date,
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
        AND client_id IS NOT NULL -- cliente excluído encerra a série
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
 * PASSO 3 — Notifica: tudo que vence HOJE + atrasadas que nunca receberam
 * mensagem (resiliência a falhas transitórias de envio em dias anteriores).
 */
async function findChargesToNotify(today: string): Promise<NotifiableRow[]> {
  return query<NotifiableRow>(
    `SELECT ch.*, cl.name  AS client_name,
            cl.phone       AS client_phone,
            cl.email       AS client_email,
            cl.document    AS client_document
       FROM charges ch
       JOIN clients cl ON cl.id = ch.client_id
      WHERE ch.last_notified_at IS NULL
        AND (
              (ch.status = 'PENDING' AND ch.due_date = $1)
           OR  ch.status = 'OVERDUE'
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

async function sendChargeMessage(
  deps: AppDeps,
  settings: SettingsRow,
  charge: NotifiableRow
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
        kind: 'CHARGE',
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
    settings.message_template,
    buildChargeVars({
      clientName: charge.client_name,
      amountCents: charge.amount_cents,
      dueDate: charge.due_date,
      description: charge.description,
      pixCopyPaste: pixFields.pix_copy_paste,
      invoiceUrl: pixFields.invoice_url
    })
  );

  try {
    await whatsapp.sendText(normalizePhone(charge.client_phone), message);
    await insertLog({
      userId: charge.user_id,
      chargeId: charge.id,
      kind: 'CHARGE',
      phone: charge.client_phone,
      message,
      success: true
    });
    await markNotified(charge.id);
    return { sent: true, attempted: true };
  } catch (error) {
    const reason = `Falha no envio via WhatsApp: ${(error as Error).message}`;
    await insertLog({
      userId: charge.user_id,
      chargeId: charge.id,
      kind: 'CHARGE',
      phone: charge.client_phone,
      message,
      success: false,
      error: reason
    });
    return { sent: false, attempted: true, reason };
  }
}

/**
 * Ciclo diário completo do motor de cobrança. Chamado pelo CRON (08:00 no
 * fuso APP_TZ por padrão) e reutilizado tal-e-qual pelos testes.
 */
export async function runBillingCycle(
  deps: AppDeps,
  today: string = todayISO()
): Promise<CycleReport> {
  const report: CycleReport = {
    today,
    generated: 0,
    overdueMarked: 0,
    notified: 0,
    notifyFailed: 0,
    usersSkipped: 0,
    blockedSkipped: 0
  };

  report.generated = await spawnRecurringCharges(today);
  report.overdueMarked = await markOverdue(today);

  const toNotify = await findChargesToNotify(today);
  const settingsCache = new Map<string, SettingsRow | null>();
  const blockedCache = new Map<string, boolean>();

  // Anti-spam: pausa (deps.interSendDelay) entre disparos consecutivos pelo
  // MESMO chip — a instância é por usuário, então trocar de usuário troca de
  // chip e dispensa espaçamento. Pulos que não tocam a Evolution (sem
  // WhatsApp, falha de gateway) também não contam. O ORDER BY user_id da
  // consulta agrupa as faturas por chip.
  let lastAttemptUserId: string | null = null;

  for (const charge of toNotify) {
    // Assinatura bloqueada: o painel já está fechado, e o motor também para
    // de cobrar os clientes dessa conta. As faturas ficam pendentes e saem
    // no primeiro ciclo depois da renovação.
    if (!blockedCache.has(charge.user_id)) {
      blockedCache.set(charge.user_id, (await findAccessByUser(charge.user_id)).state === 'BLOCKED');
    }
    if (blockedCache.get(charge.user_id)) {
      report.blockedSkipped++;
      continue;
    }

    if (!settingsCache.has(charge.user_id)) {
      settingsCache.set(charge.user_id, await findSettingsByUserId(charge.user_id));
    }
    const settings = settingsCache.get(charge.user_id)!;
    if (!settings) {
      report.usersSkipped++;
      continue;
    }

    if (deps.interSendDelay && lastAttemptUserId === charge.user_id) {
      await deps.interSendDelay();
    }

    const outcome = await sendChargeMessage(deps, settings, charge);
    if (outcome.attempted) lastAttemptUserId = charge.user_id;
    if (outcome.sent) report.notified++;
    else report.notifyFailed++;
  }

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
    `SELECT ch.*, cl.name AS client_name, cl.phone AS client_phone,
            cl.email AS client_email, cl.document AS client_document
       FROM charges ch JOIN clients cl ON cl.id = ch.client_id
      WHERE ch.user_id = $1 AND ch.id = $2`,
    [userId, chargeId]
  );
  if (!charge) return { sent: false, attempted: false, reason: 'Fatura não encontrada' };

  return sendChargeMessage(deps, settings, charge);
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

  const message = renderTemplate(
    settings.paid_template,
    buildChargeVars({
      clientName: charge.client_name,
      amountCents: charge.amount_cents,
      dueDate: charge.due_date,
      description: charge.description,
      pixCopyPaste: charge.pix_copy_paste,
      invoiceUrl: charge.invoice_url
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
