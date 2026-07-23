import { WebhookTutorial } from '@/components/webhook-tutorial';

export default function TutorialPage() {
  return (
    <div className="space-y-[18px]">
      <header>
        <h1 className="text-[19px] font-bold tracking-tight text-sand-900">
          Tutorial de configuração
        </h1>
        <p className="mt-1 text-[13px] text-sand-600">
          Passo a passo com prints reais de onde clicar no Asaas e no Mercado Pago. As URLs e
          tokens que você precisa colar estão em Configurações → Gateway e Webhook.
        </p>
      </header>

      <WebhookTutorial />
    </div>
  );
}
