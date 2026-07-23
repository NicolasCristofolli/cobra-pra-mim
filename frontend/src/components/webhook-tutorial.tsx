'use client';

import { useState } from 'react';
import { AlertTriangle, X, ZoomIn } from 'lucide-react';
import { FilterChip } from '@/components/ui';

type Provider = 'ASAAS' | 'MERCADO_PAGO';

const TABS: Array<{ value: Provider; label: string }> = [
  { value: 'ASAAS', label: 'Asaas' },
  { value: 'MERCADO_PAGO', label: 'Mercado Pago' }
];

interface Step {
  image: string;
  text: React.ReactNode;
}

/** Passo com print real da tela (o círculo vermelho já vem desenhado na imagem). Clique amplia. */
function StepCard({
  number,
  step,
  onZoom
}: {
  number: number;
  step: Step;
  onZoom: (src: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-sand-200 bg-sand-50 p-3">
      <div className="flex items-start gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">
          {number}
        </span>
        <p className="text-[13px] leading-relaxed text-sand-700">{step.text}</p>
      </div>
      <button
        type="button"
        onClick={() => onZoom(step.image)}
        className="group relative overflow-hidden rounded-lg border border-sand-200 shadow-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={step.image}
          alt={`Passo ${number} — painel do gateway`}
          className="w-full"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition-all group-hover:bg-ink/20 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-sand-800 shadow-card">
            <ZoomIn className="h-3.5 w-3.5" /> Ampliar
          </span>
        </span>
      </button>
    </div>
  );
}

/** Overlay em tela cheia pra ver o print sem espremer os detalhes. */
function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-4 animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Print ampliado"
        className="max-h-[92vh] max-w-[95vw] rounded-lg shadow-float"
      />
    </div>
  );
}

const ASAAS_KEY_STEPS: Step[] = [
  {
    image: '/tutorial/asaas/01-menu-integracoes.webp',
    text: (
      <>
        No menu do seu perfil (canto superior direito do painel Asaas), clique em{' '}
        <strong>Integrações</strong>.
      </>
    )
  },
  {
    image: '/tutorial/asaas/02-aba-integracao.webp',
    text: (
      <>
        Isso abre a tela &quot;Minha conta&quot; — clique na aba <strong>Integração</strong> no
        topo.
      </>
    )
  },
  {
    image: '/tutorial/asaas/03-aba-chaves-api.webp',
    text: (
      <>
        Já na tela de Integrações, clique na aba <strong>Chaves de API</strong>.
      </>
    )
  },
  {
    image: '/tutorial/asaas/04-gerar-chave-nome.webp',
    text: (
      <>
        Gere uma nova chave: dê um nome (ex.: &quot;Cobrai&quot;) e clique em{' '}
        <strong>Avançar</strong>. Não marque a opção de saque via API — o Cobrai só precisa
        criar e consultar cobranças Pix.
      </>
    )
  },
  {
    image: '/tutorial/asaas/05-chave-gerada-copiar.webp',
    text: (
      <>
        Clique em <strong>Copiar</strong> — a chave só aparece essa vez! Cole ela no campo
        &quot;Chave de API&quot;, no card de Gateway nas Configurações do Cobrai, e salve.
      </>
    )
  }
];

const ASAAS_WEBHOOK_STEPS: Step[] = [
  {
    image: '/tutorial/asaas/06-aba-webhooks.webp',
    text: (
      <>
        De volta em Integrações, clique na aba <strong>Webhooks</strong> e depois em{' '}
        <strong>+ Adicionar Webhook</strong>.
      </>
    )
  },
  {
    image: '/tutorial/asaas/07-form-url-token.webp',
    text: (
      <>
        Cole a <strong>URL do webhook</strong> (copiada nas Configurações do Cobrai) no campo
        URL. No campo <strong>Token de autenticação</strong>, não clique em &quot;Gerar
        Token&quot; — cole ali o <strong>Token secreto</strong> que também está nas
        Configurações do Cobrai.
      </>
    )
  },
  {
    image: '/tutorial/asaas/08-form-ativar-tipo.webp',
    text: (
      <>
        Ative o toggle <strong>Este Webhook ficará ativo?</strong> e, em{' '}
        <strong>Tipo de envio</strong>, escolha <strong>Não sequencial</strong>.
      </>
    )
  },
  {
    image: '/tutorial/asaas/09-eventos-pagamento.webp',
    text: (
      <>
        Role até Cobranças e marque pelo menos <strong>PAYMENT_CONFIRMED</strong> e{' '}
        <strong>PAYMENT_RECEIVED</strong> — são os únicos eventos que o Cobrai processa. Depois
        clique em <strong>Salvar</strong>. Pronto: todo Pix pago confirma a fatura aqui sozinho.
      </>
    )
  }
];

const MP_KEY_STEPS: Step[] = [
  {
    image: '/tutorial/mercadopago/01-menu-configurar-perfil.webp',
    text: (
      <>
        No mercadopago.com.br, clique no menu do seu perfil (canto superior direito) e depois em{' '}
        <strong>Configurar perfil</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/02-card-integracoes.webp',
    text: (
      <>
        Na aba <strong>Negócio</strong>, clique no card <strong>Integrações</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/03-suas-integracoes.webp',
    text: (
      <>
        Clique em <strong>Suas integrações</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/04-criar-aplicacao.webp',
    text: (
      <>
        Clique em <strong>+ Criar aplicação</strong> (se você já tem uma aplicação criada, pode
        pular direto pra ela).
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/05-pagamentos-online.webp',
    text: (
      <>
        Escolha <strong>Pagamentos online</strong>, responda como você criou a loja e clique em{' '}
        <strong>Continuar</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/06-checkout-confirmar.webp',
    text: (
      <>
        Escolha qualquer um dos checkouts (Checkout Bricks ou Checkout Transparente — o Cobrai
        só usa o Access Token gerado depois, não importa qual você escolher aqui). Marque as
        duas autorizações e clique em <strong>Confirmar</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/07-ativar-credenciais.webp',
    text: (
      <>
        Na tela &quot;Suas integrações&quot;, clique em <strong>Ativar credenciais</strong>, em
        Credenciais de produção.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/08-preencher-site.webp',
    text: (
      <>
        Preencha o <strong>Site</strong> com a URL do seu negócio, marque a autorização e clique
        em <strong>Ativar credenciais de produção</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/09-copiar-access-token.webp',
    text: (
      <>
        Clique no ícone de olho pra revelar o <strong>Access Token</strong> e depois no ícone de
        copiar. Cole esse valor no campo &quot;Chave de API&quot; nas Configurações do Cobrai
        (não é a Public Key nem o Client Secret).
      </>
    )
  }
];

const MP_WEBHOOK_STEPS: Step[] = [
  {
    image: '/tutorial/mercadopago/10-menu-webhooks.webp',
    text: (
      <>
        Dentro da sua aplicação, no menu lateral em <strong>Notificações</strong>, clique em{' '}
        <strong>Webhooks</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/11-configurar-notificacoes.webp',
    text: (
      <>
        Clique em <strong>Configurar notificações</strong>.
      </>
    )
  },
  {
    image: '/tutorial/mercadopago/12-url-evento-assinatura.webp',
    text: (
      <>
        Na aba <strong>Modo de produção</strong>, cole a &quot;URL do webhook&quot; (copiada nas
        Configurações do Cobrai) no campo URL, marque o evento de <strong>Pagamentos</strong>{' '}
        (ou &quot;Pagamentos (legacy)&quot;) e salve. O Mercado Pago vai gerar uma{' '}
        <strong>Assinatura secreta</strong> — copie ela e cole no campo &quot;Assinatura secreta
        do webhook (Mercado Pago)&quot; nas Configurações do Cobrai. O token secreto do Cobrai
        não é usado neste gateway.
      </>
    )
  }
];

function StepGrid({
  title,
  steps,
  onZoom
}: {
  title: string;
  steps: Step[];
  onZoom: (src: string) => void;
}) {
  return (
    <div>
      <p className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-sand-500">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <StepCard key={step.image} number={index + 1} step={step} onZoom={onZoom} />
        ))}
      </div>
    </div>
  );
}

export function WebhookTutorial() {
  const [provider, setProvider] = useState<Provider>('ASAAS');
  const [zoomSrc, setZoomSrc] = useState<string | null>(null);

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

      {provider === 'ASAAS' ? (
        <div className="space-y-5">
          <StepGrid title="Parte 1 — Gerar a chave de API" steps={ASAAS_KEY_STEPS} onZoom={setZoomSrc} />
          <StepGrid title="Parte 2 — Cadastrar o webhook" steps={ASAAS_WEBHOOK_STEPS} onZoom={setZoomSrc} />
        </div>
      ) : (
        <div className="space-y-5">
          <StepGrid title="Parte 1 — Gerar as credenciais" steps={MP_KEY_STEPS} onZoom={setZoomSrc} />
          <p className="flex items-start gap-2 rounded-xl bg-flame-50 px-3 py-2.5 text-xs leading-relaxed text-flame-700 ring-1 ring-inset ring-flame-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Para a Parte 2, você precisa estar em{' '}
            <strong className="mx-1">mercadopago.com.br/developers</strong> (o portal de
            desenvolvedores) — não é a mesma tela da sua conta usada na Parte 1.
          </p>
          <StepGrid title="Parte 2 — Configurar o webhook" steps={MP_WEBHOOK_STEPS} onZoom={setZoomSrc} />
        </div>
      )}

      <Lightbox src={zoomSrc} onClose={() => setZoomSrc(null)} />
    </div>
  );
}
