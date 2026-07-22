import { Router } from 'express';
import { z } from 'zod';
import { queryOne } from '../../db';
import { asyncHandler, AppError, notFound } from '../../lib/errors';
import { todayISO } from '../../lib/dates';
import { requireAuth } from '../../middleware/auth';
import { publish } from '../../lib/events';
import { notifyChargeNow, sendPaymentConfirmation } from '../../services/billing-engine';
import type { AppDeps } from '../../services/deps';
import {
  cancelCharge,
  createCharge,
  deleteCharge,
  findChargeById,
  listCharges,
  markChargePaid,
  reactivateCharge,
  serializeCharge,
  updateCharge,
  type ChargeStatus
} from './charges.repo';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    clientId: z.string().uuid('Selecione um cliente'),
    description: z.string().trim().min(2, 'Descreva a cobrança'),
    amountCents: z.number().int().positive('Valor precisa ser maior que zero'),
    dueDate: z.string().regex(ISO_DATE, 'Data de vencimento inválida'),
    recurrence: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY']).default('NONE'),
    recurrenceEndDate: z
      .string()
      .regex(ISO_DATE, 'Data limite da recorrência inválida')
      .nullish()
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
  amountCents: z.number().int().positive('Valor precisa ser maior que zero'),
  dueDate: z.string().regex(ISO_DATE, 'Data de vencimento inválida')
});

const listSchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(['PENDING', 'SENT', 'PAID', 'OVERDUE', 'CANCELED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50)
});

const idParam = z.object({ id: z.string().uuid() });

export default function chargesRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth);

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

      const charge = await createCharge({
        userId: req.userId,
        clientId: data.clientId,
        description: data.description,
        amountCents: data.amountCents,
        dueDate: data.dueDate,
        recurrence: data.recurrence,
        recurrenceEndDate: data.recurrenceEndDate ?? null
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
      publish(req.userId, { type: 'payment', chargeId: id, source: 'manual' });

      // Confirmação no WhatsApp: falha aqui NÃO desfaz a baixa — a fatura já
      // está PAGA e o resultado do envio fica em notification_logs.
      try {
        await sendPaymentConfirmation(deps, req.userId, id);
      } catch (error) {
        console.error('[charges] confirmação WhatsApp falhou:', error);
      }

      res.json(serializeCharge({ ...updated!, client_name: existing.client_name, client_phone: existing.client_phone }));
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
