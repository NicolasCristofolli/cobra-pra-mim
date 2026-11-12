import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db';
import { AppError, asyncHandler, notFound } from '../../lib/errors';
import { isValidCpfCnpj } from '../../lib/document';
import { isRepeatedDigits, normalizePhone } from '../../lib/format';

const router = Router();

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente'),
  phone: z
    .string()
    .trim()
    .transform(normalizePhone)
    .refine((digits) => /^[0-9]{8,15}$/.test(digits), 'Telefone inválido')
    .refine((digits) => !isRepeatedDigits(digits.replace(/^55/, '')), 'Telefone inválido'),
  email: z.string().trim().email('E-mail inválido').nullish().or(z.literal('').transform(() => null)),
  // CPF (11 dígitos) ou CNPJ (14 dígitos) — obrigatório: o gateway precisa
  // do documento para emitir a cobrança em nome do cliente. Normalizado para
  // dígitos puros (sem máscara) para a checagem de duplicidade funcionar
  // independente de como o usuário formatou na digitação.
  document: z
    .string({ required_error: 'Informe o CPF ou CNPJ' })
    .trim()
    .min(1, 'Informe o CPF ou CNPJ')
    .transform((doc) => doc.replace(/\D/g, ''))
    .refine(
      (digits) => digits.length === 11 || digits.length === 14,
      'CPF/CNPJ inválido — use 11 (CPF) ou 14 (CNPJ) dígitos'
    )
    .refine(
      (digits) => isValidCpfCnpj(digits),
      'CPF/CNPJ inválido'
    ),
  notes: z.string().trim().max(2000).nullish().or(z.literal('').transform(() => null)),
  // Cliente pediu para não receber mensagens: o motor e o envio manual respeitam.
  whatsappOptOut: z.boolean().optional().default(false)
});

const DUPLICATE_FIELD_MESSAGE: Record<string, string> = {
  clients_user_phone_unique: 'Já existe um cliente com este telefone',
  clients_user_email_unique: 'Já existe um cliente com este e-mail',
  clients_user_document_unique: 'Já existe um cliente com este CPF/CNPJ'
};

/** Traduz violação de índice único (duplicidade) num 409 amigável; repassa outros erros. */
function rethrowDuplicate(error: unknown): never {
  const constraint = (error as { constraint?: string }).constraint;
  if (constraint && DUPLICATE_FIELD_MESSAGE[constraint]) {
    throw new AppError(DUPLICATE_FIELD_MESSAGE[constraint], 409);
  }
  throw error;
}

const idParam = z.object({ id: z.string().uuid() });

export type ClientStatus = 'INADIMPLENTE' | 'ADIMPLENTE' | 'SEM_COBRANCAS';

interface ClientRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  document: string | null;
  notes: string | null;
  whatsapp_opt_out: boolean;
  created_at: string;
  open_count: string;
  overdue_count: string;
  paid_count: string;
}

function clientStatus(row: ClientRow): ClientStatus {
  if (Number(row.overdue_count) > 0) return 'INADIMPLENTE';
  if (Number(row.open_count) > 0) return 'ADIMPLENTE';
  return 'SEM_COBRANCAS';
}

function serialize(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    document: row.document,
    notes: row.notes,
    whatsappOptOut: row.whatsapp_opt_out,
    createdAt: row.created_at,
    openCharges: Number(row.open_count),
    overdueCharges: Number(row.overdue_count),
    paidCharges: Number(row.paid_count),
    status: clientStatus(row)
  };
}

const LIST_SQL = `
  SELECT c.id, c.name, c.phone, c.email, c.document, c.notes, c.whatsapp_opt_out, c.created_at,
         COUNT(ch.id) FILTER (WHERE ch.status IN ('PENDING', 'SENT', 'OVERDUE')) AS open_count,
         COUNT(ch.id) FILTER (WHERE ch.status = 'OVERDUE')               AS overdue_count,
         COUNT(ch.id) FILTER (WHERE ch.status = 'PAID')                  AS paid_count
    FROM clients c
    LEFT JOIN charges ch ON ch.client_id = c.id
   WHERE c.user_id = $1 AND c.deleted_at IS NULL
`;

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const params: unknown[] = [req.userId];
    let sql = LIST_SQL;
    if (search) {
      // ILIKE também no e-mail: busca case-insensitive (a coluna guarda o
      // e-mail como foi digitado) e o trim acima remove espaços colados.
      // CPF/CNPJ entra na mesma busca; a comparação sem pontuação cobre
      // quem digita "12345678900" para um documento salvo com máscara.
      params.push(`%${search}%`);
      params.push(`%${search.replace(/\D/g, '')}%`);
      sql += ` AND (c.name ILIKE $2 OR c.phone LIKE $2 OR c.email ILIKE $2 OR c.document ILIKE $2`;
      sql += ` OR ($3 <> '%%' AND regexp_replace(coalesce(c.document, ''), '\\D', '', 'g') LIKE $3))`;
    }
    sql += ' GROUP BY c.id ORDER BY c.created_at DESC';
    const rows = await query<ClientRow>(sql, params);
    res.json(rows.map(serialize));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    // Escopo por user_id em TODA leitura: um id válido de outro tenant
    // devolve 404, indistinguível de inexistente (anti-IDOR).
    const row = await queryOne<ClientRow>(
      `${LIST_SQL} AND c.id = $2 GROUP BY c.id`,
      [req.userId, id]
    );
    if (!row) throw notFound('Cliente não encontrado');
    res.json(serialize(row));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = clientSchema.parse(req.body);
    // Telefone/e-mail/CPF-CNPJ não podem se repetir para o mesmo usuário —
    // aplicado via índice único parcial (ver migração 006); erro 23505 vira
    // 409 amigável em rethrowDuplicate.
    const row = await queryOne<ClientRow>(
      `INSERT INTO clients (user_id, name, phone, email, document, notes, whatsapp_opt_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, phone, email, document, notes, whatsapp_opt_out, created_at,
                 '0' AS open_count, '0' AS overdue_count, '0' AS paid_count`,
      [req.userId, data.name, data.phone, data.email ?? null, data.document ?? null, data.notes ?? null, data.whatsappOptOut]
    ).catch(rethrowDuplicate);
    res.status(201).json(serialize(row!));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const data = clientSchema.parse(req.body);
    const updated = await queryOne<{ id: string }>(
      `UPDATE clients
          SET name = $3, phone = $4, email = $5, document = $6, notes = $7, whatsapp_opt_out = $8
        WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL
        RETURNING id`,
      [req.userId, id, data.name, data.phone, data.email ?? null, data.document ?? null, data.notes ?? null, data.whatsappOptOut]
    ).catch(rethrowDuplicate);
    if (!updated) throw notFound('Cliente não encontrado');
    const row = await queryOne<ClientRow>(`${LIST_SQL} AND c.id = $2 GROUP BY c.id`, [
      req.userId,
      id
    ]);
    res.json(serialize(row!));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    // Exclusão é reversível (soft delete): marcamos deleted_at em vez de
    // apagar a linha, para o botão "Desfazer" poder restaurar o cliente E
    // as faturas que foram auto-canceladas aqui, na mesma operação.
    const result = await withTransaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        'SELECT id FROM clients WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL',
        [req.userId, id]
      );
      if (existing.rowCount === 0) return null;

      const canceled = await tx.query<{ id: string }>(
        `UPDATE charges
            SET status = 'CANCELED', updated_at = now()
          WHERE user_id = $1 AND client_id = $2 AND status IN ('PENDING', 'SENT', 'OVERDUE')
          RETURNING id`,
        [req.userId, id]
      );
      await tx.query(
        'UPDATE clients SET deleted_at = now() WHERE id = $2 AND user_id = $1',
        [req.userId, id]
      );
      return { canceledChargeIds: canceled.rows.map((r) => r.id) };
    });

    if (!result) throw notFound('Cliente não encontrado');
    res.json({
      ok: true,
      canceledCharges: result.canceledChargeIds.length,
      canceledChargeIds: result.canceledChargeIds
    });
  })
);

// Desfazer a exclusão: usado pela ação "Desfazer" do toast. Faturas
// auto-canceladas pela exclusão são reativadas separadamente pelo client
// (POST /charges/:id/reactivate para cada id em canceledChargeIds).
router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const row = await queryOne<{ id: string }>(
      `UPDATE clients SET deleted_at = NULL
        WHERE id = $2 AND user_id = $1 AND deleted_at IS NOT NULL
        RETURNING id`,
      [req.userId, id]
    ).catch(rethrowDuplicate);
    if (!row) throw notFound('Cliente não encontrado ou não estava excluído');
    res.json({ ok: true });
  })
);

export default router;
