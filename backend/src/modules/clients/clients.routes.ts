import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db';
import { asyncHandler, notFound } from '../../lib/errors';
import { normalizePhone } from '../../lib/format';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

const clientSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do cliente'),
  phone: z
    .string()
    .trim()
    .transform(normalizePhone)
    .refine((digits) => /^[0-9]{8,15}$/.test(digits), 'Telefone inválido'),
  email: z.string().trim().email('E-mail inválido').nullish().or(z.literal('').transform(() => null)),
  // CPF (11 dígitos) ou CNPJ (14 dígitos) — obrigatório: o gateway precisa
  // do documento para emitir a cobrança em nome do cliente.
  document: z
    .string({ required_error: 'Informe o CPF ou CNPJ' })
    .trim()
    .min(1, 'Informe o CPF ou CNPJ')
    .max(20)
    .refine((doc) => {
      const digits = doc.replace(/\D/g, '');
      return digits.length === 11 || digits.length === 14;
    }, 'CPF/CNPJ inválido — use 11 (CPF) ou 14 (CNPJ) dígitos'),
  notes: z.string().trim().max(2000).nullish().or(z.literal('').transform(() => null))
});

const idParam = z.object({ id: z.string().uuid() });

export type ClientStatus = 'INADIMPLENTE' | 'ADIMPLENTE' | 'SEM_COBRANCAS';

interface ClientRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  document: string | null;
  notes: string | null;
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
    createdAt: row.created_at,
    openCharges: Number(row.open_count),
    overdueCharges: Number(row.overdue_count),
    paidCharges: Number(row.paid_count),
    status: clientStatus(row)
  };
}

const LIST_SQL = `
  SELECT c.id, c.name, c.phone, c.email, c.document, c.notes, c.created_at,
         COUNT(ch.id) FILTER (WHERE ch.status IN ('PENDING', 'SENT', 'OVERDUE')) AS open_count,
         COUNT(ch.id) FILTER (WHERE ch.status = 'OVERDUE')               AS overdue_count,
         COUNT(ch.id) FILTER (WHERE ch.status = 'PAID')                  AS paid_count
    FROM clients c
    LEFT JOIN charges ch ON ch.client_id = c.id
   WHERE c.user_id = $1
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
    // Sem verificação de duplicidade de nome/telefone: é REQUISITO permitir
    // homônimos e números compartilhados. A identidade é o UUID.
    const row = await queryOne<ClientRow>(
      `INSERT INTO clients (user_id, name, phone, email, document, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, phone, email, document, notes, created_at,
                 '0' AS open_count, '0' AS overdue_count, '0' AS paid_count`,
      [req.userId, data.name, data.phone, data.email ?? null, data.document ?? null, data.notes ?? null]
    );
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
          SET name = $3, phone = $4, email = $5, document = $6, notes = $7
        WHERE id = $2 AND user_id = $1
        RETURNING id`,
      [req.userId, id, data.name, data.phone, data.email ?? null, data.document ?? null, data.notes ?? null]
    );
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
    // Excluir um cliente NÃO pode estourar 409 por FK: na mesma transação,
    // as faturas em aberto viram CANCELED e a exclusão desvincula as demais
    // (client_id → NULL via ON DELETE SET NULL). Faturas PAID permanecem
    // pagas — o histórico financeiro não é reescrito.
    const result = await withTransaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        'SELECT id FROM clients WHERE id = $2 AND user_id = $1',
        [req.userId, id]
      );
      if (existing.rowCount === 0) return null;

      const canceled = await tx.query<{ id: string }>(
        `UPDATE charges
            SET status = 'CANCELED', updated_at = now()
          WHERE user_id = $1 AND client_id = $2 AND status IN ('PENDING', 'OVERDUE')
          RETURNING id`,
        [req.userId, id]
      );
      await tx.query('DELETE FROM clients WHERE id = $2 AND user_id = $1', [
        req.userId,
        id
      ]);
      return { canceledCharges: canceled.rowCount ?? 0 };
    });

    if (!result) throw notFound('Cliente não encontrado');
    res.json({ ok: true, canceledCharges: result.canceledCharges });
  })
);

export default router;
