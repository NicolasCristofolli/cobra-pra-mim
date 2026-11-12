import type { WhatsAppPort } from './types';

/**
 * Adapter Evolution API v2 (https://doc.evolution-api.com).
 * POST {baseUrl}/message/sendText/{instance} com header `apikey`.
 */
export class EvolutionWhatsApp implements WhatsAppPort {
  readonly provider = 'EVOLUTION' as const;

  constructor(
    private readonly baseUrl: string,
    private readonly instance: string,
    private readonly apiKey: string
  ) {}

  async sendText(phone: string, message: string): Promise<void> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/message/sendText/${encodeURIComponent(
      this.instance
    )}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: this.apiKey },
      body: JSON.stringify({ number: phone, text: message }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Evolution API ${response.status}: ${body.slice(0, 300)}`);
    }
  }

  async isConnected(): Promise<boolean> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/instance/connectionState/${encodeURIComponent(
      this.instance
    )}`;
    const response = await fetch(url, {
      headers: { apikey: this.apiKey },
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status === 404) return false; // instância não existe mais
    if (!response.ok) throw new Error(`Evolution API ${response.status} ao consultar a conexão`);
    const data = (await response.json()) as { instance?: { state?: string } };
    return data.instance?.state === 'open';
  }
}
