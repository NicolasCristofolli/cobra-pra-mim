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
    return required('JWT_SECRET');
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
  get trialDays() {
    return Number(process.env.TRIAL_DAYS ?? 7);
  },
  get cronSchedule() {
    return process.env.CRON_SCHEDULE ?? '0 8 * * *';
  },
  get cronDisabled() {
    return process.env.DISABLE_CRON === 'true' || this.nodeEnv === 'test';
  }
};
