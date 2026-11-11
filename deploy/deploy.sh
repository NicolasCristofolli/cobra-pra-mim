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

# npm ci apaga o node_modules inteiro: só roda quando as dependências mudaram
# (ou na primeira vez), para não tirar módulos de baixo do app que está no ar.
install_deps() {
  local stamp="node_modules/.package-lock.sha256"
  local current
  current="$(sha256sum package-lock.json | cut -d' ' -f1)"
  if [[ -d node_modules && -f "$stamp" && "$(cat "$stamp")" == "$current" ]]; then
    echo "dependências inalteradas: npm ci dispensado"
  else
    npm ci --no-audit --no-fund
    echo "$current" > "$stamp"
  fi
}

# Os builds vão para pastas separadas (dist-build, .next-build) e só são
# trocados pelas pastas em uso no final: enquanto compila, o site no ar
# continua servindo os arquivos antigos intactos.
echo "== Backend =="
(cd backend && install_deps && rm -rf dist-build && npx tsc -p tsconfig.json --outDir dist-build)

echo "== Frontend =="
# O destino do proxy /api é gravado no build.
(cd frontend && install_deps && rm -rf .next-build \
  && NEXT_DIST_DIR=.next-build API_PROXY_TARGET=http://127.0.0.1:4000 npm run build)

echo "== Troca dos builds =="
swap_build() { # swap_build <pasta> <novo> <em uso> <anterior>
  (cd "$1" && rm -rf "$4" && { [[ ! -d "$3" ]] || mv "$3" "$4"; } && mv "$2" "$3")
}
swap_build backend dist-build dist dist-old
swap_build frontend .next-build .next .next-old

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
