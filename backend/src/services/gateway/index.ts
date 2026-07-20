import { decrypt } from '../../lib/crypto';
import type { SettingsRow } from '../../modules/settings/settings.routes';
import { AsaasGateway } from './asaas';
import { MercadoPagoGateway } from './mercado-pago';
import type { GatewayPort } from './types';

export * from './types';

/** null = gateway não configurado; o motor então envia a cobrança sem Pix. */
export function buildGatewayAdapter(settings: SettingsRow): GatewayPort | null {
  if (!settings.gateway_provider || !settings.gateway_api_key_enc) return null;
  const apiKey = decrypt(settings.gateway_api_key_enc);
  return settings.gateway_provider === 'ASAAS'
    ? new AsaasGateway(apiKey)
    : new MercadoPagoGateway(apiKey);
}
