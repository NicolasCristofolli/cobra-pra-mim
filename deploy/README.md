# Deploy — Hostinger VPS (Ubuntu 24.04)

```
Internet ──443──▶ Caddy ─┬─▶ 127.0.0.1:3000  cobra-web  (PM2, Next.js)
                         ├─▶ 127.0.0.1:4000  cobra-api  (PM2, Express + cron)
                         └─▶ 127.0.0.1:5678  n8n
cobra-api ─▶ 127.0.0.1:5435 Postgres 16   (Docker: cobra-db)
          └▶ 127.0.0.1:8080 Evolution v2  (Docker: cobra-evolution) ─▶ Redis (rede interna)
```

Nada além de 22/80/443 fica exposto. As portas Docker são presas em `127.0.0.1`
porque o Docker ignora o UFW.

## Arquivos

| Arquivo | Função |
|---|---|
| `.env` (raiz, não versionado) | Senhas do Postgres, usuário da Evolution, API key. Modelo: `.env.example` |
| `backend/.env` (não versionado) | Config da API. Modelo: `backend/.env.example` |
| `docker-compose.yml` | Postgres, Redis e Evolution, com restart, healthcheck e limites |
| `deploy/ecosystem.config.js` | Processos PM2 (API e web), com backoff em falhas |
| `deploy/deploy.sh` | Backup, pull, build e reload |
| `deploy/backup.sh` | `pg_dump` diário (crontab às 03:17) em `~/backups/cobra-pra-mim`, 14 dias de retenção |
| `deploy/Caddyfile` | Proxy reverso com HSTS, gzip e logs |
| `deploy/harden-server.sh` | UFW, fail2ban, SSH, Caddy, logs do Docker (rodar com `sudo`) |

## Primeira instalação

```bash
cp .env.example .env && chmod 600 .env                 # preencha (openssl rand -hex 24)
cp backend/.env.example backend/.env && chmod 600 backend/.env
docker compose up -d --wait
(cd backend && npm ci && npm run build)
(cd frontend && npm ci && API_PROXY_TARGET=http://127.0.0.1:4000 npm run build)
pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
pm2 install pm2-logrotate
sudo bash deploy/harden-server.sh
(crontab -l; echo "17 3 * * * $PWD/deploy/backup.sh >> $HOME/backups/cobra-pra-mim/backup.log 2>&1") | crontab -
```

## Rotina

- Deploy: `deploy/deploy.sh`
- Logs: `pm2 logs cobra-api`, `docker logs -f cobra-evolution`
- Restaurar o banco: `docker exec -i cobra-db pg_restore -U cobra -d cobra --clean --if-exists < ~/backups/cobra-pra-mim/<data>/cobra.dump`
- Trocar a `ENCRYPTION_KEY` sem perder segredos:
  `OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... npx tsx --env-file=.env src/db/rotate-encryption-key.ts` (em `backend/`). Depois grave a nova chave no `.env` e reinicie a API.
- **Nunca** rode `npm test` na VPS: a suíte usa o banco `cobra_test` do Postgres de produção.

## Assinatura da plataforma (checkout)

Fluxo: o usuário escolhe o plano em `/planos`, paga na página do Asaas e a
conta é ativada **somente** pelo webhook. Com o pagamento atrasado, o app mostra
um aviso durante a carência (`plans.grace_days`, padrão 5 dias). Depois disso,
o Next redireciona para `/planos`, a API responde `402` e o motor de cobrança
para de enviar WhatsApp por essa conta.

Para ligar em produção:
1. No `backend/.env`: `ASAAS_PLATFORM_API_KEY`, `ASAAS_PLATFORM_WEBHOOK_TOKEN`
   (`openssl rand -hex 24`) e `PLATFORM_CHECKOUT_SUCCESS_URL`.
2. No Asaas da plataforma, em Integrações > Webhooks:
   URL `https://api.cobrapramim.cloud/webhooks/platform/asaas`, o mesmo token,
   e os eventos de cobrança e de assinatura.
3. Em Minha Conta > Informações, cadastre o domínio `cobrapramim.cloud`
   (é exigido para o redirecionamento após o pagamento).
4. Preços: `UPDATE plans SET price_cents = 5990 WHERE code = 'mensal';`
   Para desativar um plano: `active = false`.

As contas que já existiam no deploy da migração 007 ganham 15 dias de cortesia
(`TRIALING`).

## Administradores e e-mail

- Criar/promover admin (acesso sem assinatura), em `backend/`:
  `ADMIN_NAME='Nome' ADMIN_EMAIL='x@y.com' ADMIN_PASSWORD='...' npm run create-admin`
- Recuperação de senha: configure `SMTP_*` no `backend/.env`. Sem isso, o link
  sai em `pm2 logs cobra-api` em vez de ir por e-mail.

## Backup fora da VPS

Um backup que fica só na VPS some junto com ela. Faça as duas coisas:
1. Ative os snapshots automáticos no hPanel da Hostinger (VPS → Backups).
2. Instale e configure o `rclone` (Backblaze B2, Google Drive etc.) e defina
   `BACKUP_RCLONE_REMOTE=remoto:pasta` na linha do crontab.
