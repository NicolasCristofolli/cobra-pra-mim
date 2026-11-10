#!/usr/bin/env bash
# Deploy na VPS (usuário deploy):  deploy/deploy.sh
# Atualiza o código, sobe a infra Docker, builda backend/frontend e recarrega o PM2.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

[[ -f .env ]] || { echo "Falta $REPO/.env (copie de .env.example)"; exit 1; }
[[ -f backend/.env ]] || { echo "Falta backend/.env (copie de backend/.env.example)"; exit 1; }

echo "== Backup antes do deploy =="
deploy/backup.sh

echo "== Código =="
git pull --ff-only

echo "== Infra (Postgres, Redis, Evolution) =="
docker compose pull --quiet
docker compose up -d --wait

echo "== Backend =="
(cd backend && npm ci --no-audit --no-fund && npm run build)

echo "== Frontend =="
# O destino do proxy /api é gravado no build.
(cd frontend && npm ci --no-audit --no-fund && API_PROXY_TARGET=http://127.0.0.1:4000 npm run build)

echo "== PM2 =="
pm2 startOrReload deploy/ecosystem.config.js --update-env
pm2 save

echo "== Health check =="
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:4000/health > /dev/null; then
    echo "API ok"; exit 0
  fi
  sleep 2
done
echo "API não respondeu em 60s. Veja: pm2 logs cobra-api"; exit 1
