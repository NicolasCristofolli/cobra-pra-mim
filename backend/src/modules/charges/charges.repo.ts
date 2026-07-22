import { randomUUID } from 'node:crypto';
import { query, queryOne } from '../../db';
import { parseISODate, type RecurrenceKind } from '../../lib/dates';

// SENT = mensagem de cobrança já enviada no WhatsApp, aguardando pagamento.
export type ChargeStatus = 'PENDING' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELED';

export interface ChargeRow {
  id: string;
  user_id: string;
  // NULL quando o cliente foi excluído (a fatura fica como registro histórico).
  client_id: string | null;
  series_id: string;
  description: string;
  amount_cents: number;
  due_date: string;
  status: ChargeStatus;
  recurrence: RecurrenceKind;
  anchor_day: number | null;
  // Último vencimento que a série recorrente pode gerar (NULL = sem limite).
  recurrence_end_date: string | null;
  paid_at: string | null;
  net_amount_cents: number | null;
  gateway_charge_id: string | null;
  pix_copy_paste: string | null;
  pix_qr_code_url: string | null;
  invoice_url: string | null;
  last_notified_at: string | null;
  next_generated: boolean;
  created_at: string;
  client_name?: string;
  client_phone?: string;
}

// LEFT JOIN: faturas de clientes excluídos (client_id NULL) continuam
// aparecendo no histórico, com client_name/client_phone nulos.
const BASE_SELECT = `
  SELECT ch.*, cl.name AS client_name, cl.phone AS client_phone
    FROM charges ch
    LEFT JOIN clients cl ON cl.id = ch.client_id
`;

export function serializeCharge(row: ChargeRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name ?? null,
    clientPhone: row.client_phone ?? null,
    seriesId: row.series_id,
    description: row.description,
    amountCents: row.amount_cents,
    dueDate: row.due_date,
    status: row.status,
    recurrence: row.recurrence,
    anchorDay: row.anchor_day,
    recurrenceEndDate: row.recurrence_end_date,
    paidAt: row.paid_at,
    netAmountCents: row.net_amount_cents,
    gatewayChargeId: row.gateway_charge_id,
    pixCopyPaste: row.pix_copy_paste,
    pixQrCodeUrl: row.pix_qr_code_url,
    invoiceUrl: row.invoice_url,
    lastNotifiedAt: row.last_notified_at,
    createdAt: row.created_at
  };
}

export interface CreateChargeInput {
  userId: string;
  clientId: string;
  description: string;
  amountCents: number;
  dueDate: string;
  recurrence: RecurrenceKind;
  recurrenceEndDate?: string | null;
}

/**
 * Cria uma fatura. Séries recorrentes nascem com series_id próprio e o dia
 * do vencimento vira o dia-âncora dos ciclos seguintes.
 */
export async function createCharge(input: CreateChargeInput): Promise<ChargeRow> {
  const id = randomUUID();
  const anchorDay =
    input.recurrence === 'MONTHLY' || input.recurrence === 'YEARLY'
      ? parseISODate(input.dueDate).d
      : null;

  const row = await queryOne<ChargeRow>(
    `INSERT INTO charges
       (id, user_id, client_id, series_id, description, amount_cents, due_date, recurrence, anchor_day, recurrence_end_date)
     VALUES ($1, $2, $3, $1, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      input.userId,
      input.clientId,
      input.description,
      input.amountCents,
      input.dueDate,
      input.recurrence,
      anchorDay,
      input.recurrence === 'NONE' ? null : input.recurrenceEndDate ?? null
    ]
  );
  return row!;
}

export interface UpdateChargeInput {
  description: string;
  amountCents: number;
  dueDate: string;
}

/**
 * Edita descrição, valor e vencimento de uma fatura em aberto (PENDING ou
 * SENT). Se a série for mensal/anual, o novo dia do vencimento vira o
 * dia-âncora dos próximos ciclos. Devolve null se a fatura não existir ou
 * não estiver em aberto.
 */
export async function updateCharge(
  userId: string,
  chargeId: string,
  input: UpdateChargeInput
): Promise<ChargeRow | null> {
  return queryOne<ChargeRow>(
    `UPDATE charges
        SET description = $3,
            amount_cents = $4,
            due_date = $5,
            anchor_day = CASE
              WHEN recurrence IN ('MONTHLY', 'YEARLY') THEN $6::smallint
              ELSE anchor_day
            END,
            updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status IN ('PENDING', 'SENT')
      RETURNING *`,
    [
      userId,
      chargeId,
      input.description,
      input.amountCents,
      input.dueDate,
      parseISODate(input.dueDate).d
    ]
  );
}

export async function findChargeById(
  userId: string,
  chargeId: string
): Promise<ChargeRow | null> {
  return queryOne<ChargeRow>(`${BASE_SELECT} WHERE ch.user_id = $1 AND ch.id = $2`, [
    userId,
    chargeId
  ]);
}

/** Localiza a fatura de um webhook pelo id do gateway OU pela referência externa (nosso UUID). */
export async function findChargeForWebhook(
  userId: string,
  gatewayChargeId: string | null,
  externalReference: string | null
): Promise<ChargeRow | null> {
  if (externalReference) {
    const byRef = await queryOne<ChargeRow>(
      `${BASE_SELECT} WHERE ch.user_id = $1 AND ch.id = $2::uuid`,
      [userId, externalReference]
    ).catch(() => null); // externalReference pode não ser UUID
    if (byRef) return byRef;
  }
  if (gatewayChargeId) {
    return queryOne<ChargeRow>(
      `${BASE_SELECT} WHERE ch.user_id = $1 AND ch.gateway_charge_id = $2`,
      [userId, gatewayChargeId]
    );
  }
  return null;
}

export async function markChargePaid(
  userId: string,
  chargeId: string,
  options: {
    paidAt?: Date;
    netAmountCents?: number | null;
    gatewayChargeId?: string | null;
  } = {}
): Promise<ChargeRow | null> {
  return queryOne<ChargeRow>(
    `UPDATE charges
        SET status = 'PAID',
            paid_at = $3,
            net_amount_cents = COALESCE($4, net_amount_cents),
            gateway_charge_id = COALESCE(gateway_charge_id, $5),
            updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status <> 'PAID'
      RETURNING *`,
    [
      userId,
      chargeId,
      options.paidAt ?? new Date(),
      options.netAmountCents ?? null,
      options.gatewayChargeId ?? null
    ]
  );
}

export async function cancelCharge(
  userId: string,
  chargeId: string
): Promise<ChargeRow | null> {
  // Cancelar a fatura mais recente de uma série recorrente encerra a série:
  // o motor só gera o próximo ciclo a partir de faturas não canceladas.
  return queryOne<ChargeRow>(
    `UPDATE charges
        SET status = 'CANCELED', updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status IN ('PENDING', 'SENT', 'OVERDUE')
      RETURNING *`,
    [userId, chargeId]
  );
}

/**
 * Reverte um cancelamento (botão "Reativar"). Só permitido para faturas
 * CANCELED de um cliente que ainda existe e não está excluído (soft delete)
 * — não há como reativar a fatura de um cliente excluído/inexistente (nada
 * para cobrar; se o cliente foi excluído, primeiro é preciso restaurá-lo).
 * O novo status reflete se o vencimento já passou, igual ao critério usado
 * por markOverdue().
 */
export async function reactivateCharge(
  userId: string,
  chargeId: string
): Promise<ChargeRow | null> {
  return queryOne<ChargeRow>(
    `UPDATE charges
        SET status = CASE WHEN due_date < CURRENT_DATE THEN 'OVERDUE'::charge_status
                           ELSE 'PENDING'::charge_status END,
            updated_at = now()
      WHERE user_id = $1 AND id = $2 AND status = 'CANCELED'
        AND client_id IN (SELECT id FROM clients WHERE user_id = $1 AND deleted_at IS NULL)
      RETURNING *`,
    [userId, chargeId]
  );
}

/**
 * Exclui DEFINITIVAMENTE uma fatura. Permitido apenas para faturas canceladas
 * ou órfãs (cliente excluído) — o histórico financeiro vivo nunca é apagado.
 * Devolve null se a fatura não se qualificar.
 */
export async function deleteCharge(
  userId: string,
  chargeId: string
): Promise<ChargeRow | null> {
  return queryOne<ChargeRow>(
    `DELETE FROM charges
      WHERE user_id = $1 AND id = $2
        AND (status = 'CANCELED' OR client_id IS NULL)
      RETURNING *`,
    [userId, chargeId]
  );
}

export async function saveGatewayData(
  chargeId: string,
  data: {
    gatewayChargeId: string;
    pixCopyPaste?: string | null;
    pixQrCodeUrl?: string | null;
    invoiceUrl?: string | null;
  }
): Promise<void> {
  await query(
    `UPDATE charges
        SET gateway_charge_id = $2,
            pix_copy_paste = $3,
            pix_qr_code_url = $4,
            invoice_url = $5,
            updated_at = now()
      WHERE id = $1`,
    [
      chargeId,
      data.gatewayChargeId,
      data.pixCopyPaste ?? null,
      data.pixQrCodeUrl ?? null,
      data.invoiceUrl ?? null
    ]
  );
}

export async function markNotified(chargeId: string): Promise<void> {
  // Envio bem-sucedido promove PENDING → SENT ("Enviada"). OVERDUE permanece
  // OVERDUE: o atraso é a informação dominante mesmo depois da mensagem.
  await query(
    `UPDATE charges
        SET last_notified_at = now(),
            status = CASE WHEN status = 'PENDING' THEN 'SENT'::charge_status ELSE status END,
            updated_at = now()
      WHERE id = $1`,
    [chargeId]
  );
}

export interface ListChargesFilters {
  userId: string;
  clientName?: string;
  status?: ChargeStatus;
  page: number;
  pageSize: number;
}

export async function listCharges(filters: ListChargesFilters): Promise<{
  items: ChargeRow[];
  total: number;
}> {
  const params: unknown[] = [filters.userId];
  const conditions: string[] = ['ch.user_id = $1'];

  if (filters.clientName) {
    params.push(`%${filters.clientName}%`);
    conditions.push(`cl.name ILIKE $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`ch.status = $${params.length}::charge_status`);
  }

  const where = conditions.join(' AND ');
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*) AS total FROM charges ch LEFT JOIN clients cl ON cl.id = ch.client_id WHERE ${where}`,
    params
  );

  params.push(filters.pageSize, (filters.page - 1) * filters.pageSize);
  const items = await query<ChargeRow>(
    `${BASE_SELECT}
      WHERE ${where}
      ORDER BY ch.due_date DESC, ch.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { items, total: Number(countRow?.total ?? 0) };
}
