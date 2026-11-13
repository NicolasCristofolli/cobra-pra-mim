/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SITE } from '@/lib/site';

/** Moldura das páginas de texto legal (Termos de Uso e Política de Privacidade). */
export function LegalPage({
  title,
  intro,
  children
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-sand-50">
      <header className="border-b border-sand-200/70 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" aria-label="Página inicial">
            <img src="/cobra-logo-on-light.svg" alt={SITE.name} className="h-9 w-auto" />
          </Link>
          <Link href="/login" className="text-[13px] font-bold text-primary-600 hover:text-primary-700">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-2xl font-bold tracking-tight text-sand-900 sm:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-sand-500">Última atualização: {SITE.legalUpdatedAt}</p>
        <p className="mt-5 text-[15px] leading-relaxed text-sand-700">{intro}</p>
        <div className="mt-8 space-y-8">{children}</div>
      </main>

      <footer className="border-t border-sand-200/70 bg-white">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-5 py-5 text-[13px] text-sand-500">
          <Link href="/" className="hover:text-sand-900">
            Página inicial
          </Link>
          <Link href="/termos" className="hover:text-sand-900">
            Termos de Uso
          </Link>
          <Link href="/privacidade" className="hover:text-sand-900">
            Política de Privacidade
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold tracking-tight text-sand-900">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-sand-700 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-sand-900 [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}

/** "Quem somos": só mostra o que estiver preenchido em lib/site.ts. */
export function ResponsibleParty() {
  return (
    <>
      O {SITE.name} é operado
      {SITE.legalName ? ` por ${SITE.legalName}` : ' pelos responsáveis indicados neste site'}
      {SITE.legalDocument ? ` (${SITE.legalDocument})` : ''}.
    </>
  );
}

/** Canal de contato: e-mail, quando preenchido. */
export function ContactChannel() {
  return SITE.contactEmail ? (
    <>
      pelo e-mail{' '}
      <a href={`mailto:${SITE.contactEmail}`} className="font-semibold text-primary-600 hover:text-primary-700">
        {SITE.contactEmail}
      </a>
    </>
  ) : (
    <>pelos canais de atendimento do {SITE.name}</>
  );
}
