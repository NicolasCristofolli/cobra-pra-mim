#!/bin/sh
# Banco da Evolution API com usuário próprio (sem superusuário).
# Roda só na primeira inicialização do volume (docker-entrypoint-initdb.d).
set -e
: "${EVOLUTION_DB_USER:?defina EVOLUTION_DB_USER no .env}"
: "${EVOLUTION_DB_PASSWORD:?defina EVOLUTION_DB_PASSWORD no .env}"
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v usr="$EVOLUTION_DB_USER" -v pw="$EVOLUTION_DB_PASSWORD" <<'SQL'
CREATE ROLE :"usr" LOGIN PASSWORD :'pw';
CREATE DATABASE evolution OWNER :"usr";
REVOKE ALL ON DATABASE evolution FROM PUBLIC;
GRANT CONNECT ON DATABASE evolution TO :"usr";
SQL
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d evolution \
  -v usr="$EVOLUTION_DB_USER" <<'SQL'
ALTER SCHEMA public OWNER TO :"usr";
SQL
