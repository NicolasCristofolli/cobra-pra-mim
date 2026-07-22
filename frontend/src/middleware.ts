import { NextRequest, NextResponse } from 'next/server';

// Mesmo nome do cookie httpOnly setado pelo backend (backend/src/middleware/auth.ts).
// Só a PRESENÇA importa aqui — a validade do JWT continua sendo enforced pelo
// backend em toda chamada via requireAuth(); isto só evita a tela do app
// aparecer, ainda que por um instante, para quem não está logado.
const AUTH_COOKIE = 'cpm_token';

export function middleware(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE)?.value);
  const isLoginPage = request.nextUrl.pathname === '/login';

  if (!hasSession && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (hasSession && isLoginPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)']
};
