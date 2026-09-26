#!/usr/bin/env bash
# Rolls out a new version without taking the radio down, and without ever
# touching the data: one service at a time, after a database backup.
#
#   scripts/deploy.sh           build here, then roll out
#   scripts/deploy.sh --pull    use released images (SERVER_IMAGE / WEB_IMAGE in .env)
#   scripts/deploy.sh --all     also restart postgres and mediamtx (brief blip)
#
# Why not `docker compose up -d`? When several services change at once,
# compose stops them all first and waits for the broadcaster to drain, so the
# site is down for the rest of the song (2026-09-26 outage).
set -euo pipefail
cd "$(dirname "$0")/.."

PULL=0
ALL=0
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --all) ALL=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

# 1. Back up the database first. Data lives in a named volume that deploys never
#    remove, and migrations only move forward; this is the safety net anyway.
if docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  mkdir -p backups
  file="backups/lastradio-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "▸ backing up the database to $file"
  docker compose exec -T postgres pg_dump -U lastradio -d lastradio --clean --if-exists | gzip > "$file"
  # Keep the 10 most recent.
  ls -1t backups/lastradio-*.sql.gz 2>/dev/null | tail -n +11 | xargs -r rm --
fi

if [ "$PULL" = 1 ]; then
  echo "▸ pulling ${SERVER_IMAGE:-$(grep -E '^SERVER_IMAGE=' .env | cut -d= -f2)} and the web image"
  docker compose pull api web broadcaster
else
  echo "▸ building"
  docker compose build --quiet api web
fi

echo "▸ api (runs migrations; a couple of seconds)"
docker compose up -d --no-deps api
for _ in $(seq 1 60); do
  docker compose exec -T api node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  sleep 1
done

echo "▸ web"
docker compose up -d --no-deps web

echo "▸ broadcaster (lets the song on air finish; stream server stays up meanwhile)"
docker compose up -d --no-deps broadcaster

if [ "$ALL" = 1 ]; then
  echo "▸ postgres and mediamtx (short interruption)"
  docker compose up -d --no-deps postgres
  docker compose up -d --no-deps mediamtx
fi

docker compose ps --format "{{.Name}}\t{{.Status}}"
# Through the web container, so it works with a host port or behind a proxy.
if docker compose exec -T web wget -q -O /dev/null http://localhost/api/health; then echo "▸ health ok"; else echo "▸ health FAILED" >&2; exit 1; fi
