import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { unauthorized } from '../lib/errors';

export const AUTH_COOKIE = 'cpm_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias

interface TokenPayload {
  sub: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId } satisfies TokenPayload, env.jwtSecret, {
    expiresIn: TOKEN_TTL_SECONDS
  });
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/'
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
}

/** Exige sessão válida e injeta req.userId — o tenant de TODAS as queries. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(unauthorized());
  try {
    const payload = jwt.verify(token, env.jwtSecret) as TokenPayload;
    if (!payload.sub) return next(unauthorized());
    req.userId = payload.sub;
    next();
  } catch {
    next(unauthorized('Sessão inválida ou expirada'));
  }
}
