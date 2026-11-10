/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Card } from './ui';

/** Moldura simples das páginas públicas de conta (recuperação de senha). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sand-100 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <img src="/cobra-logo-on-light.svg" alt="Cobra pra mim" className="mx-auto h-10 w-auto" />
        <Card className="space-y-5 p-6 sm:p-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-sand-900">{title}</h1>
            <p className="mt-1 text-sm leading-relaxed text-sand-600">{subtitle}</p>
          </div>
          {children}
        </Card>
        <Link
          href="/login"
          className="mx-auto flex w-fit items-center gap-1.5 text-[13px] font-semibold text-sand-600 hover:text-sand-900"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para o login
        </Link>
      </div>
    </div>
  );
}
