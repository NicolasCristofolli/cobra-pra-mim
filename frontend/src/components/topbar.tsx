'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, ScrollText, Search, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPhoneBR } from '@/lib/format';
import { Avatar, ClientBadge, Spinner, initialsOf } from './ui';
import { useUser } from './user-context';
import type { Client } from '@/lib/types';

/**
 * Barra superior com busca global: encontra clientes em qualquer tela e dá
 * atalho para pesquisar o mesmo termo nas listas de clientes e cobranças.
 */
export function Topbar() {
  const router = useRouter();
  const user = useUser();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Client[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const trimmed = term.trim();

  // Busca com debounce de 300ms a partir de 2 caracteres.
  useEffect(() => {
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api<Client[]>(`/clients?q=${encodeURIComponent(trimmed)}`)
        .then((list) => setResults(list.slice(0, 5)))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [trimmed]);

  function go(path: string) {
    setOpen(false);
    setTerm('');
    setResults(null);
    router.push(path);
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
    }
  }

  const showDropdown = open && trimmed.length >= 2;

  return (
    <div className="border-b border-sand-200 bg-leaf-600 px-4 py-3 lg:px-8">
      {/* O justify-end empurra todos os itens para o final (direita) */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-4 2xl:max-w-7xl">
        
        {/* 1. BLOCO DE BUSCA */}
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
          <input
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Timeout: deixa o onMouseDown das opções rodar antes de fechar.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && trimmed) {
                go(`/clientes?q=${encodeURIComponent(trimmed)}`);
              }
              if (event.key === 'Escape') setOpen(false);
            }}
            placeholder="Buscar cliente ou cobrança…"
            autoComplete="off"
            className="w-full rounded-xl border border-sand-200 bg-sand-50/60 py-2 pl-10 pr-3.5 text-sm font-medium text-sand-900 placeholder:text-sand-400 focus:border-leaf-700 focus:bg-white focus:outline-none focus:shadow-focus"
          />

          {showDropdown && (
            <div className="absolute z-40 mt-1.5 w-full overflow-hidden rounded-xl border border-sand-200 bg-white shadow-float">
              {loading ? (
                <div className="flex items-center gap-2 px-3.5 py-3 text-sm text-sand-500">
                  <Spinner className="h-4 w-4" /> Buscando…
                </div>
              ) : results && results.length > 0 ? (
                <ul className="max-h-64 overflow-y-auto py-1">
                  {results.map((client) => (
                    <li key={client.id}>
                      <button
                        type="button"
                        onMouseDown={() => go(`/clientes?q=${encodeURIComponent(client.name)}`)}
                        className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-primary-50"
                      >
                        <Avatar name={client.name} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-sand-900">
                            {client.name}
                          </span>
                          <span className="block truncate text-xs text-sand-500">
                            {formatPhoneBR(client.phone)}
                          </span>
                        </span>
                        <ClientBadge status={client.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-3 text-sm text-sand-500">
                  Nenhum cliente encontrado com &ldquo;{trimmed}&rdquo;.
                </p>
              )}
              <div className="border-t border-sand-100">
                <button
                  type="button"
                  onMouseDown={() => go(`/clientes?q=${encodeURIComponent(trimmed)}`)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-sand-700 hover:bg-sand-50"
                >
                  <Users className="h-4 w-4 text-primary-600" />
                  Buscar &ldquo;{trimmed}&rdquo; em clientes
                </button>
                <button
                  type="button"
                  onMouseDown={() => go(`/cobrancas?q=${encodeURIComponent(trimmed)}`)}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-sand-700 hover:bg-sand-50"
                >
                  <ScrollText className="h-4 w-4 text-primary-600" />
                  Buscar &ldquo;{trimmed}&rdquo; em cobranças
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 2. BLOCO DO PERFIL */}
        <div className="flex shrink-0 items-center gap-2.5 rounded-lg bg-white px-3 py-2 shadow-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-[11px] font-bold text-leaf-700">
            {initialsOf(user.name)}
          </span>
          <p className="min-w-0 truncate text-[13px] font-semibold text-black">
            {user.name}
          </p>
          <button
            onClick={logout}
            title="Sair"
            className="shrink-0 rounded-lg p-1.5 text-black/60 transition-colors hover:bg-leaf-100 hover:text-danger-600"
          >
            <LogOut className="h-[15px] w-[15px]" />
          </button>
        </div>

      </div>
    </div>
  );
}