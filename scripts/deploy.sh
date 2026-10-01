#!/usr/bin/env bash
# Ship the current commit to the server and (re)start the production stack.
#
#   scripts/deploy.sh deploy@<server-ip> [git-ref]      # default ref: HEAD
#
# Runs from your PC (Git Bash on Windows is fine). There is no git remote: the chosen commit
# is packed with `git archive`, copied over ssh and synced into ~/ps-club-system on the
# server. .env, backups/ and rclone/ on the server are never touched. The stack is rebuilt
# with docker compose; the api container applies database migrations on start.
#
# Take a dump first when the release contains a migration (docs/DEPLOY.md, section 7).
set -euo pipefail

HOST="${1:?usage: scripts/deploy.sh user@host [git-ref]}"
REF="${2:-HEAD}"
APP_DIR="${APP_DIR:-ps-club-system}"
COMPOSE="docker compose -f docker-compose.prod.yml"

SHA="$(git rev-parse --verify "$REF^{commit}")"
SUBJECT="$(git log -1 --format=%s "$SHA")"
ARCHIVE="$(mktemp)"
trap 'rm -f "$ARCHIVE"' EXIT

echo "Deploying ${SHA:0:9} - $SUBJECT -> $HOST:~/$APP_DIR"
git archive --format=tar.gz -o "$ARCHIVE" "$SHA"

scp -q "$ARCHIVE" "$HOST:/tmp/psclub-release.tar.gz"
ssh "$HOST" bash -s -- "$APP_DIR" "$SHA" <<'REMOTE'
set -euo pipefail
APP_DIR="$1"
SHA="$2"
mkdir -p "$HOME/$APP_DIR" "$HOME/$APP_DIR.incoming"
rm -rf "$HOME/$APP_DIR.incoming"/*
tar xzf /tmp/psclub-release.tar.gz -C "$HOME/$APP_DIR.incoming"
rm -f /tmp/psclub-release.tar.gz
rsync -a --delete \
  --exclude '/.env' --exclude '/backups' --exclude '/rclone' --exclude '/.deployed-version' \
  "$HOME/$APP_DIR.incoming/" "$HOME/$APP_DIR/"
echo "$SHA" > "$HOME/$APP_DIR/.deployed-version"
cd "$HOME/$APP_DIR"
if [ ! -f .env ]; then
  echo "No .env on the server yet - create it from .env.example first (docs/DEPLOY.md, section 3)." >&2
  exit 1
fi
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
REMOTE

echo "Deployed ${SHA:0:9}. Check:  curl -s https://<your-name>/api/health"
