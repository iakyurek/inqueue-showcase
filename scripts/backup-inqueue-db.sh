#!/usr/bin/env bash
# Backup the shared inQueue Postgres (hub + Preply state + Batchly schema all
# live in ONE instance, so a single dump covers the entire suite: store
# config, Google/Etsy OAuth tokens, SKU ledger, duplicate-draft history).
#
# Render's FREE Postgres tier is deleted ~30 days after creation — run this
# weekly (and right before any migration) so expiry is an inconvenience, not
# a disaster. Restore runbook: docs/deployment.md § "Database backup & 30-day
# expiry".
#
# Usage:
#   scripts/backup-inqueue-db.sh "<postgres-connection-string>"
#   DATABASE_URL=... scripts/backup-inqueue-db.sh
#
# Use the EXTERNAL connection string from the Render database page (the
# internal one only resolves inside Render's network). Requires pg_dump
# (macOS: brew install postgresql@16).
#
# Weekly automation on macOS (crontab -e):
#   0 9 * * 1  DATABASE_URL='postgres://...' /path/to/inQueue/scripts/backup-inqueue-db.sh
set -euo pipefail

DB_URL="${1:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Usage: $0 <postgres-connection-string>   (or set DATABASE_URL)" >&2
  exit 1
fi

# Prefer the newest client tools: Homebrew's libpq tracks current Postgres,
# while postgresql@16's pg_dump refuses to dump a newer server
# ("aborting because of server version mismatch").
PG_DUMP="pg_dump"
for candidate in /opt/homebrew/opt/libpq/bin/pg_dump /usr/local/opt/libpq/bin/pg_dump; do
  if [ -x "$candidate" ]; then PG_DUMP="$candidate"; break; fi
done

BACKUP_DIR="${INQUEUE_BACKUP_DIR:-$HOME/inqueue-backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/inqueue-$STAMP.sql.gz"

echo "Dumping to $OUT ..."
"$PG_DUMP" --no-owner --no-privileges "$DB_URL" | gzip > "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "Backup complete: $OUT ($SIZE)"

# Keep the 12 most recent backups; prune older ones.
ls -1t "$BACKUP_DIR"/inqueue-*.sql.gz 2>/dev/null | tail -n +13 | while read -r old; do
  echo "Pruning old backup: $old"
  rm -f "$old"
done

echo
echo "Restore (into a NEW database):"
echo "  gunzip -c '$OUT' | psql '<new-postgres-connection-string>'"
echo "Then update INQUEUE_DATABASE_URL (hub), PREPLY_DATABASE_URL (Preply),"
echo "DATABASE_URL (Batchly) on Render, redeploy all three, and set the new"
echo "INQUEUE_DB_EXPIRES_AT on the hub."
