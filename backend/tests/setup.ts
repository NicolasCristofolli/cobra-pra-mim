import dotenv from 'dotenv';

// Roda ANTES do import de qualquer módulo da aplicação em cada arquivo de
// teste — os getters de env são lazy, então isto basta.
dotenv.config({ path: '.env.test' });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://cobra:cobra@localhost:5432/cobra_test';
process.env.JWT_SECRET ||= 'segredo-somente-para-testes-com-32-chars-ou-mais';
// 32 bytes em base64 — fixa para os testes serem determinísticos.
process.env.ENCRYPTION_KEY ||= 'E7oYQJZ8sT2m4vB6xC1dN9fH3kL5pR7uW0yA2cE4gI8=';
process.env.APP_TZ ||= 'America/Sao_Paulo';
// URLs fixas (atribuição direta, não ||=): se existir um .env de verdade na
// pasta (ex.: rodando a suíte num servidor), os valores dele não podem vazar
// para os testes. Pelo mesmo motivo, nenhuma credencial externa fica definida:
// os testes só usam os fakes de tests/helpers.ts.
process.env.APP_URL = 'http://localhost:4000';
process.env.FRONTEND_ORIGIN = 'http://localhost:3000';
for (const name of [
  'SMTP_HOST',
  'SMTP_USER',
  'SMTP_PASS',
  'ASAAS_PLATFORM_API_KEY',
  'ASAAS_PLATFORM_WEBHOOK_TOKEN',
  'PLATFORM_CHECKOUT_SUCCESS_URL',
  'EVOLUTION_API_KEY',
  'EVOLUTION_API_URL'
]) {
  delete process.env[name];
}
process.env.DISABLE_CRON = 'true';
