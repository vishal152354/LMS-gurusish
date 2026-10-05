#!/usr/bin/env bash
# Nightly backup of the database and uploaded material. Keeps 14 days.
#   sudo crontab -e   →   30 2 * * * /opt/pariksha/deploy/backup.sh
set -euo pipefail
DATA_HOME=/var/lib/pariksha
DEST=${BACKUP_DIR:-/var/backups/pariksha}
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$DEST"
# consistent copy of the live SQLite database
sqlite3 "$DATA_HOME/viva-webapp/data/viva.db" ".backup '$DEST/viva-$STAMP.db'"
# uploaded documents live in two places; skip the live DB (copied above)
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C "$DATA_HOME" --exclude 'viva-webapp/data/viva.db*' viva-webapp/data .hermes/workspace 2>/dev/null || true
find "$DEST" -type f -mtime +14 -delete
echo "backup written to $DEST ($STAMP)"
