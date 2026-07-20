'use client';

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  LogOut,
  MessageSquareText,
  ScrollText,
  Settings,
  Users
} from 'lucide-react';
import { api } from '@/lib/api';
import { cx } from './ui';

// Ícones só aparecem na barra mobile; no desktop o design usa o "dot".
const NAV = [
  { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/cobrancas', label: 'Cobranças', icon: ScrollText },
  { href: '/mensagens', label: 'Mensagens', icon: MessageSquareText }
] as const;

function NavItem({
  href,
  label,
  active
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-colors',
        active
          ? 'bg-white text-black shadow-card'
          : 'text-white hover:bg-leaf-400/60'
      )}
    >
      <span
        className={cx(
          'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
          active ? 'bg-leaf-700' : 'bg-ink/30'
        )}
      />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  return (
    <>
      {/* Desktop: coluna verde da marca, com dots de navegação */}
      <aside className="sticky top-0 hidden max-h-screen min-h-screen w-[232px] shrink-0 flex-col border-r border-leaf-600/40 bg-leaf-700 px-3.5 py-5 lg:flex">
        <div className="px-1 pb-6 pt-1">
          {/* Chip branco: o logo usa o verde da marca e sumiria direto no fundo. */}
          <div className="inline-flex rounded-xl bg-white px-3 py-2 shadow-card">
            <img src="/cobra-logo-on-light.svg" alt="Cobra pra mim" className="h-9 w-auto" />
          </div>
        </div>

        <nav className="flex-1 space-y-0.5">
          {NAV.map(({ href, label }) => (
            <NavItem
              key={href}
              href={href}
              label={label}
              active={pathname.startsWith(href)}
            />
          ))}
        </nav>

        {/* O perfil do usuário fica na Topbar, ao lado da busca. */}
        <div className="space-y-0.5 border-t border-leaf-400 pt-3">
          <NavItem
            href="/configuracoes"
            label="Configurações"
            active={pathname.startsWith('/configuracoes')}
          />
        </div>
      </aside>

      {/* Mobile: barra superior verde com navegação por ícones */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-leaf-600/40 bg-leaf-500 px-4 py-3 lg:hidden">
        <span className="inline-flex shrink-0 rounded-lg bg-white p-1 shadow-card">
          <img src="/cobra-icon-snake.svg" alt="Cobra pra mim" className="h-7 w-auto" />
        </span>
        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {[
            ...NAV,
            { href: '/configuracoes', label: 'Configurações', icon: Settings }
          ].map(
            ({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={cx(
                    'shrink-0 rounded-lg p-2.5 transition-colors',
                    active
                      ? 'bg-white text-leaf-700 shadow-card'
                      : 'text-ink/70 hover:bg-leaf-400/60 hover:text-ink'
                  )}
                >
                  <Icon className="h-5 w-5" />
                </Link>
              );
            }
          )}
          <button
            onClick={logout}
            title="Sair"
            className="shrink-0 rounded-lg p-2.5 text-ink/70 hover:bg-leaf-400/60 hover:text-danger-600"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </nav>
      </div>
    </>
  );
}