'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { User } from '@/lib/types';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const RESEND_COOLDOWN_SECONDS = 60;
const POLL_MS = 5_000;

const linkButton =
  'flex w-full items-center justify-center rounded-xl bg-primary-500 px-5 py-3 text-[15px] font-semibold text-sand-50 hover:bg-primary-600';

type View =
  | { kind: 'loading' }
  | { kind: 'verified'; loggedIn: boolean }
  | { kind: 'invalid-link'; loggedIn: boolean }
  | { kind: 'waiting'; email: string }
  | { kind: 'logged-out' };

/** Busca a sessão: null = sem login. */
async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>('/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

/**
 * Duas situações:
 *  - com ?token= (link do e-mail): confirma, logado ou não (outro aparelho);
 *  - sem token: logo depois do cadastro, mostra para onde o link foi e
 *    permite reenviar. Avança sozinha quando o e-mail é confirmado.
 */
export default function ConfirmEmailPage() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const showSession = useCallback(async () => {
    const me = await fetchMe();
    if (!me) return setView({ kind: 'logged-out' });
    if (me.emailVerified) return router.replace('/planos');
    setView({ kind: 'waiting', email: me.email });
  }, [router]);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    // Tira o token da barra de endereço e do histórico.
    window.history.replaceState(null, '', '/confirmar-email');

    if (!token) {
      showSession().catch(() => setView({ kind: 'logged-out' }));
      return;
    }

    (async () => {
      const valid = TOKEN_PATTERN.test(token);
      let ok = false;
      if (valid) {
        try {
          await api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
          ok = true;
        } catch {
          ok = false;
        }
      }
      const me = await fetchMe().catch(() => null);
      // Link velho, mas o e-mail já foi confirmado (ex.: clicou duas vezes).
      if (!ok && me?.emailVerified) ok = true;
      setView(ok ? { kind: 'verified', loggedIn: !!me } : { kind: 'invalid-link', loggedIn: !!me });
    })();
  }, [showSession]);

  // Confirmou pelo celular com esta aba aberta: segue sozinho.
  useEffect(() => {
    if (view.kind !== 'waiting') return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchMe()
        .then((me) => {
          if (me?.emailVerified) router.replace('/planos');
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [view.kind, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    setSending(true);
    setNotice(null);
    try {
      const result = await api<{ alreadyVerified?: boolean }>('/auth/resend-verification', { method: 'POST' });
      if (result.alreadyVerified) {
        router.replace('/planos');
        return;
      }
      setNotice({ tone: 'ok', text: 'Enviamos um novo link. Ele substitui os anteriores.' });
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (view.kind !== 'waiting') await showSession();
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'Não foi possível enviar agora. Tente de novo em instantes.'
      });
    } finally {
      setSending(false);
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
    }
  }

  const noticeLine = notice && (
    <p className={`text-sm font-semibold ${notice.tone === 'ok' ? 'text-leaf-700' : 'text-danger-600'}`}>
      {notice.text}
    </p>
  );

  switch (view.kind) {
    case 'loading':
      return null;

    case 'verified':
      return (
        <AuthShell title="E-mail confirmado" subtitle="Tudo certo! Agora é só escolher seu plano para ativar a conta.">
          <div className="flex items-center gap-3 rounded-xl bg-leaf-50 p-4 text-sm font-semibold text-leaf-700">
            <CheckCircle2 className="h-5 w-5 shrink-0" /> Seu e-mail foi verificado.
          </div>
          <Link href={view.loggedIn ? '/planos' : '/login'} className={linkButton}>
            {view.loggedIn ? 'Escolher meu plano' : 'Entrar na minha conta'}
          </Link>
        </AuthShell>
      );

    case 'invalid-link':
      return (
        <AuthShell title="Link inválido" subtitle="Este link expirou, já foi usado ou foi substituído por um mais novo.">
          {view.loggedIn ? (
            <>
              <Button size="lg" className="w-full" loading={sending} disabled={cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Enviar um novo link'}
              </Button>
              {noticeLine}
            </>
          ) : (
            <Link href="/login" className={linkButton}>
              Entrar para pedir um novo link
            </Link>
          )}
        </AuthShell>
      );

    case 'logged-out':
      return (
        <AuthShell
          title="Confirme seu e-mail"
          subtitle="Abra o link que enviamos para o seu e-mail. Para receber um novo, entre na sua conta."
        >
          <Link href="/login" className={linkButton}>
            Entrar
          </Link>
        </AuthShell>
      );

    case 'waiting':
      return (
        <AuthShell title="Confirme seu e-mail" subtitle="Falta só um passo para ativar sua conta.">
          <div className="flex gap-3 rounded-xl bg-primary-50 p-4 text-sm leading-relaxed text-sand-700">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
            <p>
              Enviamos um link para <strong className="break-all text-sand-900">{view.email}</strong>. Abra o e-mail
              e clique em <strong>Confirmar e-mail</strong>. Se não aparecer em alguns minutos, olhe também no spam.
            </p>
          </div>
          <Button
            variant="outline"
            size="lg"
            className="w-full"
            loading={sending}
            disabled={cooldown > 0}
            onClick={resend}
          >
            {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar e-mail'}
          </Button>
          {noticeLine}
          <p className="text-center text-[13px] text-sand-600">
            Digitou o e-mail errado?{' '}
            <button onClick={logout} className="font-semibold text-primary-600 hover:underline">
              Sair e criar a conta de novo
            </button>
          </p>
        </AuthShell>
      );
  }
}
