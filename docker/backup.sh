#!/bin/sh
# Hourly pg_dump into $BACKUP_DIR; prunes old dumps; optionally ships one dump a day
# off the machine. Dumps are written to a .tmp name and renamed, so /api/health (which
# looks at *.sql.gz) never counts a half-written file.
#
# BACKUP_UPLOAD_CMD (optional): shell command run once per day with the newest dump's
# path as $1, e.g. 'rclone copyto "$1" remote:psclub/$(basename "$1")'. If it fails the
# marker is not written, so the next hourly run retries.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-3600}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

while true; do
  stamp=$(date +%Y%m%d-%H%M%S)
  target="$BACKUP_DIR/psclub-$stamp.sql.gz"
  if pg_dump --no-owner | gzip > "$target.tmp" && [ -s "$target.tmp" ]; then
    mv "$target.tmp" "$target"
    echo "backup ok: $target ($(wc -c < "$target") bytes)"
    find "$BACKUP_DIR" -name 'psclub-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

    day=$(date +%Y%m%d)
    if [ -n "${BACKUP_UPLOAD_CMD:-}" ] && [ ! -e "$BACKUP_DIR/.uploaded-$day" ]; then
      if sh -c "$BACKUP_UPLOAD_CMD" upload "$target"; then
        touch "$BACKUP_DIR/.uploaded-$day"
        find "$BACKUP_DIR" -name '.uploaded-*' -mtime +"$KEEP_DAYS" -delete
        echo "offsite upload ok: $target"
      else
        echo "offsite upload FAILED: $target" >&2
      fi
    fi
  else
    rm -f "$target.tmp"
    echo "backup FAILED at $stamp" >&2
  fi
  sleep "$INTERVAL"
done
