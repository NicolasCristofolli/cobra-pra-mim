import type { SettingsRow } from '../modules/settings/settings.routes';
import { buildGatewayAdapter, type GatewayPort } from './gateway';
import { buildWhatsAppAdapter, type WhatsAppPort } from './whatsapp';
import {
  buildPlatformBilling,
  type PlatformBillingPort
} from './subscription/platform-billing';

/**
 * Fronteira de I/O externo do sistema. O app real usa os adapters de
 * verdade; os testes injetam fakes e capturam cada chamada — nenhum teste
 * toca a internet.
 */
export interface AppDeps {
  gatewayFactory: (settings: SettingsRow) => GatewayPort | null;
  whatsappFactory: (settings: SettingsRow) => WhatsAppPort | null;
  /** Assinatura da plataforma (checkout). null = checkout indisponível. */
  platformBillingFactory: () => PlatformBillingPort | null;
  /**
   * Pausa entre envios consecutivos pelo MESMO chip no ciclo automático
   * (anti-spam do WhatsApp). Aplica-se apenas ao motor (runBillingCycle);
   * o envio manual "Enviar agora" nunca passa por aqui. Ausente = sem pausa
   * (testes).
   */
  interSendDelay?: () => Promise<void>;
}

// 5–15s com jitter: intervalo fixo entre mensagens também é assinatura de bot.
const INTER_SEND_DELAY_MIN_MS = 5_000;
const INTER_SEND_DELAY_MAX_MS = 15_000;

export const defaultDeps: AppDeps = {
  gatewayFactory: buildGatewayAdapter,
  whatsappFactory: buildWhatsAppAdapter,
  platformBillingFactory: buildPlatformBilling,
  interSendDelay: () =>
    new Promise((resolve) =>
      setTimeout(
        resolve,
        INTER_SEND_DELAY_MIN_MS +
          Math.random() * (INTER_SEND_DELAY_MAX_MS - INTER_SEND_DELAY_MIN_MS)
      )
    )
};
