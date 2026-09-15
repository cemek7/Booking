#!/usr/bin/env bash

# Confirms a release actually serves the public site, not just that the process
# is alive.
#
# Usage: check-public-routes.sh <base-url> [<base-url> ...]
#   e.g. check-public-routes.sh https://app.techclave.cloud https://techclave.cloud
#
# Two outages this catches, both of which passed the old liveness check:
#   - 2026-09-14: the app and Redis disagreed on a password. /api/health stayed
#     200 because it does not touch Redis, while every page returned 503.
#   - techclave.cloud forwarded only /, /booka and /_next to the app, so the
#     contact page and every legal page returned nginx's 404 for weeks.
#
# Exits non-zero when any base URL is not ready or any route fails, and prints
# one FAIL line per problem. The route list must match PUBLIC_ROUTES in
# src/lib/site/publicRoutes.ts; src/__tests__/scripts/publicRoutesCheck.test.ts
# fails the build if they drift apart.

set -uo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <base-url> [<base-url> ...]" >&2
  exit 2
fi

PUBLIC_ROUTES=(
  /
  /contact
  /products
  /showcase
  /booka
  /privacy
  /terms
  /cookies
  /refunds
  /acceptable-use
  /accessibility
  /data-retention
  /dpa
  /sub-processors
  /ugc-policy
)

READY_ATTEMPTS="${READY_ATTEMPTS:-30}"
READY_INTERVAL="${READY_INTERVAL:-5}"

failures=0

fail() {
  echo "FAIL $*" >&2
  failures=$((failures + 1))
}

# Readiness, not liveness: /api/ready checks Redis and the database, which is
# exactly what /api/health skipped on the day every page went down.
wait_for_ready() {
  local base="$1"
  for ((i = 1; i <= READY_ATTEMPTS; i += 1)); do
    if curl -fsS --max-time 10 "$base/api/ready" 2>/dev/null | grep -q '"status":"ready"'; then
      echo "ready  $base"
      return 0
    fi
    sleep "$READY_INTERVAL"
  done
  fail "$base/api/ready never reported ready"
  return 1
}

for raw in "$@"; do
  base="${raw%/}"
  wait_for_ready "$base" || continue

  for route in "${PUBLIC_ROUTES[@]}"; do
    code="$(curl -s --max-time 15 -o /dev/null -w '%{http_code}' "$base$route")"
    # 2xx is served; 3xx is a deliberate redirect. Anything else, including 000
    # for a timeout, means a visitor following a link gets nothing.
    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
      echo "ok     $code $base$route"
    else
      fail "$code $base$route"
    fi
  done
done

if ((failures > 0)); then
  echo "$failures public route check(s) failed." >&2
  exit 1
fi
echo "All public routes served."
