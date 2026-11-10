import cron from 'node-cron';
import { createApp } from './app';
import { env } from './config/env';
import { getPool } from './db';
import { runMigrations } from './db/migrate';
import { purgeOldResetTokens } from './modules/auth/auth.service';
import { encrypt } from './lib/crypto';
import { runBillingCycle } from './services/billing-engine';
import { defaultDeps } from './services/deps';

async function start(): Promise<void> {
  // Fail-fast: melhor cair no boot com mensagem clara do que em runtime.
  void env.databaseUrl;
  void env.jwtSecret;
  void env.evolutionApiKey;
  encrypt('startup-check'); // valida que ENCRYPTION_KEY decodifica p/ 32 bytes

  await getPool().query('SELECT 1');
  const applied = await runMigrations();
  if (applied.length > 0) {
    console.log(`[db] migrations aplicadas: ${applied.join(', ')}`);
  }

  const app = createApp(defaultDeps);
  app.listen(env.port, env.host, () => {
    console.log(`[api] Cobra pra mim ouvindo em http://${env.host}:${env.port}`);
  });

  if (!env.cronDisabled) {
    cron.schedule(
      env.cronSchedule,
      async () => {
        try {
          const report = await runBillingCycle(defaultDeps);
          console.log('[motor] ciclo concluído:', report);
          await purgeOldResetTokens();
        } catch (error) {
          console.error('[motor] ciclo falhou:', error);
        }
      },
      { timezone: env.appTz }
    );
    console.log(
      `[motor] agendado: "${env.cronSchedule}" (${env.appTz}). ` +
        'Desative com DISABLE_CRON=true.'
    );
  }
}

start().catch((error) => {
  // Loga o erro completo: AggregateError (ex.: ECONNREFUSED no Postgres) tem
  // message vazia e escondia a causa real.
  console.error('[boot] falha ao iniciar:', error);
  process.exit(1);
});
