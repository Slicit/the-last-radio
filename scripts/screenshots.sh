#!/usr/bin/env bash
# Regenerates docs/screenshots/*.png for the README from invented demo data,
# in a throwaway "lastradio-demo" stack (no broadcaster, no real songs).
set -euo pipefail
cd "$(dirname "$0")/.."
export STACK=lastradio-demo WEB_PORT=${DEMO_WEB_PORT:-28900} PG_PORT=${DEMO_PG_PORT:-28932}
export POSTGRES_PASSWORD=demo-only-password PUBLIC_URL= REGISTRATIONS_PER_HOUR=100
compose() { docker compose -p lastradio-demo "$@"; }
trap 'compose down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
PW_VERSION=$(node -p "require('@playwright/test/package.json').version")

compose build --quiet api web
compose up -d --wait postgres
compose up -d mediamtx api web
for _ in $(seq 1 60); do curl -fs "http://localhost:$WEB_PORT/api/health" >/dev/null && break; sleep 1; done

docker run --rm --network lastradio-demo-net --user "$(id -u):$(id -g)" -e HOME=/tmp -e SCREENSHOTS=1 \
  -e DATABASE_URL=postgres://lastradio:$POSTGRES_PASSWORD@lastradio-demo-postgres:5432/lastradio \
  -v "$PWD":/work -w /work/e2e "mcr.microsoft.com/playwright:v$PW_VERSION-noble" \
  env BASE_URL=http://lastradio-demo-web npx playwright test --reporter=list --workers=1 --retries=0 --project=firefox \
  --output /tmp/pw
echo "✔ screenshots in docs/screenshots"
