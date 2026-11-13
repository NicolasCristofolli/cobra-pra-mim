import cron from 'node-cron';
import { createApp } from './app';
import { env } from './config/env';
import { closePool, getPool } from './db';
import { runMigrations } from './db/migrate';
import { purgeOldResetTokens } from './modules/auth/auth.service';
import { encrypt } from './lib/crypto';
import { query } from './db';
import { currentHour, todayISO } from './lib/dates';
import {
  isBillingCycleRunning,
  recordEngineRun,
  runBillingCycle,
  stopBillingCycle
} from './services/billing-engine';
import { defaultDeps } from './services/deps';
import { runLifecycleEmails, sendMonthlyReports } from './services/lifecycle-emails';

/** E-mails para os donos das contas só saem em horário comercial. */
const EMAIL_HOURS = { from: 9, to: 18 };

/** E-mail para os administradores da plataforma (falhas que precisam de gente). */
async function alertAdmins(subject: string, text: string): Promise<void> {
  try {
    const admins = await query<{ email: string }>(`SELECT email FROM users WHERE role = 'ADMIN'`);
    for (const admin of admins) {
      await defaultDeps.mailer.send({
        to: admin.email,
        subject: `[Cobra pra mim] ${subject}`,
        text,
        html: `<pre style="font-family:inherit;white-space:pre-wrap">${text.replace(
          /[&<>]/g,
          (char) => `&#${char.charCodeAt(0)};`
        )}</pre>`
      });
    }
  } catch (error) {
    console.error('[alerta] não foi possível avisar os administradores:', error);
  }
}

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
  const server = app.listen(env.port, env.host, () => {
    console.log(`[api] Cobra pra mim ouvindo em http://${env.host}:${env.port}`);
  });

  // Desligamento gracioso (pm2 reload/restart manda SIGINT e espera
  // kill_timeout = 10s): para de aceitar conexões, deixa o envio em curso do
  // motor terminar e fecha o pool. Passou de 8s, sai assim mesmo.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[api] ${signal} recebido: encerrando...`);
    const force = setTimeout(() => process.exit(0), 8_000);
    force.unref();
    server.close();
    // Conexões ociosas e streams SSE não fecham sozinhos.
    server.closeIdleConnections();
    const dropOpen = setTimeout(() => server.closeAllConnections(), 3_000);
    dropOpen.unref();
    stopBillingCycle()
      .then(() => closePool())
      .catch((error) => console.error('[api] erro ao encerrar:', error))
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  if (!env.cronDisabled) {
    cron.schedule(
      env.engineTickSchedule,
      async () => {
        // Um ciclo longo (muitas mensagens, com pausa entre elas) pode passar
        // de uma hora: o próximo tick espera em vez de rodar por cima.
        if (isBillingCycleRunning()) {
          console.warn('[motor] ciclo anterior ainda em andamento: este horário foi pulado');
          return;
        }
        const today = todayISO();
        const hour = currentHour();
        try {
          const report = await runBillingCycle(defaultDeps, today, { hour });
          console.log(`[motor] ciclo das ${hour}h concluído:`, report);
          await recordEngineRun(today, { ok: true, report });
          await purgeOldResetTokens();
        } catch (error) {
          console.error('[motor] ciclo falhou:', error);
          const message = error instanceof Error ? error.stack ?? error.message : String(error);
          await recordEngineRun(today, { ok: false, error: message }).catch(() => undefined);
          await alertAdmins(
            'O motor de cobrança falhou',
            `O ciclo diário de cobranças de ${today} terminou com erro e pode não ter enviado ` +
              `as mensagens do dia.\n\nErro:\n${message.slice(0, 1500)}\n\n` +
              `Veja os detalhes no servidor: pm2 logs cobra-api`
          );
        }

        // Avisos por e-mail (teste acabando, mensalidade em atraso, resumo do
        // mês). Falha aqui não é falha do motor: só registra no log.
        if (hour >= EMAIL_HOURS.from && hour <= EMAIL_HOURS.to) {
          try {
            const lifecycle = await runLifecycleEmails(defaultDeps);
            const monthly = await sendMonthlyReports(defaultDeps, today);
            const total =
              lifecycle.trialEnding + lifecycle.trialEnded + lifecycle.paymentOverdue + monthly.sent;
            if (total > 0 || lifecycle.failed > 0 || monthly.failed > 0) {
              console.log('[e-mails] ciclo de vida:', lifecycle, 'resumo mensal:', monthly);
            }
          } catch (error) {
            console.error('[e-mails] falha ao enviar os avisos do ciclo de vida:', error);
          }
        }
      },
      { timezone: env.appTz }
    );
    console.log(
      `[motor] agendado: "${env.engineTickSchedule}" (${env.appTz}), cada conta no seu horário. ` +
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
