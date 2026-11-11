import type { CookieOptions, NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { queryOne } from '../db';
import { unauthorized } from '../lib/errors';

export const AUTH_COOKIE = 'cpm_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias
const JWT_ALGORITHM = 'HS256' as const;
const JWT_ISSUER = 'cobra-pra-mim-api';
const JWT_AUDIENCE = 'cobra-pra-mim-web';

/**
 * Conteúdo do token: só o id e a versão da sessão. Nada de e-mail, nome,
 * plano ou papel: o JWT é só assinado (não criptografado), e qualquer dado
 * nele fica legível para quem tiver o cookie.
 */
interface TokenPayload {
  sub: string;
  /** users.token_version no momento do login. Incrementar revoga todas as sessões. */
  tv: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
      /** users.email_verified_at preenchido. Carregado pelo requireAuth. */
      emailVerified: boolean;
    }
  }
}

export function signToken(userId: string, tokenVersion: number): string {
  return jwt.sign({ sub: userId, tv: tokenVersion } satisfies TokenPayload, env.jwtSecret, {
    algorithm: JWT_ALGORITHM,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: TOKEN_TTL_SECONDS
  });
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true, // inacessível ao JavaScript: XSS não rouba a sessão
    secure: env.isProd, // só HTTPS em produção
    // lax (e não strict): o retorno do checkout do Asaas é uma navegação
    // vinda de outro site e precisa chegar logado. POST cross-site continua
    // sem cookie, e o requireSameOrigin cobre o resto.
    sameSite: 'lax',
    path: '/'
  };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, { ...cookieOptions(), maxAge: TOKEN_TTL_SECONDS * 1000 });
}

export function clearAuthCookie(res: Response): void {
  // Mesmos atributos do set: alguns navegadores ignoram o clear se diferirem.
  res.clearCookie(AUTH_COOKIE, cookieOptions());
}

function verifyToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: [JWT_ALGORITHM], // nunca aceita "none" nem troca de algoritmo
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: 5
    }) as Partial<TokenPayload>;
    if (typeof payload.sub !== 'string' || typeof payload.tv !== 'number') return null;
    return { sub: payload.sub, tv: payload.tv };
  } catch {
    return null;
  }
}

/**
 * Exige sessão válida e injeta req.userId (o tenant de TODAS as queries).
 * Além da assinatura, confere no banco se o usuário existe e se a versão da
 * sessão ainda vale: "sair de todos os dispositivos" e a exclusão da conta
 * derrubam tokens que ainda não expiraram.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token: string | undefined = req.cookies?.[AUTH_COOKIE];
  if (!token) return next(unauthorized());

  const payload = verifyToken(token);
  if (!payload) {
    clearAuthCookie(res);
    return next(unauthorized('Sessão inválida ou expirada'));
  }

  queryOne<{ token_version: number; email_verified: boolean }>(
    'SELECT token_version, email_verified_at IS NOT NULL AS email_verified FROM users WHERE id = $1',
    [payload.sub]
  )
    .then((user) => {
      if (!user || user.token_version !== payload.tv) {
        clearAuthCookie(res);
        return next(unauthorized('Sessão encerrada. Entre novamente.'));
      }
      req.userId = payload.sub;
      req.emailVerified = user.email_verified;
      next();
    })
    .catch(next);
}

/**
 * Bloqueia com 403 quem ainda não confirmou o e-mail (vem depois do
 * requireAuth). Sem isso, dava para assinar e usar o painel com um e-mail
 * que não existe, e o "esqueci minha senha" nunca chegaria.
 */
export function requireVerifiedEmail(req: Request, res: Response, next: NextFunction): void {
  if (req.emailVerified) return next();
  res.status(403).json({
    error: 'Confirme seu e-mail para continuar. Enviamos um link para a sua caixa de entrada.',
    code: 'EMAIL_NOT_VERIFIED',
    redirectTo: '/confirmar-email'
  });
}

/** Respostas de autenticação nunca vão para cache (navegador, proxy, CDN). */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}
