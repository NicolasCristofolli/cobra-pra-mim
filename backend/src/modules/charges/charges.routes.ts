import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../db';
import { asyncHandler, AppError, notFound } from '../../lib/errors';
import { env } from '../../config/env';
import { toCsv } from '../../lib/csv';
import { addDaysISO, formatDateBR, parseISODate, todayISO } from '../../lib/dates';
import { publish } from '../../lib/events';
import { notifyChargeNow, sendPaymentConfirmation } from '../../services/billing-engine';
import type { AppDeps } from '../../services/deps';
import { findSettingsByUserId } from '../settings/settings.routes';
import {
  cancelCharge,
  createCharge,
  deleteCharge,
  EXPORT_MAX_ROWS,
  findChargeById,
  listCharges,
  listChargesForExport,
  markChargePaid,
  reactivateCharge,
  unmarkChargePaid,
  serializeCharge,
  updateCharge,
  type ChargeStatus
} from './charges.repo';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Formato YYYY-MM-DD E data que existe no calendário (31/02 é recusado com 400, não 500). */
function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  try {
    parseISODate(value);
    return true;
  } catch {
    return false;
  }
}

const isoDate = (message: string) => z.string().refine(isRealDate, message);

// Teto de R$ 9.999.999,99: bem abaixo do limite do INTEGER do Postgres.
const MAX_AMOUNT_CENTS = 999_999_999;
const amountCents = z
  .number()
  .int()
  .positive('Valor precisa ser maior que zero')
  .max(MAX_AMOUNT_CENTS, 'Valor acima do limite permitido');

const createSchema = z
  .object({
    clientId: z.string().uuid('Selecione um cliente'),
    description: z.string().trim().min(2, 'Descreva a cobrança'),
    amountCents,
    dueDate: isoDate('Data de vencimento inválida'),
    recurrence: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY']).default('NONE'),
    recurrenceEndDate: isoDate('Data limite da recorrência inválida').nullish(),
    // PIX (padrão), BOLETO ou UNDEFINED (o cliente escolhe Pix, boleto ou cartão).
    billingType: z.enum(['PIX', 'BOLETO', 'UNDEFINED']).default('PIX')
  })
  .superRefine((data, ctx) => {
    if (data.dueDate < todayISO()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dueDate'],
        message: 'A data de vencimento não pode ser retroativa'
      });
    }
    // Semanal/mensal exigem data limite; anual pode rodar sem limite.
    if (
      (data.recurrence === 'WEEKLY' || data.recurrence === 'MONTHLY') &&
      !data.recurrenceEndDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceEndDate'],
        message: 'Informe até quando a recorrência deve rodar'
      });
    }
    if (data.recurrenceEndDate && data.recurrenceEndDate < data.dueDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceEndDate'],
        message: 'A data limite precisa ser igual ou posterior ao primeiro vencimento'
      });
    }
  });

const updateSchema = z.object({
  description: z.string().trim().min(2, 'Descreva a cobrança'),
  amountCents,
  dueDate: isoDate('Data de vencimento inválida')
});

const listSchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['PENDING', 'SENT', 'PAID', 'OVERDUE', 'CANCELED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

const idParam = z.object({ id: z.string().uuid() });

// Exportação: período de no máximo 2 anos, por vencimento ou por pagamento.
const exportSchema = z
  .object({
    from: isoDate('Data inicial inválida'),
    to: isoDate('Data final inválida'),
    by: z.enum(['due', 'paid']).default('due'),
    status: z.enum(['PENDING', 'SENT', 'PAID', 'OVERDUE', 'CANCELED']).optional()
  })
  .superRefine((data, ctx) => {
    // Data inexistente já foi recusada acima; aqui só compara datas válidas.
    if (!isRealDate(data.from) || !isRealDate(data.to)) return;
    if (data.to < data.from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'A data final precisa ser igual ou posterior à inicial'
      });
    } else if (data.to > addDaysISO(data.from, 731)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Exporte no máximo 2 anos por vez'
      });
    }
  });

const STATUS_LABEL: Record<ChargeStatus, string> = {
  PENDING: 'Em aberto',
  SENT: 'Enviada',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
  CANCELED: 'Cancelada'
};

const BILLING_LABEL = { PIX: 'Pix', BOLETO: 'Boleto', UNDEFINED: 'Cliente escolhe' } as const;
const RECURRENCE_LABEL = { NONE: 'Avulsa', WEEKLY: 'Semanal', MONTHLY: 'Mensal', YEARLY: 'Anual' } as const;

/** CPF/CNPJ com máscara: como texto, o Excel não corta o zero à esquerda. */
function formatDocument(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return value ?? '';
}

/** 5551999887766 -> "(51) 99988-7766" (texto: não vira notação científica na planilha). */
function formatPhone(value: string | null): string {
  const digits = (value ?? '').replace(/\D/g, '');
  const local = digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length !== 10 && local.length !== 11) return value ?? '';
  return `(${local.slice(0, 2)}) ${local.slice(2, local.length - 4)}-${local.slice(-4)}`;
}

/** 12345 -> "123,45" (vírgula decimal: abre como número no Excel em português). */
const centsToCsv = (cents: number | null): string =>
  cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',');

export default function chargesRouter(deps: AppDeps): Router {
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const filters = listSchema.parse(req.query);
      const { items, total } = await listCharges({
        userId: req.userId,
        clientName: filters.q || undefined,
        status: filters.status as ChargeStatus | undefined,
        page: filters.page,
        pageSize: filters.pageSize
      });
      res.json({
        items: items.map(serializeCharge),
        total,
        page: filters.page,
        pageSize: filters.pageSize
      });
    })
  );

  // Relatório em CSV (para planilha ou para o contador). Vem antes das rotas
  // com :id para "export" nunca ser lido como um id.
  router.get(
    '/export',
    asyncHandler(async (req, res) => {
      const filters = exportSchema.parse(req.query);
      const rows = await listChargesForExport({
        userId: req.userId,
        from: filters.from,
        to: filters.to,
        by: filters.by,
        status: filters.status as ChargeStatus | undefined,
        timeZone: env.appTz
      });
      if (rows.length > EXPORT_MAX_ROWS) {
        throw new AppError(
          `O período tem mais de ${EXPORT_MAX_ROWS.toLocaleString('pt-BR')} faturas. Escolha um intervalo menor.`,
          422,
          'EXPORT_TOO_LARGE'
        );
      }
      const csv = toCsv(
        [
          'Cliente',
          'CPF/CNPJ',
          'Telefone',
          'Descrição',
          'Valor',
          'Vencimento',
          'Situação',
          'Pago em',
          'Valor líquido',
          'Forma de pagamento',
          'Recorrência'
        ],
        rows.map((row) => [
          row.client_name ?? '(cliente excluído)',
          formatDocument(row.client_document),
          formatPhone(row.client_phone),
          row.description,
          centsToCsv(row.amount_cents),
          formatDateBR(row.due_date),
          STATUS_LABEL[row.status],
          row.paid_on ? formatDateBR(row.paid_on) : '',
          row.status === 'PAID' ? centsToCsv(row.net_amount_cents ?? row.amount_cents) : '',
          BILLING_LABEL[row.billing_type],
          RECURRENCE_LABEL[row.recurrence]
        ])
      );
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="cobrancas-${filters.from}-a-${filters.to}.csv"`
      );
      res.setHeader('Cache-Control', 'no-store');
      res.send(csv);
    })
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const data = createSchema.parse(req.body);

      // O cliente precisa existir E pertencer ao tenant logado — impede que
      // um usuário crie cobranças "em nome" de clientes de outra conta.
      // deleted_at IS NULL: cliente excluído (soft delete) não recebe cobrança
      // nova — é preciso restaurá-lo primeiro (botão "Desfazer").
      const client = await queryOne<{ id: string }>(
        'SELECT id FROM clients WHERE id = $2 AND user_id = $1 AND deleted_at IS NULL',
        [req.userId, data.clientId]
      );
      if (!client) throw notFound('Cliente não encontrado');

      // Boleto e "cliente escolhe" dependem do gateway: hoje só o Asaas faz.
      if (data.billingType !== 'PIX') {
        const settings = await findSettingsByUserId(req.userId);
        const gateway = settings ? deps.gatewayFactory(settings) : null;
        if (!gateway?.supportsBoletoAndCard) {
          throw new AppError(
            'Boleto e cartão só estão disponíveis com o Asaas configurado em Configurações. ' +
              'Escolha Pix ou conecte o Asaas.',
            400,
            'BILLING_TYPE_UNAVAILABLE'
          );
        }
      }

      const charge = await createCharge({
        userId: req.userId,
        clientId: data.clientId,
        description: data.description,
        amountCents: data.amountCents,
        dueDate: data.dueDate,
        recurrence: data.recurrence,
        recurrenceEndDate: data.recurrenceEndDate ?? null,
        billingType: data.billingType
      });
      res.status(201).json(serializeCharge(charge));
    })
  );

  router.put(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = updateSchema.parse(req.body);

      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status !== 'PENDING' && existing.status !== 'SENT') {
        throw new AppError('Só é possível editar cobranças em aberto', 409);
      }

      // Valor ou vencimento mudou e já existe Pix no gateway: cancela a
      // cobrança antiga lá, senão o cliente ainda conseguiria pagar o valor
      // antigo e o webhook daria baixa na fatura com o valor novo. Falha aqui
      // não impede a edição (o Pix antigo deixa de ser enviado de todo modo).
      const pixOutdated =
        existing.amount_cents !== data.amountCents || existing.due_date !== data.dueDate;
      if (pixOutdated && existing.gateway_charge_id) {
        try {
          const settings = await findSettingsByUserId(req.userId);
          const gateway = settings ? deps.gatewayFactory(settings) : null;
          await gateway?.cancelCharge(existing.gateway_charge_id);
        } catch (error) {
          console.warn('[charges] não foi possível cancelar o Pix antigo no gateway:', error);
        }
      }

      let updated;
      try {
        updated = await updateCharge(req.userId, id, {
          description: data.description,
          amountCents: data.amountCents,
          dueDate: data.dueDate
        });
      } catch (error) {
        // UNIQUE(series_id, due_date): outro ciclo da série já ocupa a data.
        if ((error as { code?: string }).code === '23505') {
          throw new AppError('Já existe uma fatura desta série com esse vencimento', 409);
        }
        throw error;
      }
      // Entre o find e o update a fatura pode ter deixado de estar em aberto.
      if (!updated) throw new AppError('Só é possível editar cobranças em aberto', 409);

      res.json(
        serializeCharge({
          ...updated,
          client_name: existing.client_name,
          client_phone: existing.client_phone
        })
      );
    })
  );

  router.post(
    '/:id/pay',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status === 'PAID') throw new AppError('Fatura já está paga', 409);
      if (existing.status === 'CANCELED') {
        throw new AppError('Fatura cancelada não pode ser paga', 409);
      }
      const updated = await markChargePaid(req.userId, id);
      // Outra requisição (ou o webhook) deu baixa entre a leitura e o update.
      if (!updated) throw new AppError('Fatura já está paga', 409);
      publish(req.userId, { type: 'payment', chargeId: id, source: 'manual' });

      // Confirmação no WhatsApp: falha aqui NÃO desfaz a baixa — a fatura já
      // está PAGA e o resultado do envio fica em notification_logs.
      try {
        await sendPaymentConfirmation(deps, req.userId, id);
      } catch (error) {
        console.error('[charges] confirmação WhatsApp falhou:', error);
      }

      res.json(serializeCharge({ ...updated, client_name: existing.client_name, client_phone: existing.client_phone }));
    })
  );

  // Botão "Desfazer" do toast exibido logo após marcar como paga manualmente.
  router.post(
    '/:id/unpay',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await unmarkChargePaid(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível desfazer a baixa de faturas pagas', 409);
      }
      publish(req.userId, { type: 'payment', chargeId: id, source: 'manual_undo' });
      res.json(serializeCharge(updated));
    })
  );

  router.post(
    '/:id/cancel',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await cancelCharge(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível cancelar faturas pendentes ou atrasadas', 409);
      }
      res.json(serializeCharge(updated));
    })
  );

  // Botão "Reativar" — desfaz um cancelamento (o próprio ou o automático
  // disparado ao excluir o cliente, via undo do toast).
  router.post(
    '/:id/reactivate',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const updated = await reactivateCharge(req.userId, id);
      if (!updated) {
        throw new AppError('Só é possível reativar faturas canceladas', 409);
      }
      res.json(serializeCharge(updated));
    })
  );

  // Exclusão DEFINITIVA: só para faturas canceladas ou de cliente excluído.
  // Faturas em aberto/pagas são histórico financeiro e não podem sumir.
  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const existing = await findChargeById(req.userId, id);
      if (!existing) throw notFound('Fatura não encontrada');
      if (existing.status !== 'CANCELED' && existing.client_id !== null) {
        throw new AppError(
          'Só é possível excluir faturas canceladas ou de clientes excluídos',
          409
        );
      }
      const deleted = await deleteCharge(req.userId, id);
      if (!deleted) throw notFound('Fatura não encontrada');
      res.json({ ok: true });
    })
  );

  // Dispara imediatamente o fluxo do motor para UMA fatura: gera o Pix no
  // gateway (se configurado) e envia a mensagem no WhatsApp.
  router.post(
    '/:id/notify',
    asyncHandler(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const charge = await findChargeById(req.userId, id);
      if (!charge) throw notFound('Fatura não encontrada');
      if (charge.status === 'PAID' || charge.status === 'CANCELED') {
        throw new AppError('Esta fatura não está mais em aberto', 409);
      }
      const result = await notifyChargeNow(deps, req.userId, id);
      if (!result.sent) {
        throw new AppError(result.reason ?? 'Não foi possível enviar a cobrança', 422);
      }
      const refreshed = await findChargeById(req.userId, id);
      res.json({ sent: true, charge: serializeCharge(refreshed!) });
    })
  );

  return router;
}
