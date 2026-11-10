import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Variável de ambiente obrigatória ausente: ${name}. ` +
        `Copie .env.example para .env e preencha os valores.`
    );
  }
  return value;
}

export const env = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? 'development';
  },
  get isProd() {
    return this.nodeEnv === 'production';
  },
  get port() {
    return Number(process.env.PORT ?? 4000);
  },
  // Interface de escuta. Padrão loopback: em produção a API só é acessível
  // pelo Caddy (api.cobrapramim.cloud), nunca direto na porta 4000.
  get host() {
    return process.env.HOST ?? '127.0.0.1';
  },
  get databaseUrl() {
    return required('DATABASE_URL');
  },
  get jwtSecret() {
    const secret = required('JWT_SECRET');
    // HS256 com segredo curto cai em força bruta offline a partir de um token.
    if (secret.length < 32) {
      throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres. Gere com: openssl rand -base64 48');
    }
    return secret;
  },
  get encryptionKey() {
    return required('ENCRYPTION_KEY');
  },
  get appUrl() {
    return process.env.APP_URL ?? `http://localhost:${this.port}`;
  },
  get frontendOrigin() {
    return process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  },
  get appTz() {
    return process.env.APP_TZ ?? 'America/Sao_Paulo';
  },
  // Evolution API local via Docker (porta padrão 8080). As instâncias de
  // WhatsApp são gerenciadas 100% pelo backend com esta URL + API key global;
  // o usuário nunca informa credenciais da Evolution.
  get evolutionApiUrl() {
    return process.env.EVOLUTION_API_URL ?? 'http://localhost:8080';
  },
  get evolutionApiKey() {
    // Em produção não há fallback: uma chave conhecida publicamente daria
    // controle total das instâncias de WhatsApp a quem alcançasse a Evolution.
    if (this.isProd) return required('EVOLUTION_API_KEY');
    return process.env.EVOLUTION_API_KEY ?? 'cobra-evolution-local-key';
  },
  // Conta Asaas da PLATAFORMA (assinatura do SaaS). Sem ela, o checkout
  // responde 503 e nenhum pagamento novo é criado.
  get asaasPlatformApiKey() {
    return process.env.ASAAS_PLATFORM_API_KEY || null;
  },
  // Token que o Asaas envia no header asaas-access-token do webhook da plataforma.
  get asaasPlatformWebhookToken() {
    return process.env.ASAAS_PLATFORM_WEBHOOK_TOKEN || null;
  },
  // Para onde o Asaas redireciona após o pagamento (domínio cadastrado no Asaas).
  get platformCheckoutSuccessUrl() {
    return process.env.PLATFORM_CHECKOUT_SUCCESS_URL || null;
  },
  get cronSchedule() {
    return process.env.CRON_SCHEDULE ?? '0 8 * * *';
  },
  get cronDisabled() {
    return process.env.DISABLE_CRON === 'true' || this.nodeEnv === 'test';
  }
};
