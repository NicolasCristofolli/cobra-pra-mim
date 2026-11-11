import { isIPv6 } from 'node:net';
import type { Request } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';

/**
 * Chave de IP para rate limit. IPv4: o endereço. IPv6: o prefixo /56. Um
 * cliente IPv6 costuma receber um /64 (ou /56) inteiro e trocaria de
 * endereço a cada tentativa para fugir do limite.
 *
 * req.ip já é o IP real do cliente: Caddy -> (Next) -> API com
 * `trust proxy = 1`, e o Caddy sobrescreve o X-Forwarded-For enviado pelo cliente.
 */
export function ipKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return mapped[1]!;
  if (!isIPv6(ip)) return ip;

  const [head = '', tail = ''] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const groups = ip.includes('::')
    ? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts]
    : headParts;
  const full = groups.map((group) => group.padStart(4, '0').toLowerCase());
  // 56 bits = 3 grupos e meio
  return `${full.slice(0, 3).join(':')}:${full[3]!.slice(0, 2)}00::/56`;
}

const tooMany = (message: string) => ({ error: message, code: 'RATE_LIMITED' });

function limiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req: Request) => ipKey(req.ip),
    ...options
  });
}

/**
 * Fábrica: cada app (e cada teste) tem o próprio contador em memória. Uma
 * instância só da API (PM2 fork) dispensa um store compartilhado. Ao escalar
 * para várias instâncias, troque por rate-limit-redis.
 */
export function createAuthLimiters() {
  return {
    /** Por IP: barra varredura de muitas contas a partir da mesma origem. */
    loginByIp: limiter({
      windowMs: 15 * 60_000,
      limit: 20,
      skipSuccessfulRequests: true,
      message: tooMany('Muitas tentativas de login. Aguarde 15 minutos e tente de novo.')
    }),

    /**
     * Por conta: barra força bruta distribuída (botnet, vários IPs) contra
     * UMA conta. Só falhas contam. Contrapartida conhecida: depois de 10
     * erros em 15 minutos a conta fica bloqueada até para a senha certa, ou
     * seja, um terceiro consegue trancar o login de alguém por 15 minutos. O
     * dono sai do bloqueio na hora por "Esqueci minha senha".
     */
    loginByAccount: limiter({
      windowMs: 15 * 60_000,
      limit: 10,
      skipSuccessfulRequests: true,
      keyGenerator: (req: Request) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `acct:${email.slice(0, 254)}`;
      },
      message: tooMany('Muitas tentativas para esta conta. Aguarde 15 minutos ou redefina a senha.')
    }),

    /** "Esqueci a senha" por IP: evita usar o sistema para mandar e-mail em massa. */
    forgotByIp: limiter({
      windowMs: 15 * 60_000,
      limit: 5,
      message: tooMany('Muitos pedidos de redefinição. Aguarde 15 minutos.')
    }),

    /** "Esqueci a senha" por e-mail: não enche a caixa de entrada de ninguém. */
    forgotByAccount: limiter({
      windowMs: 60 * 60_000,
      limit: 3,
      keyGenerator: (req: Request) => {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        return `forgot:${email.slice(0, 254)}`;
      },
      message: tooMany('Já enviamos alguns links para este e-mail. Confira a caixa de entrada e o spam, ou tente em 1 hora.')
    }),

    /** Uso do token. Adivinhar um token de 256 bits é inviável, mas sem limite ninguém tenta. */
    reset: limiter({
      windowMs: 15 * 60_000,
      limit: 10,
      message: tooMany('Muitas tentativas. Aguarde 15 minutos.')
    }),

    /** Reenvio da confirmação, por conta (a rota exige login). */
    resendVerification: limiter({
      windowMs: 60 * 60_000,
      limit: 5,
      keyGenerator: (req: Request) => `verify:${req.userId ?? ipKey(req.ip)}`,
      message: tooMany('Já enviamos alguns e-mails de confirmação. Confira a caixa de entrada e o spam, ou tente em 1 hora.')
    }),

    /** Cadastro: contas em massa / spam a partir do mesmo IP. */
    register: limiter({
      windowMs: 60 * 60_000,
      limit: 5,
      message: tooMany('Muitos cadastros a partir desta rede. Tente novamente em 1 hora.')
    })
  };
}

/**
 * Checkout da assinatura, por conta: cada tentativa cria cliente/assinatura no
 * Asaas e segura uma conexão do banco. Ninguém precisa de mais que isso.
 */
export function createCheckoutLimiter() {
  return limiter({
    windowMs: 15 * 60_000,
    limit: 10,
    keyGenerator: (req: Request) => `checkout:${req.userId ?? ipKey(req.ip)}`,
    message: tooMany('Muitas tentativas de pagamento. Aguarde alguns minutos e tente de novo.')
  });
}
