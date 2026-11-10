import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Defesa extra contra CSRF, além do SameSite=Lax do cookie. Requisição que
 * altera dados e traz um Origin de outro site é recusada. Sem Origin (curl,
 * servidor, webhook do gateway) passa: esses clientes não carregam o cookie
 * da vítima, e os webhooks se autenticam por token próprio.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();

  const allowed = new Set(
    [env.frontendOrigin, env.appUrl].map(originOf).filter((value): value is string => Boolean(value))
  );
  if (allowed.has(origin)) return next();

  res.status(403).json({ error: 'Origem não permitida', code: 'FORBIDDEN_ORIGIN' });
}
