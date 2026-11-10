'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardHeader, ConfirmDialog } from './ui';
import { useToast } from './toast';

/** Encerra todas as sessões abertas (celular perdido, senha exposta, computador compartilhado). */
export function SecurityCard() {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function logoutEverywhere() {
    setLoading(true);
    try {
      await api('/auth/logout-all', { method: 'POST' });
      window.location.href = '/login';
    } catch {
      push('error', 'Não foi possível encerrar as sessões. Tente de novo.');
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Segurança"
        subtitle="Encerre o acesso em todos os aparelhos onde sua conta está aberta."
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <p className="flex items-center gap-2 text-sm text-sand-600">
          <ShieldCheck className="h-4 w-4 text-leaf-600" />
          Use se perdeu um aparelho ou entrou num computador de outra pessoa.
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Sair de todos os dispositivos
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={logoutEverywhere}
        loading={loading}
        title="Sair de todos os dispositivos?"
        confirmLabel="Sair de todos"
        description="Todas as sessões serão encerradas, inclusive esta. Você precisará entrar de novo em cada aparelho."
      />
    </Card>
  );
}
