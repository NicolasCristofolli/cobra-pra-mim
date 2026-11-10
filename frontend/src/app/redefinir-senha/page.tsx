'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    setToken(value && TOKEN_PATTERN.test(value) ? value : null);
    // Tira o token da barra de endereço e do histórico (não vaza em print nem em Referer).
    window.history.replaceState(null, '', '/redefinir-senha');
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError('As senhas não conferem.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      router.replace('/login?senha=redefinida');
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.issues?.map((issue) => issue.message).join(' · ');
        setError(details || err.message);
      } else {
        setError('Não foi possível salvar. Tente de novo.');
      }
      setLoading(false);
    }
  }

  if (token === undefined) return null;

  if (token === null) {
    return (
      <AuthShell title="Link inválido" subtitle="Este link está incompleto ou já expirou.">
        <Link
          href="/esqueci-senha"
          className="flex w-full items-center justify-center rounded-xl bg-primary-500 px-5 py-3 text-[15px] font-semibold text-sand-50 hover:bg-primary-600"
        >
          Pedir um novo link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar nova senha" subtitle="Ao salvar, você sai de todos os aparelhos e entra de novo com a senha nova.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nova senha" hint="De 8 a 72 caracteres, com letras e números.">
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
            autoFocus
          />
        </Field>
        <Field label="Repita a nova senha">
          <Input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
        </Field>
        {error && <p className="text-sm font-semibold text-danger-600">{error}</p>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Salvar nova senha
        </Button>
      </form>
    </AuthShell>
  );
}
