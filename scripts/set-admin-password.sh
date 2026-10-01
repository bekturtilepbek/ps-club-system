#!/usr/bin/env bash
# Set (or change) the admin password on the server. Run it from the project folder:
#
#   bash scripts/set-admin-password.sh
#
# The password is typed hidden and asked twice. It is hashed inside the api image (the same
# code the login checks with, always as UTF-8), then written to .env in SINGLE quotes - Docker
# Compose would otherwise treat the "$" signs of a hash as variables and silently cut it, and
# the login would never work. The password itself is not printed, stored, or left in the shell
# history. If the api container is running it is recreated so the new password applies at once.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="${COMPOSE:-docker compose -f docker-compose.prod.yml}"

if [ ! -f .env ]; then
  echo ".env not found in $(pwd) - create it from .env.example first." >&2
  exit 1
fi

IFS= read -rsp "New admin password (10+ characters): " PW
echo
if [ "${#PW}" -lt 10 ]; then
  echo "Too short: use at least 10 characters (this site is open to the internet)." >&2
  exit 1
fi
IFS= read -rsp "Repeat it: " PW2
echo
if [ "$PW" != "$PW2" ]; then
  echo "The two passwords differ - nothing changed." >&2
  exit 1
fi

HASH="$($COMPOSE run --rm --no-deps -T api python -m core.auth.password "$PW" | grep -E '^pbkdf2_sha256\$' | tail -n 1)"
unset PW PW2
if [ -z "$HASH" ]; then
  echo "Could not create the hash - nothing changed." >&2
  exit 1
fi

# Replace the old line (or add one); every other line of .env stays exactly as it was.
grep -v '^ADMIN_PASSWORD_HASH=' .env > .env.tmp || true
printf "ADMIN_PASSWORD_HASH='%s'\n" "$HASH" >> .env.tmp
chmod 600 .env.tmp
mv .env.tmp .env

if $COMPOSE ps --status running --services 2>/dev/null | grep -qx api; then
  $COMPOSE up -d --force-recreate api
  echo "Done. Log in with the password you just typed."
else
  echo "Saved. The api is not running yet: start the stack with"
  echo "  $COMPOSE up -d --build"
fi
