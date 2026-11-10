'use client';

import { useState, type FormEvent } from 'react';
import { MailCheck } from 'lucide-react';
import { AuthShell } from '@/components/auth-shell';
import { Button, Field, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar. Tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthShell title="Confira seu e-mail" subtitle="Se este e-mail estiver cadastrado, enviamos um link para criar uma nova senha.">
        <div className="flex items-start gap-3 rounded-xl bg-leaf-50 p-4 text-sm text-leaf-800 ring-1 ring-inset ring-leaf-600/20">
          <MailCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            O link vale por <strong>30 minutos</strong> e só pode ser usado uma vez. Não chegou? Olhe a pasta de
            spam ou peça de novo daqui a alguns minutos.
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={() => setSent(false)}>
          Usar outro e-mail
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta. Vamos enviar um link para você criar uma nova senha.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@empresa.com"
            autoComplete="email"
            maxLength={254}
            required
            autoFocus
          />
        </Field>
        {error && <p className="text-sm font-semibold text-danger-600">{error}</p>}
        <Button type="submit" size="lg" loading={loading} className="w-full">
          Enviar link
        </Button>
      </form>
    </AuthShell>
  );
}
