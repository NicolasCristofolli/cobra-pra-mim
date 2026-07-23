'use client';

import { useState } from 'react';
import { ArrowRight, CheckSquare, KeyRound, Link2, ShieldCheck } from 'lucide-react';
import { FilterChip, cx } from '@/components/ui';

type Provider = 'ASAAS' | 'MERCADO_PAGO';

const TABS: Array<{ value: Provider; label: string }> = [
  { value: 'ASAAS', label: 'Asaas' },
  { value: 'MERCADO_PAGO', label: 'Mercado Pago' }
];

/** Chip que representa um campo/valor dentro dos mockups do diagrama. */
function FieldChip({
  icon: Icon,
  children
}: {
  icon: typeof Link2;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-sand-700 shadow-sm ring-1 ring-inset ring-sand-200">
      <Icon className="h-3 w-3 shrink-0 text-primary-600" />
      {children}
    </span>
  );
}

/** Mockup: cartão do painel do gateway com "campos" preenchidos pelas setas. */
function PanelMock({
  title,
  fields
}: {
  title: string;
  fields: Array<{ icon: typeof Link2; label: string; highlight?: boolean }>;
}) {
  return (
    <div className="w-full max-w-[220px] rounded-xl border border-sand-200 bg-sand-50 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-sand-500">{title}</p>
      <div className="space-y-1.5">
        {fields.map((field) => (
          <div
            key={field.label}
            className={cx(
              'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium',
              field.highlight
                ? 'border-primary-200 bg-primary-50 text-primary-700'
                : 'border-sand-200 bg-white text-sand-600'
            )}
          >
            <field.icon className="h-3 w-3 shrink-0" />
            {field.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function AsaasDiagram() {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-center">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-sand-200 bg-white p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-sand-500">Aqui no Cobrai</p>
        <FieldChip icon={Link2}>URL do webhook</FieldChip>
        <FieldChip icon={KeyRound}>Token secreto</FieldChip>
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-sand-300 sm:rotate-0" />
      <PanelMock
        title="Painel Asaas"
        fields={[
          { icon: Link2, label: 'URL', highlight: true },
          { icon: KeyRound, label: 'Token de autenticação', highlight: true },
          { icon: CheckSquare, label: 'PAYMENT_RECEIVED' },
          { icon: CheckSquare, label: 'PAYMENT_CONFIRMED' }
        ]}
      />
    </div>
  );
}

function MercadoPagoDiagram() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-center">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-sand-500">Aqui no Cobrai</p>
          <FieldChip icon={Link2}>URL do webhook</FieldChip>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-sand-300 sm:rotate-0" />
        <PanelMock
          title="Painel Mercado Pago"
          fields={[
            { icon: Link2, label: 'URL de produção', highlight: true },
            { icon: CheckSquare, label: 'Tópico: Pagamentos' }
          ]}
        />
      </div>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-center">
        <PanelMock
          title="Painel Mercado Pago"
          fields={[{ icon: ShieldCheck, label: 'Assinatura secreta', highlight: true }]}
        />
        <ArrowRight className="h-5 w-5 shrink-0 rotate-90 text-sand-300 sm:rotate-0" />
        <div className="flex flex-col items-center gap-2 rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-sand-500">Aqui no Cobrai</p>
          <FieldChip icon={ShieldCheck}>Assinatura secreta do webhook</FieldChip>
        </div>
      </div>
      <p className="text-center text-[11px] text-sand-500">
        Repare que a assinatura secreta anda no sentido contrário: ela nasce no painel do
        Mercado Pago e vem para cá — o token secreto do Cobrai não é usado nesse gateway.
      </p>
    </div>
  );
}

const STEPS: Record<Provider, string[]> = {
  ASAAS: [
    'No painel do Asaas, acesse Integrações → Webhooks → Novo Webhook.',
    'Cole a "URL do webhook" (copiada acima) no campo URL, e o "Token secreto" no campo Token de autenticação.',
    'Em Eventos, marque pelo menos PAYMENT_RECEIVED e PAYMENT_CONFIRMED — são os únicos que o Cobrai processa.',
    'Salve. A partir daqui, todo Pix pago confirma a fatura aqui sozinho.'
  ],
  MERCADO_PAGO: [
    'No painel do Mercado Pago, acesse Suas integrações → sua aplicação → Webhooks → Configurar notificações.',
    'Cole a "URL do webhook" (copiada acima) no campo de URL de produção e marque o tópico Pagamentos. O token secreto do Cobrai não é usado aqui.',
    'Copie a Assinatura secreta que o painel do Mercado Pago mostrar e cole no campo "Assinatura secreta do webhook (Mercado Pago)", no card de Gateway acima — é com ela que validamos a notificação.',
    'Salve dos dois lados. Pronto — cada Pix aprovado confirma a fatura aqui sozinho.'
  ]
};

export function WebhookTutorial() {
  const [provider, setProvider] = useState<Provider>('ASAAS');

  return (
    <div className="space-y-4 rounded-2xl border border-sand-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] font-bold text-sand-900">Como configurar passo a passo</p>
        <div className="flex gap-2">
          {TABS.map((tab) => (
            <FilterChip
              key={tab.value}
              variant="brand"
              active={provider === tab.value}
              onClick={() => setProvider(tab.value)}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-sand-50 p-4">
        {provider === 'ASAAS' ? <AsaasDiagram /> : <MercadoPagoDiagram />}
      </div>

      <ol className="list-inside list-decimal space-y-1.5 text-[13px] leading-relaxed text-sand-600">
        {STEPS[provider].map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
