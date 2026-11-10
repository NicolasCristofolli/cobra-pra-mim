import type { NextFunction, Request, Response } from 'express';
import type { Access } from '../services/subscription/access';
import { findAccessByUser } from '../services/subscription/subscription.repo';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      access?: Access;
    }
  }
}

/**
 * Calcula o acesso do usuário logado (1 consulta por chave única) e anuncia
 * o atraso no header X-Subscription-Warning, que o frontend usa para o aviso.
 * O status NÃO vai no JWT: o webhook muda a assinatura enquanto o token
 * continua válido por até 7 dias.
 */
export function loadAccess(req: Request, res: Response, next: NextFunction): void {
  findAccessByUser(req.userId)
    .then((access) => {
      req.access = access;
      if (access.state === 'WARNING' && access.blocksAt) {
        res.setHeader('X-Subscription-Warning', access.blocksAt);
      }
      next();
    })
    .catch(next);
}

/** Bloqueia rotas de negócio com 402 quando a assinatura não libera acesso. */
export function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const access = req.access;
  if (!access) {
    next(new Error('requireActiveSubscription exige loadAccess antes'));
    return;
  }
  if (access.state !== 'BLOCKED') {
    next();
    return;
  }
  res.status(402).json({
    error:
      access.reason === 'EXPIRED'
        ? 'Sua assinatura expirou. Renove para continuar usando o Cobra pra mim.'
        : 'Escolha um plano e conclua o pagamento para ativar sua conta.',
    code: `SUBSCRIPTION_${access.reason}`,
    redirectTo: '/planos'
  });
}
