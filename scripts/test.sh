#!/usr/bin/env bash
# Runs the test suites against a throwaway copy of the whole stack
# ("lastradio-test": own containers, network, volumes and ports), so the live
# radio is never touched. Needs Docker, and node_modules installed at the repo
# root (npm install).
#
#   scripts/test.sh               unit + integration + e2e
#   scripts/test.sh unit          just one layer (unit | integration | e2e)
#   scripts/test.sh --keep e2e    leave the test stack running afterwards
set -euo pipefail
cd "$(dirname "$0")/.."

KEEP=0
LAYERS=()
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    unit | integration | e2e) LAYERS+=("$arg") ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
[ ${#LAYERS[@]} -eq 0 ] && LAYERS=(unit integration e2e)
want() { [[ " ${LAYERS[*]} " == *" $1 "* ]]; }

# The test stack: everything prefixed lastradio-test, on its own ports.
export STACK=lastradio-test
export WEB_PORT=${TEST_WEB_PORT:-28800}
export PG_PORT=${TEST_PG_PORT:-28832}
export POSTGRES_PASSWORD=test-only-password
export PUBLIC_URL=
export COOKIE_SECURE=false
# Every e2e browser shares one IP; let the suite create its accounts.
export REGISTRATIONS_PER_HOUR=500
NET=lastradio-test-net
PW_VERSION=$(node -p "require('@playwright/test/package.json').version")
PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v$PW_VERSION-noble

compose() { docker compose -p lastradio-test -f docker-compose.yml -f docker-compose.test.yml "$@"; }
cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "Test stack left running at http://localhost:$WEB_PORT (stop: docker compose -p lastradio-test down -v)"
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
# Runs a command in a container on the test network, with the repo mounted, as the current user.
in_container() {
  local image=$1
  shift
  docker run --rm --network "$NET" --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 -v "$PWD":/work "$image" "$@"
}

echo "▸ building images"
compose build --quiet

if want unit; then
  echo "▸ unit tests"
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD":/work -w /work/apps/server lastradio-server \
    npx vitest run --project unit
fi

if want integration || want e2e; then
  trap cleanup EXIT
  echo "▸ starting the test stack on port $WEB_PORT"
  compose up -d --wait postgres
  compose up -d
  for _ in $(seq 1 60); do
    curl -fs "http://localhost:$WEB_PORT/api/health" >/dev/null && break
    sleep 1
  done
fi

if want integration; then
  echo "▸ integration tests"
  in_container lastradio-server sh -c "cd /work/apps/server && \
    DATABASE_URL=postgres://lastradio:$POSTGRES_PASSWORD@lastradio-test-postgres:5432/lastradio_it npx vitest run --project integration"
fi

if want e2e; then
  echo "▸ end-to-end tests ($PLAYWRIGHT_IMAGE)"
  in_container "$PLAYWRIGHT_IMAGE" sh -c "cd /work/e2e && BASE_URL=http://lastradio-test-web \
    DATABASE_URL=postgres://lastradio:$POSTGRES_PASSWORD@lastradio-test-postgres:5432/lastradio npx playwright test ${E2E_ARGS:-}"
fi
echo "✔ all requested test layers passed"
