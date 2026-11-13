/* eslint-disable @next/next/no-img-element */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlarmClock,
  BarChart3,
  Check,
  CheckCircle2,
  FileSpreadsheet,
  Link2,
  MessageCircle,
  QrCode,
  Repeat,
  ShieldCheck,
  Wallet
} from 'lucide-react';
import { formatBRL } from '@/lib/format';
import { SITE } from '@/lib/site';
import type { Plan, PublicPlans } from '@/lib/types';

// Os preços vêm da API a cada visita (com cache de 5 minutos no fetch): a
// página nunca mostra um valor diferente do cobrado na assinatura.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cobra pra mim — cobranças automáticas por WhatsApp com Pix',
  description:
    'Cadastre o cliente uma vez. O Cobra pra mim envia a cobrança no WhatsApp no vencimento, lembra quem atrasou e dá baixa sozinho quando o Pix cai. Teste grátis.',
  alternates: { canonical: SITE.url },
  openGraph: {
    title: 'Cobra pra mim — cobranças automáticas por WhatsApp com Pix',
    description:
      'Envio automático de cobranças no WhatsApp, lembretes para quem atrasou e baixa automática do pagamento.',
    url: SITE.url,
    siteName: SITE.name,
    locale: 'pt_BR',
    type: 'website'
  }
};

const API_URL = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
const REGISTER_URL = '/login?modo=cadastro';

/** Planos e dias de teste. null = API fora do ar: a página abre sem a tabela de preços. */
async function fetchPlans(): Promise<PublicPlans | null> {
  try {
    const response = await fetch(`${API_URL}/public/plans`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return null;
    const data = (await response.json()) as PublicPlans;
    return Array.isArray(data.plans) && data.plans.length > 0 ? data : null;
  } catch {
    return null;
  }
}

const STEPS = [
  {
    title: 'Conecte seu WhatsApp e seu gateway',
    text: 'Leia um QR Code com o celular e informe a chave do Asaas ou do Mercado Pago. O dinheiro cai direto na sua conta.'
  },
  {
    title: 'Cadastre clientes e cobranças',
    text: 'Um por um ou importando uma planilha. Cobranças avulsas ou recorrentes: semanais, mensais ou anuais.'
  },
  {
    title: 'Deixe o resto com a gente',
    text: 'No vencimento, a mensagem sai com o Pix. Quem atrasa recebe lembretes. Quando o pagamento cai, a baixa é automática.'
  }
] as const;

const FEATURES = [
  {
    icon: AlarmClock,
    title: 'Régua de cobrança',
    text: 'Lembretes antes do vencimento, cobrança no dia e avisos depois do atraso, nos dias e no horário que você escolher.'
  },
  {
    icon: QrCode,
    title: 'Pix, boleto e cartão',
    text: 'Pix copia e cola na própria mensagem. Com o Asaas, também boleto e cartão de crédito.'
  },
  {
    icon: CheckCircle2,
    title: 'Baixa automática',
    text: 'O pagamento é identificado pelo gateway e a fatura é marcada como paga, com confirmação ao cliente.'
  },
  {
    icon: Repeat,
    title: 'Cobranças recorrentes',
    text: 'Mensalidades e assinaturas geradas sozinhas a cada ciclo, até a data que você definir.'
  },
  {
    icon: Link2,
    title: 'Página da fatura',
    text: 'Cada cobrança tem um link com QR Code, valor e situação, que o cliente abre no celular sem instalar nada.'
  },
  {
    icon: BarChart3,
    title: 'Painel e relatórios',
    text: 'Recebido, pendente e inadimplência em tempo real. Exportação em planilha e resumo mensal por e-mail.'
  },
  {
    icon: FileSpreadsheet,
    title: 'Importação de planilha',
    text: 'Traga toda a sua carteira de clientes de um arquivo CSV em poucos cliques.'
  },
  {
    icon: ShieldCheck,
    title: 'Cuidado com o seu número',
    text: 'Limite diário de mensagens, intervalo entre os envios e opção de não enviar para quem pediu.'
  }
] as const;

function faq(trialDays: number | null) {
  return [
    {
      question: 'Preciso de cartão de crédito para testar?',
      answer: `Não. Você cria a conta${
        trialDays ? `, usa por ${trialDays} dias` : ' e usa durante o período de teste'
      } com todos os recursos e só escolhe um plano se quiser continuar.`
    },
    {
      question: 'De qual número as mensagens saem?',
      answer:
        'Do seu próprio WhatsApp, conectado por QR Code, como no WhatsApp Web. Seus clientes recebem a cobrança de um número que já conhecem e podem responder normalmente. Como é uma conexão não oficial, o sistema limita o volume diário e espaça os envios para proteger o seu número.'
    },
    {
      question: 'O dinheiro passa pelo Cobra pra mim?',
      answer:
        'Não. Os pagamentos caem direto na sua conta do Asaas ou do Mercado Pago. O Cobra pra mim só gera a cobrança e recebe o aviso de que ela foi paga.'
    },
    {
      question: 'Preciso ter conta no Asaas ou no Mercado Pago?',
      answer:
        'Sim, em um dos dois, para gerar o Pix e identificar o pagamento automaticamente. O tutorial dentro do sistema mostra o passo a passo.'
    },
    {
      question: 'Posso cancelar quando quiser?',
      answer:
        'Sim, direto no painel, sem fidelidade. O acesso continua até o fim do período já pago.'
    }
  ];
}

function PlanCard({ plan, highlight, trialDays }: { plan: Plan; highlight: boolean; trialDays: number }) {
  const yearly = plan.cycle === 'YEARLY';
  return (
    <div
      className={`flex flex-col rounded-3xl bg-white p-7 shadow-card ring-1 ${
        highlight ? 'ring-2 ring-primary-500' : 'ring-sand-200/70'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-sand-900">{plan.name}</h3>
        {highlight && (
          <span className="rounded-full bg-leaf-100 px-2.5 py-1 text-[11px] font-bold text-leaf-800">
            Melhor preço
          </span>
        )}
      </div>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="text-4xl font-extrabold tracking-tight text-sand-900">
          {formatBRL(plan.priceCents)}
        </span>
        <span className="text-sm font-semibold text-sand-500">{yearly ? '/ano' : '/mês'}</span>
      </p>
      {yearly && (
        <p className="mt-1 text-[13px] text-sand-500">
          Equivale a {formatBRL(Math.round(plan.priceCents / 12))} por mês.
        </p>
      )}
      {plan.description && <p className="mt-3 text-sm leading-relaxed text-sand-600">{plan.description}</p>}
      <ul className="mt-5 flex-1 space-y-2 text-sm text-sand-700">
        {['Clientes e cobranças ilimitados', 'Régua de cobrança no WhatsApp', 'Baixa automática de pagamentos'].map(
          (item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-leaf-600" />
              {item}
            </li>
          )
        )}
      </ul>
      <Link
        href={REGISTER_URL}
        className={`mt-6 inline-flex items-center justify-center rounded-xl px-5 py-3 text-[15px] font-bold transition-colors ${
          highlight
            ? 'bg-primary-500 text-white shadow-sm hover:bg-primary-600'
            : 'border border-sand-200 bg-white text-sand-900 hover:bg-sand-50'
        }`}
      >
        Testar grátis por {trialDays} dias
      </Link>
    </div>
  );
}

export default async function LandingPage() {
  const pricing = await fetchPlans();
  const trialDays = pricing?.trialDays ?? null;
  const trialLabel = trialDays ? `Testar grátis por ${trialDays} dias` : 'Testar grátis';
  const cheapestYearly = pricing?.plans.find((plan) => plan.cycle === 'YEARLY')?.code;

  return (
    <div className="min-h-screen bg-white text-sand-900">
      {/* Topo */}
      <header className="sticky top-0 z-30 border-b border-sand-200/70 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
          <Link href="/" aria-label="Cobra pra mim">
            <img src="/cobra-logo-on-light.svg" alt="Cobra pra mim" className="h-9 w-auto" />
          </Link>
          <nav className="hidden items-center gap-7 text-[13.5px] font-semibold text-sand-600 md:flex">
            <a href="#como-funciona" className="hover:text-sand-900">
              Como funciona
            </a>
            <a href="#recursos" className="hover:text-sand-900">
              Recursos
            </a>
            {pricing && (
              <a href="#precos" className="hover:text-sand-900">
                Preços
              </a>
            )}
            <a href="#duvidas" className="hover:text-sand-900">
              Dúvidas
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-xl px-3 py-2 text-[13.5px] font-bold text-sand-700 hover:bg-sand-50"
            >
              Entrar
            </Link>
            <Link
              href={REGISTER_URL}
              className="rounded-xl bg-primary-500 px-4 py-2 text-[13.5px] font-bold text-white shadow-sm hover:bg-primary-600"
            >
              Testar grátis
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Abertura */}
        <section className="bg-sand-50">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-16 lg:grid-cols-2 lg:py-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-leaf-100 px-3 py-1 text-xs font-bold text-leaf-800">
                <MessageCircle className="h-3.5 w-3.5" /> Cobrança por WhatsApp com Pix
              </p>
              <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
                Suas cobranças saem sozinhas pelo WhatsApp.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-sand-600">
                Cadastre o cliente uma vez. O Cobra pra mim envia a cobrança com o Pix no
                vencimento, lembra quem atrasou e dá baixa quando o pagamento cai.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href={REGISTER_URL}
                  className="inline-flex items-center justify-center rounded-xl bg-primary-500 px-6 py-3.5 text-base font-bold text-white shadow-sm hover:bg-primary-600"
                >
                  {trialLabel}
                </Link>
                <a
                  href="#como-funciona"
                  className="inline-flex items-center justify-center rounded-xl px-5 py-3.5 text-base font-bold text-sand-700 hover:bg-sand-100"
                >
                  Ver como funciona
                </a>
              </div>
              <p className="mt-4 text-sm text-sand-500">
                Sem cartão de crédito. Cancele quando quiser.
              </p>
            </div>

            {/* Ilustração: a conversa que o cliente recebe */}
            <div className="mx-auto w-full max-w-md" aria-hidden>
              <div className="rounded-[28px] bg-[#e5ddd5] p-5 shadow-float">
                <div className="mb-4 flex items-center gap-3 rounded-2xl bg-white/80 px-3.5 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-500 text-sm font-bold text-white">
                    SE
                  </span>
                  <div>
                    <p className="text-sm font-bold text-sand-900">Studio Exemplo</p>
                    <p className="text-[11px] text-sand-500">online</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-sand-900 shadow-card">
                    Olá, Maria! 👋
                    <br />
                    Sua fatura de <strong>R$ 150,00</strong> (Mensalidade) vence hoje.
                    <br />
                    Pague com o Pix copia e cola abaixo:
                    <span className="mt-1.5 block break-all rounded-lg bg-sand-50 px-2 py-1.5 font-mono text-[10.5px] text-sand-600">
                      00020126580014BR.GOV.BCB.PIX0136…
                    </span>
                    <span className="mt-1 block text-right text-[10px] text-sand-400">08:00</span>
                  </div>
                  <div className="ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] px-3.5 py-2.5 text-[13.5px] text-sand-900 shadow-card">
                    Pago! 🙌
                    <span className="mt-1 block text-right text-[10px] text-sand-500">08:12</span>
                  </div>
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-sand-900 shadow-card">
                    Maria, recebemos seu pagamento de R$ 150,00. ✅ Obrigado!
                    <span className="mt-1 block text-right text-[10px] text-sand-400">08:12</span>
                  </div>
                </div>
              </div>
              <div className="-mt-5 ml-auto mr-4 flex w-fit items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-float ring-1 ring-sand-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-leaf-50">
                  <Wallet className="h-4 w-4 text-leaf-600" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold text-sand-500">Fatura paga</p>
                  <p className="text-sm font-bold text-leaf-700">+ R$ 150,00</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Como funciona */}
        <section id="como-funciona" className="scroll-mt-20">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight">Como funciona</h2>
            <p className="mt-2 max-w-2xl text-base text-sand-600">
              Você configura uma vez, em poucos minutos. Depois, as cobranças saem no automático.
            </p>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-3xl bg-sand-50 p-7">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-500 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-sand-600">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Recursos */}
        <section id="recursos" className="scroll-mt-20 bg-sand-50">
          <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight">
              Tudo para você parar de correr atrás de pagamento
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="rounded-2xl bg-white p-6 shadow-card ring-1 ring-sand-200/60">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50">
                    <Icon className="h-5 w-5 text-primary-600" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-sand-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Preços */}
        {pricing && (
          <section id="precos" className="scroll-mt-20">
            <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
              <h2 className="text-3xl font-extrabold tracking-tight">Preço simples</h2>
              <p className="mt-2 max-w-2xl text-base text-sand-600">
                Comece com {pricing.trialDays} dias grátis, sem cartão. Depois, um único plano com
                tudo incluído.
              </p>
              <div className="mt-10 grid max-w-3xl gap-5 md:grid-cols-2">
                {pricing.plans.map((plan) => (
                  <PlanCard
                    key={plan.code}
                    plan={plan}
                    highlight={plan.code === cheapestYearly}
                    trialDays={pricing.trialDays}
                  />
                ))}
              </div>
              <p className="mt-5 text-sm text-sand-500">
                As tarifas do Asaas ou do Mercado Pago por pagamento recebido são cobradas por eles,
                direto na sua conta.
              </p>
            </div>
          </section>
        )}

        {/* Dúvidas */}
        <section id="duvidas" className="scroll-mt-20 bg-sand-50">
          <div className="mx-auto max-w-3xl px-5 py-16 lg:py-20">
            <h2 className="text-3xl font-extrabold tracking-tight">Dúvidas frequentes</h2>
            <div className="mt-8 space-y-3">
              {faq(trialDays).map(({ question, answer }) => (
                <details
                  key={question}
                  className="group rounded-2xl bg-white px-5 py-4 shadow-card ring-1 ring-sand-200/60"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-bold [&::-webkit-details-marker]:hidden">
                    {question}
                    <span className="text-xl font-normal text-sand-400 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-sand-600">{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Chamada final */}
        <section className="bg-primary-500">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-14">
            <div>
              <h2 className="text-3xl font-extrabold tracking-tight text-white">
                Você pede, a gente cobra.
              </h2>
              <p className="mt-2 text-base text-white/80">
                Crie sua conta e veja a primeira cobrança sair ainda hoje.
              </p>
            </div>
            <Link
              href={REGISTER_URL}
              className="inline-flex items-center justify-center rounded-xl bg-white px-6 py-3.5 text-base font-bold text-primary-700 shadow-sm hover:bg-sand-50"
            >
              {trialLabel}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-sand-200/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-[13px] text-sand-500">
          <p>
            © {new Date().getFullYear()} {SITE.name}
            {SITE.legalName ? ` · ${SITE.legalName}` : ''}
            {SITE.legalDocument ? ` · ${SITE.legalDocument}` : ''}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/termos" className="hover:text-sand-900">
              Termos de Uso
            </Link>
            <Link href="/privacidade" className="hover:text-sand-900">
              Política de Privacidade
            </Link>
            <Link href="/login" className="hover:text-sand-900">
              Entrar
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
