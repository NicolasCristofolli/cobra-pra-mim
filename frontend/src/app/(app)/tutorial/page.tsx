import Link from 'next/link';
import { WebhookTutorial } from '@/components/webhook-tutorial';

const FIRST_STEPS = [
  {
    title: 'Conecte seu WhatsApp',
    text: 'Em Configurações, leia o QR Code com o celular que vai enviar as cobranças. Use um número que seus clientes já conhecem.',
    href: '/configuracoes',
    action: 'Abrir Configurações'
  },
  {
    title: 'Conecte o gateway de pagamento',
    text: 'Informe a chave do Asaas ou do Mercado Pago. Com o Asaas, o aviso de pagamento (webhook) é cadastrado sozinho e você também pode cobrar por boleto e cartão.',
    href: '/configuracoes',
    action: 'Abrir Configurações'
  },
  {
    title: 'Traga seus clientes',
    text: 'Cadastre um por um ou importe uma planilha CSV com nome, WhatsApp e CPF/CNPJ.',
    href: '/clientes',
    action: 'Abrir Clientes'
  },
  {
    title: 'Crie as cobranças',
    text: 'Avulsas ou recorrentes (semanal, mensal, anual). No vencimento, a mensagem sai sozinha com o Pix ou o link de pagamento.',
    href: '/cobrancas',
    action: 'Abrir Cobranças'
  },
  {
    title: 'Ajuste a régua e o horário',
    text: 'Em Mensagens você escolhe os lembretes antes e depois do vencimento, o horário de envio e os textos.',
    href: '/mensagens',
    action: 'Abrir Mensagens'
  }
] as const;

export default function TutorialPage() {
  return (
    <div className="space-y-[18px]">
      <header>
        <h1 className="text-[19px] font-bold tracking-tight text-sand-900">
          Tutorial de configuração
        </h1>
        <p className="mt-1 text-[13px] text-sand-600">
          Do zero à primeira cobrança em cinco passos. Mais abaixo, o passo a passo com prints de
          onde clicar no Asaas e no Mercado Pago.
        </p>
      </header>

      <ol className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {FIRST_STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex flex-col rounded-2xl border border-sand-200/70 bg-white p-5 shadow-card"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-500 text-xs font-bold text-white">
              {index + 1}
            </span>
            <h2 className="mt-3 text-[14px] font-bold text-sand-900">{step.title}</h2>
            <p className="mt-1 flex-1 text-[13px] leading-relaxed text-sand-600">{step.text}</p>
            <Link
              href={step.href}
              className="mt-3 text-[13px] font-bold text-primary-600 hover:text-primary-700"
            >
              {step.action} →
            </Link>
          </li>
        ))}
      </ol>

      <h2 className="pt-2 text-[15px] font-bold tracking-tight text-sand-900">
        Gateway e webhook, com prints
      </h2>
      <p className="-mt-2 text-[13px] text-sand-600">
        As URLs e tokens que você precisa colar estão em Configurações → Gateway e Webhook.
      </p>

      <WebhookTutorial />
    </div>
  );
}
