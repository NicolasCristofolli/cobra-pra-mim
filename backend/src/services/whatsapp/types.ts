export interface WhatsAppPort {
  readonly provider: 'EVOLUTION';
  /** phone: somente dígitos com DDI (ex.: 5551999998888) */
  sendText(phone: string, message: string): Promise<void>;
  /**
   * true = sessão conectada e pronta para enviar. Opcional: adapter sem o
   * método é tratado como conectado. Lança se não der para saber (provedor fora).
   */
  isConnected?(): Promise<boolean>;
}
