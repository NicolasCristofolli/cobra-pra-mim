// PM2 — processos do Cobra pra mim na VPS.
//   pm2 start deploy/ecosystem.config.js && pm2 save
// Recarregar após deploy: pm2 reload deploy/ecosystem.config.js
const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'cobra-api',
      cwd: path.join(root, 'backend'),
      script: 'dist/server.js',
      exec_mode: 'fork',
      instances: 1, // o cron do motor de cobrança não pode rodar duplicado
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '4000'
      },
      // Se o boot falhar (ex.: Postgres fora), espera cada vez mais entre as
      // tentativas (até 15s) em vez de reiniciar em loop a 100% de CPU.
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '400M',
      kill_timeout: 10000,
      time: true,
      merge_logs: true
    },
    {
      name: 'cobra-web',
      cwd: path.join(root, 'frontend'),
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000',
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        API_PROXY_TARGET: 'http://127.0.0.1:4000'
      },
      exp_backoff_restart_delay: 1000,
      max_memory_restart: '500M',
      time: true,
      merge_logs: true
    }
  ]
};
