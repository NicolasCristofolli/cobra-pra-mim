'use client';

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Lock, ShieldCheck, Zap } from 'lucide-react';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

// Cards do painel de marca — texto do design.
const VALUE_PROPS = [
  {
    title: 'Cadastre uma vez',
    text: 'O resto acontece automaticamente, sem trabalho manual.'
  },
  {
    title: 'Lembretes que cobram por você',
    text: 'Mensagens automáticas por WhatsApp, no tom certo, na hora certa.'
  },
  {
    title: 'Confirmação automática',
    text: 'Pagamento identificado e baixado sozinho, sem conferência manual.'
  }
] as const;

const TRUST_BADGES = [
  { icon: ShieldCheck, label: 'Segurança' },
  { icon: Lock, label: 'LGPD' },
  { icon: Zap, label: 'Pix oficial' }
] as const;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Volta da redefinição de senha (window.location evita o Suspense do useSearchParams).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('senha') === 'redefinida') {
      setNotice('Senha alterada. Entre com a nova senha.');
    }
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
      } else {
        await api('/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, password })
        });
      }
      // Conta nova não tem plano: vai direto escolher (passo 1 do fluxo).
      // No login, o middleware decide entre o painel e /planos.
      router.replace(mode === 'register' ? '/planos' : '/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.issues?.map((issue) => issue.message).join(' · ');
        setError(details ? `${err.message}: ${details}` : err.message);
      } else {
        setError('Não foi possível conectar. A API está no ar?');
      }
      setLoading(false);
    }
  }

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
  }

  return (
    <div className="flex min-h-screen">
      {/* Painel de marca — azul Cobra */}
      <section className="relative hidden w-[46%] min-w-[440px] flex-col justify-between overflow-hidden bg-primary-500 p-14 lg:flex">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 85% 12%, rgba(255,255,255,0.07), transparent 45%), radial-gradient(circle at 8% 92%, rgba(255,255,255,0.06), transparent 40%)'
          }}
          aria-hidden
        />

        <img
          src="/cobra-logo-on-blue.svg"
          alt="Cobra pra mim"
          className="relative z-[1] h-[46px] w-auto self-start"
        />

        <div className="relative z-[1] flex flex-col gap-3.5">
          <h1 className="mb-2 text-[26px] font-bold leading-snug text-white">
            Você pede,
            <br />a gente cobra.
          </h1>
          {VALUE_PROPS.map(({ title, text }) => (
            <div
              key={title}
              className="flex flex-col gap-1 rounded-2xl border border-white/20 bg-white/10 px-5 py-[18px]"
            >
              <p className="text-[15px] font-bold text-white">{title}</p>
              <p className="text-[12.5px] leading-relaxed text-white/75">{text}</p>
            </div>
          ))}
        </div>

        <div className="relative z-[1] flex items-center gap-[22px]">
          {TRUST_BADGES.map(({ icon: Icon, label }) => (
            <span
              key={label}
              className="flex items-center gap-[7px] text-xs font-semibold text-white/80"
            >
              <Icon className="h-4 w-4" />
              {label}
            </span>
          ))}
        </div>
      </section>

      {/* Formulário sobre o creme */}
      <section className="flex flex-1 flex-col items-center justify-center bg-white px-6 py-12">
        <div className="flex w-full max-w-[360px] flex-col gap-[22px]">
          <img
            src="/cobra-logo-on-light.svg"
            alt="Cobra pra mim"
            className="h-10 w-auto self-start lg:hidden"
          />

          <div className="flex flex-col gap-1.5">
            <h2 className="text-2xl font-bold text-sand-900">
              {mode === 'login' ? 'Bem-vindo de volta' : 'Criar sua conta'}
            </h2>
            <p className="text-sm leading-relaxed text-sand-600">
              {mode === 'login'
                ? 'Entre para continuar cobrando com tranquilidade.'
                : 'Leva menos de um minuto — sem cartão de crédito.'}
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <Field label="Seu nome">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Maria Empreendedora"
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </Field>
            )}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.com"
                autoComplete="email"
                maxLength={254}
                required
              />
            </Field>
            <Field
              label="Senha"
              hint={mode === 'register' ? 'De 8 a 72 caracteres, com letras e números.' : undefined}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'register' ? 8 : undefined}
                maxLength={mode === 'register' ? 72 : 256}
                required
              />
            </Field>
            {mode === 'login' && (
              <Link
                href="/esqueci-senha"
                className="-mt-2 self-end text-[13px] font-semibold text-primary-600 hover:text-primary-700"
              >
                Esqueci minha senha
              </Link>
            )}

            {notice && !error && (
              <p className="rounded-xl bg-leaf-50 px-3 py-2 text-sm text-leaf-700 ring-1 ring-inset ring-leaf-600/20">
                {notice}
              </p>
            )}

            {error && (
              <p className="rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700 ring-1 ring-inset ring-danger-100">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {mode === 'login' ? 'Entrar' : 'Criar conta e entrar'}
            </Button>

            <p className="text-center text-[13px] font-medium text-sand-600">
              {mode === 'login' ? (
                <>
                  Não tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="font-semibold text-primary-600 hover:text-primary-700"
                  >
                    Criar conta
                  </button>
                </>
              ) : (
                <>
                  Já tem conta?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="font-semibold text-primary-600 hover:text-primary-700"
                  >
                    Entrar
                  </button>
                </>
              )}
            </p>
          </form>

        </div>
      </section>
    </div>
  );
}
