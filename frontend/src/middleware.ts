import { NextRequest, NextResponse } from 'next/server';

/**
 * Proteção de rotas (roda no servidor a cada navegação):
 *  1. sem cookie de sessão          -> /login
 *  2. sessão inválida/expirada       -> apaga o cookie e manda para /login
 *  3. e-mail não confirmado         -> /confirmar-email
 *  4. assinatura BLOQUEADA           -> /planos (exceto as páginas de pagamento)
 *  5. assinatura em atraso (WARNING) -> página abre normalmente, o layout mostra o aviso
 *
 * A fonte da verdade continua sendo o backend: toda rota de negócio da API
 * responde 402 para assinatura bloqueada, e o 401/402 também é tratado no
 * cliente (lib/api.ts). Se a API estiver fora, a navegação segue (fail-open),
 * porque os dados não carregariam de qualquer forma e o 402 continua valendo.
 */

// Mesmo nome do cookie httpOnly setado pelo backend (backend/src/middleware/auth.ts).
const AUTH_COOKIE = 'cpm_token';
// Chamada servidor -> servidor, sem passar pelo Caddy. Gravado no build.
const API_URL = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
const ACCESS_TIMEOUT_MS = 2_500;

/**
 * Páginas abertas sem login: recuperação de senha e confirmação de e-mail
 * (o link do e-mail pode ser aberto em outro aparelho, sem sessão).
 */
const PUBLIC_PAGES = ['/esqueci-senha', '/redefinir-senha', '/confirmar-email'];

/** Para onde vai quem ainda não confirmou o e-mail. */
const VERIFY_PAGE = '/confirmar-email';

/** Páginas que quem está bloqueado precisa para escolher o plano e pagar. */
const BILLING_PAGES = ['/planos', '/checkout'];

type AccessState = 'FULL' | 'WARNING' | 'BLOCKED';
interface Access {
  state: AccessState;
  reason: string;
  /** false = cadastro sem e-mail confirmado: só a página de confirmação abre. */
  emailVerified?: boolean;
}

type AccessResult = { kind: 'ok'; access: Access } | { kind: 'unauthenticated' } | { kind: 'unknown' };

async function fetchAccess(token: string): Promise<AccessResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACCESS_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}/billing/access`, {
      headers: { cookie: `${AUTH_COOKIE}=${token}` },
      cache: 'no-store',
      signal: controller.signal
    });
    if (response.status === 401) return { kind: 'unauthenticated' };
    if (!response.ok) {
      console.warn(`[middleware] ${API_URL}/billing/access respondeu ${response.status}: liberando a navegação`);
      return { kind: 'unknown' };
    }
    return { kind: 'ok', access: (await response.json()) as Access };
  } catch (error) {
    console.warn(`[middleware] API inacessível em ${API_URL}: liberando a navegação`, error);
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

function redirectTo(request: NextRequest, pathname: string, search?: Record<string, string>) {
  const url = new URL(pathname, request.url);
  for (const [key, value] of Object.entries(search ?? {})) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Recuperação de senha funciona logado ou não, sem consultar a API.
  // /f/<token>: página pública da fatura, aberta pelo cliente final sem login.
  if (PUBLIC_PAGES.includes(pathname) || pathname.startsWith('/f/')) {
    const response = NextResponse.next();
    // O token do link não pode vazar para outros sites pelo Referer.
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const isLoginPage = pathname === '/login';
  const isBillingPage = BILLING_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));

  if (!token) {
    return isLoginPage ? NextResponse.next() : redirectTo(request, '/login');
  }

  const result = await fetchAccess(token);

  if (result.kind === 'unauthenticated') {
    // Cookie presente mas inválido: apagá-lo aqui evita o loop /login <-> /dashboard.
    const response = isLoginPage ? NextResponse.next() : redirectTo(request, '/login');
    response.cookies.delete(AUTH_COOKIE);
    return response;
  }

  if (result.kind === 'unknown') {
    return isLoginPage ? redirectTo(request, '/dashboard') : NextResponse.next();
  }

  const { access } = result;
  const blocked = access.state === 'BLOCKED';

  if (access.emailVerified === false) {
    return redirectTo(request, VERIFY_PAGE);
  }

  if (isLoginPage) {
    return redirectTo(request, blocked ? '/planos' : '/dashboard');
  }
  if (blocked && !isBillingPage) {
    return redirectTo(request, '/planos', { motivo: access.reason.toLowerCase() });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
