import { env } from '../../config/env';
import type { SettingsRow } from '../../modules/settings/settings.routes';
import { EvolutionWhatsApp } from './evolution';
import { instanceNameFor } from './evolution-manager';
import type { WhatsAppPort } from './types';

export * from './types';

/**
 * null = WhatsApp não conectado. O provedor é exclusivamente a Evolution API,
 * gerenciada pelo backend (URL e API key vêm do ambiente, nunca do usuário).
 *
 * SEGURANÇA: a instância é derivada do user_id dono das settings — mesmo que
 * a coluna whatsapp_instance fosse adulterada, o envio jamais sairia pela
 * sessão de WhatsApp de outra conta.
 */
export function buildWhatsAppAdapter(settings: SettingsRow): WhatsAppPort | null {
  if (settings.whatsapp_provider !== 'EVOLUTION') return null;
  return new EvolutionWhatsApp(
    env.evolutionApiUrl,
    instanceNameFor(settings.user_id),
    env.evolutionApiKey
  );
}
