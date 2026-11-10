'use client';

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut } from 'lucide-react';
import { ToastProvider } from '@/components/toast';
import { FullPageSpinner } from '@/components/ui';
import { UserContext } from '@/components/user-context';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

/**
 * Layout das páginas de assinatura. Fica fora do layout do app (sem menu),
 * porque quem está bloqueado só pode estar aqui. Quem tem acesso vê o link
 * de volta para o painel.
 */
export default function BillingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => undefined);
  }, []);

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  if (!user) return <FullPageSpinner />;

  return (
    <UserContext.Provider value={user}>
      <ToastProvider>
        <div className="min-h-screen bg-sand-100">
          <header className="border-b border-sand-200/70 bg-white">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
              <img src="/cobra-logo-on-light.svg" alt="Cobra pra mim" className="h-8 w-auto" />
              <div className="flex items-center gap-1">
                {user.access.state !== 'BLOCKED' && (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-sand-600 hover:bg-sand-900/5 hover:text-sand-900"
                  >
                    <ArrowLeft className="h-4 w-4" /> Voltar ao painel
                  </Link>
                )}
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-sand-600 hover:bg-sand-900/5 hover:text-danger-600"
                >
                  <LogOut className="h-4 w-4" /> Sair
                </button>
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8 lg:py-12">{children}</main>
        </div>
      </ToastProvider>
    </UserContext.Provider>
  );
}
