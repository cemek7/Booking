#!/usr/bin/env bash

set -euo pipefail

STACK_ROOT="${STACK_ROOT:-/opt/techclave}"
TARGET="${1:-}"

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

set -a
source "$STACK_DIR/.env"
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

docker compose --env-file "$STACK_DIR/.env" -f "$STACK_DIR/docker-compose.yml" pull
docker compose --env-file "$STACK_DIR/.env" -f "$STACK_DIR/docker-compose.yml" up -d

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
# techclave-${TARGET}-start
APP_URL=${APP_PUBLIC_URL}
CRON_SECRET=${CRON_SECRET}

* * * * * curl -fsS -X POST -H "x-cron-secret: \$CRON_SECRET" "\$APP_URL/api/jobs/process" >/dev/null 2>&1
*/15 * * * * curl -fsS -X POST -H "x-cron-secret: \$CRON_SECRET" "\$APP_URL/api/jobs/auto-cancel-unconfirmed" >/dev/null 2>&1
* * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/worker/whatsapp" >/dev/null 2>&1
*/10 * * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/cron/reminders" >/dev/null 2>&1
0 22 * * * curl -fsS -H "Authorization: Bearer \$CRON_SECRET" "\$APP_URL/api/cron/nightly" >/dev/null 2>&1
# techclave-${TARGET}-end
EOF

  local existing
  existing="$(mktemp)"
  crontab -l > "$existing" 2>/dev/null || true

  awk "
    BEGIN {skip=0}
    \$0 == \"# techclave-${TARGET}-start\" {skip=1; next}
    \$0 == \"# techclave-${TARGET}-end\" {skip=0; next}
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
