#!/usr/bin/env bash

set -euo pipefail

STACK_ROOT="${STACK_ROOT:-/opt/techclave}"
TARGET="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_SECRET_GENERATOR="/usr/local/bin/techclave-ensure-runtime-secrets"
if [[ ! -x "$DEFAULT_SECRET_GENERATOR" ]]; then
  DEFAULT_SECRET_GENERATOR="$SCRIPT_DIR/ensure-generated-runtime-secrets.sh"
fi
SECRET_GENERATOR="${TECHCLAVE_RUNTIME_SECRET_GENERATOR:-$DEFAULT_SECRET_GENERATOR}"

# The cron block below is baked into this script, and bootstrap-vps.sh copies
# this file to /usr/local/bin/techclave-deploy ONCE at provisioning. Nothing
# ever re-copied it, so every later edit — new workers, changed schedules — was
# invisible to the box: the wrapper stayed frozen at whatever shipped on the day
# the server was built, and `techclave-deploy` kept installing that generation's
# jobs while the repo said otherwise.
#
# So when this is run FROM the repo, it reinstalls the wrapper first. Only then,
# because overwriting the file bash is currently reading is how you get a
# half-executed script.
INSTALLED_WRAPPER="/usr/local/bin/techclave-deploy"
if [[ "$SCRIPT_DIR" != "$(dirname "$INSTALLED_WRAPPER")" ]]; then
  if [[ ! -f "$INSTALLED_WRAPPER" ]] || ! cmp -s "${BASH_SOURCE[0]}" "$INSTALLED_WRAPPER"; then
    if install -m 755 "${BASH_SOURCE[0]}" "$INSTALLED_WRAPPER" 2>/dev/null; then
      echo "Updated $INSTALLED_WRAPPER from the repo copy."
    else
      echo "WARNING: $INSTALLED_WRAPPER is out of date and could not be updated (needs root)." >&2
      echo "         Run: sudo install -m 755 ${BASH_SOURCE[0]} $INSTALLED_WRAPPER" >&2
    fi
  fi
fi

usage() {
  cat <<EOF
Usage: techclave-deploy <staging|production>

Environment variables:
  STACK_ROOT      Override stack root (default: /opt/techclave)
  APP_IMAGE       Override image tag for the current deploy
  GHCR_USERNAME   Optional GHCR username
  GHCR_TOKEN      Optional GHCR token/password
EOF
}

if [[ -z "$TARGET" ]]; then
  usage
  exit 1
fi

case "$TARGET" in
  staging)
    STACK_DIR="$STACK_ROOT/staging"
    ;;
  production|prod)
    TARGET="production"
    STACK_DIR="$STACK_ROOT/prod"
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    usage
    exit 1
    ;;
esac

if [[ ! -f "$STACK_DIR/.env" ]]; then
  echo "Missing environment file: $STACK_DIR/.env" >&2
  exit 1
fi

if [[ ! -f "$STACK_DIR/docker-compose.yml" ]]; then
  echo "Missing compose file: $STACK_DIR/docker-compose.yml" >&2
  exit 1
fi

if [[ ! -x "$SECRET_GENERATOR" ]]; then
  echo "Missing runtime-secret generator: $SECRET_GENERATOR" >&2
  exit 1
fi

# Generates only Booka-owned secrets when absent and preserves prior values.
STACK_ROOT="$STACK_ROOT" "$SECRET_GENERATOR" "$TARGET"

set -a
source "$STACK_DIR/.env"
source "$STACK_DIR/.secrets.env"
set +a

if [[ -n "${APP_IMAGE:-}" ]]; then
  export APP_IMAGE
fi

if [[ -z "${APP_IMAGE:-}" ]]; then
  echo "APP_IMAGE must be set in $STACK_DIR/.env or exported for the deploy." >&2
  exit 1
fi

if [[ "$APP_IMAGE" == ghcr.io/* ]] && [[ -n "${GHCR_USERNAME:-}" ]] && [[ -n "${GHCR_TOKEN:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

docker compose --env-file "$STACK_DIR/.env" --env-file "$STACK_DIR/.secrets.env" -f "$STACK_DIR/docker-compose.yml" pull
docker compose --env-file "$STACK_DIR/.env" --env-file "$STACK_DIR/.secrets.env" -f "$STACK_DIR/docker-compose.yml" up -d

install_cron() {
  if [[ "${ENABLE_CRON:-false}" != "true" ]]; then
    echo "Cron is disabled for $TARGET."
    return
  fi

  if [[ -z "${APP_PUBLIC_URL:-}" ]] || [[ -z "${CRON_SECRET:-}" ]]; then
    echo "Skipping cron install because APP_PUBLIC_URL or CRON_SECRET is empty."
    return
  fi

  cat > "$STACK_DIR/cron.block" <<EOF
# techclave-${TARGET}-start (cron-generation 2)
APP_URL=${APP_PUBLIC_URL}
CRON_SECRET=${CRON_SECRET}

* * * * * curl -fsS -X POST -H "x-cron-secret: \$CRON_SECRET" "\$APP_URL/api/jobs/process" >/dev/null 2>&1
*/15 * * * * curl -fsS -X POST -H "x-cron-secret: \$CRON_SECRET" "\$APP_URL/api/jobs/auto-cancel-unconfirmed" >/dev/null 2>&1
* * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/whatsapp" >/dev/null 2>&1
*/10 * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/cron/reminders" >/dev/null 2>&1
0 22 * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/cron/nightly" >/dev/null 2>&1
*/5 * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/operating-loop" >/dev/null 2>&1
# Releases message-charge reservations that never got a delivery webhook. Without
# it every tenant's balance drains into reservations that never settle, and its
# released count is the only early warning that Meta has stopped delivering
# statuses at all.
*/15 * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/message-charges" >/dev/null 2>&1
# Meta bills in USD and Booka sells in naira, so the real cost moves with the
# rate, on no schedule and with nothing to read. This is the only thing that
# notices.
17 6 * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/fx-rate" >/dev/null 2>&1
# Warns tenants who own their own Meta billing before 2026-10-01, when Meta
# stops delivering service messages for accounts with no payment method.
23 9 * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/meta-payment-watch" >/dev/null 2>&1
# techclave-${TARGET}-end
EOF

  local existing
  existing="$(mktemp)"
  crontab -l > "$existing" 2>/dev/null || true

  # Prefix match, not equality: the start marker carries a generation suffix so
  # `crontab -l` shows which version is installed, and an exact match would fail
  # to strip a block written by a different generation — leaving the old jobs in
  # place alongside the new ones and running everything twice.
  awk "
    BEGIN {skip=0}
    index(\$0, \"# techclave-${TARGET}-start\") == 1 {skip=1; next}
    index(\$0, \"# techclave-${TARGET}-end\") == 1 {skip=0; next}
    skip == 0 {print}
  " "$existing" > "$STACK_DIR/cron.tab"

  cat "$STACK_DIR/cron.block" >> "$STACK_DIR/cron.tab"
  crontab "$STACK_DIR/cron.tab"
  rm -f "$existing"
}

wait_for_health() {
  if [[ -z "${APP_PUBLIC_URL:-}" ]]; then
    echo "APP_PUBLIC_URL is empty; skipping remote health check."
    return
  fi

  local attempts=30
  local url="${APP_PUBLIC_URL%/}/api/health"

  for ((i=1; i<=attempts; i+=1)); do
    if curl -fsS "$url" >/dev/null; then
      echo "Health check passed for $TARGET at $url"
      return
    fi
    sleep 5
  done

  echo "Health check failed for $TARGET at $url" >&2
  exit 1
}

install_cron
wait_for_health
docker image prune -f >/dev/null 2>&1 || true

echo "Deploy completed for $TARGET"
