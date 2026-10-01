#!/bin/sh
# Hourly pg_dump into $BACKUP_DIR; prunes old dumps; optionally ships one dump a day
# off the machine. Dumps are written to a .tmp name and renamed, so /api/health (which
# looks at *.sql.gz) never counts a half-written file.
#
# Off-machine copy, once a day (the first successful dump of the day), either:
#   BACKUP_REMOTE      an rclone remote path, e.g. "offsite:psclub-backups" (the remote is
#                      defined in /config/rclone/rclone.conf, see docs/DEPLOY.md). Old files
#                      there are pruned after BACKUP_REMOTE_KEEP_DAYS (default 60).
#   BACKUP_UPLOAD_CMD  any shell command, run with the dump's path as $1.
# If the upload fails the daily marker is not written, so the next hourly run retries.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-3600}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
export REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-60}" # the upload command runs in a child shell

if [ -n "${BACKUP_REMOTE:-}" ] && [ -z "${BACKUP_UPLOAD_CMD:-}" ]; then
  BACKUP_UPLOAD_CMD='rclone copyto "$1" "$BACKUP_REMOTE/$(basename "$1")" && rclone delete "$BACKUP_REMOTE" --min-age "${REMOTE_KEEP_DAYS}d"'
fi

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
