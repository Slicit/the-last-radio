#!/usr/bin/env bash
# Fills the song artwork cache for every song that has artwork (newest first).
# Safe to run any time, on a running radio: cached images are left alone.
#   scripts/backfill-art.sh                   # skip songs whose image failed in the last day
#   scripts/backfill-art.sh --retry-missing   # try those again too
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T api node dist/cli.js backfill-art "$@"
