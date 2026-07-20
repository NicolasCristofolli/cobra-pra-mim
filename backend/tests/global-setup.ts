import dotenv from 'dotenv';

/** Executa UMA vez antes da suíte: migra o banco de teste do zero. */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: '.env.test' });
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL ||= 'postgresql://cobra:cobra@localhost:5432/cobra_test';
  process.env.JWT_SECRET ||= 'segredo-somente-para-testes';
  process.env.ENCRYPTION_KEY ||= 'E7oYQJZ8sT2m4vB6xC1dN9fH3kL5pR7uW0yA2cE4gI8=';
  process.env.APP_TZ ||= 'America/Sao_Paulo';

  const { runMigrations } = await import('../src/db/migrate');
  const { closePool } = await import('../src/db');
  await runMigrations();
  await closePool();
}
