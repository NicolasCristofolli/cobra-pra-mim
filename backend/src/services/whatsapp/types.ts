export interface WhatsAppPort {
  readonly provider: 'EVOLUTION';
  /** phone: somente dígitos com DDI (ex.: 5551999998888) */
  sendText(phone: string, message: string): Promise<void>;
}
