import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { queryOne } from '../../db';
import { asyncHandler, notFound } from '../../lib/errors';
import { ipKey } from '../../middleware/rate-limit';

const tokenParam = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/) });

interface PublicChargeRow {
  description: string;
  amount_cents: number;
  due_date: string;
  status: string;
  paid_at: Date | null;
  pix_copy_paste: string | null;
  pix_qr_code_url: string | null;
  invoice_url: string | null;
  seller_name: string;
  client_name: string | null;
}

/**
 * Página pública da fatura: o cliente final abre o link recebido no WhatsApp
 * e vê valor, vencimento, situação e o Pix (QR Code + copia e cola).
 *
 * Sem login: quem tem o link vê a fatura. O token é aleatório (128 bits) e
 * não é o id interno. A resposta só traz o necessário para pagar — nada de
 * telefone, e-mail ou documento, e só o primeiro nome do cliente.
 */
export default function publicRouter(): Router {
  const router = Router();

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 60,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => `public:${ipKey(req.ip)}`,
      message: { error: 'Muitas consultas. Aguarde um minuto.', code: 'RATE_LIMITED' }
    })
  );

  router.get(
    '/charges/:token',
    asyncHandler(async (req, res) => {
      const parsed = tokenParam.safeParse(req.params);
      if (!parsed.success) throw notFound('Fatura não encontrada');

      const row = await queryOne<PublicChargeRow>(
        `SELECT ch.description, ch.amount_cents, ch.due_date, ch.status, ch.paid_at,
                ch.pix_copy_paste, ch.pix_qr_code_url, ch.invoice_url,
                u.name AS seller_name, cl.name AS client_name
           FROM charges ch
           JOIN users u ON u.id = ch.user_id
           LEFT JOIN clients cl ON cl.id = ch.client_id
          WHERE ch.public_token = $1`,
        [parsed.data.token]
      );
      if (!row) throw notFound('Fatura não encontrada');

      const open = row.status === 'PENDING' || row.status === 'SENT' || row.status === 'OVERDUE';
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.json({
        sellerName: row.seller_name,
        clientFirstName: row.client_name?.split(' ')[0] ?? null,
        description: row.description,
        amountCents: row.amount_cents,
        dueDate: row.due_date,
        // SENT é detalhe interno: para o cliente a fatura está "em aberto".
        status: row.status === 'SENT' ? 'PENDING' : row.status,
        paidAt: row.paid_at?.toISOString() ?? null,
        // Dados de pagamento só enquanto a fatura está em aberto.
        pixCopyPaste: open ? row.pix_copy_paste : null,
        pixQrCodeUrl: open ? row.pix_qr_code_url : null,
        invoiceUrl: open ? row.invoice_url : null
      });
    })
  );

  return router;
}
