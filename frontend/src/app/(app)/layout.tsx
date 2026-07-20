'use client';

import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { ToastProvider } from '@/components/toast';
import { FullPageSpinner } from '@/components/ui';
import { UserContext } from '@/components/user-context';
import { api } from '@/lib/api';
import type { User } from '@/lib/types';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // 401 aqui redireciona para /login dentro do próprio helper `api`.
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => undefined);
  }, []);

  if (!user) return <FullPageSpinner />;

  return (
    <UserContext.Provider value={user}>
      <ToastProvider>
        <div className="min-h-screen lg:flex">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
              <div className="mx-auto max-w-6xl 2xl:max-w-7xl">{children}</div>
            </main>
          </div>
        </div>
      </ToastProvider>
    </UserContext.Provider>
  );
}
