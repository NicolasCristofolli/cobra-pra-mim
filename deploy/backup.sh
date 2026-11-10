#!/usr/bin/env bash
# Backup diário dos bancos do Postgres (app + Evolution) e das sessões do WhatsApp.
# Uso: deploy/backup.sh            (agendado no crontab do usuário deploy)
# Variáveis opcionais:
#   BACKUP_DIR        destino local       (padrão: ~/backups/cobra-pra-mim)
#   BACKUP_KEEP_DAYS  retenção em dias    (padrão: 14)
#   BACKUP_RCLONE_REMOTE  ex.: "b2:cobra-backups" — se definido e o rclone
#                         estiver instalado, envia uma cópia para fora da VPS.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/cobra-pra-mim}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-cobra-db}"
DB_USER="${DB_USER:-cobra}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"

umask 077
mkdir -p "$DEST"

for db in cobra evolution; do
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$db" -Fc --no-owner \
    > "$DEST/$db.dump"
done
# Roles/permissões (sem senhas de outros bancos fora do cluster)
docker exec "$DB_CONTAINER" pg_dumpall -U "$DB_USER" --roles-only > "$DEST/roles.sql"

# Sessões do WhatsApp (evita ter de reler o QR após restauração)
docker run --rm -v cobra-pra-mim_evolution_instances:/data:ro -v "$DEST":/out \
  alpine:3.20 sh -c "tar czf /out/evolution_instances.tgz -C /data . && \
    chown $(id -u):$(id -g) /out/evolution_instances.tgz && chmod 600 /out/evolution_instances.tgz" \
  2>/dev/null || true

# Valida que os dumps não estão corrompidos
for db in cobra evolution; do
  docker exec -i "$DB_CONTAINER" pg_restore --list < "$DEST/$db.dump" > /dev/null
done

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]] && command -v rclone > /dev/null; then
  rclone copy "$DEST" "$BACKUP_RCLONE_REMOTE/$STAMP"
fi

echo "[backup] ok: $DEST ($(du -sh "$DEST" | cut -f1))"
