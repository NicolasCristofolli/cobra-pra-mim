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
process.env.APP_URL ||= 'http://localhost:4000';
process.env.DISABLE_CRON = 'true';
