#!/usr/bin/env bash

# Refresh a Booka stack when its branch publishes a new immutable image.
#
# Installed on the VPS as /usr/local/bin/techclave-refresh-image and run every
# five minutes by booka-<target>-image-refresh.timer. This is the path that
# actually restarts production after a push, so it was versioned here after it
# took production down while living only on the server.
#
# Usage: refresh-image.sh [--remote|--watch]
#   (default)  refresh the APP_IMAGE currently pinned in .env
#   --remote   resolve the branch head, wait for its image, deploy if not running
#   --watch    --remote in a loop (prefer the systemd timer)
#
# Configured by the systemd unit: DEPLOY_TARGET, STACK_SUBDIR, CONTAINER_NAME,
# BRANCH_NAME, IMAGE_CHANNEL. Everything else has a default below.

set -euo pipefail

STACK_ROOT="${STACK_ROOT:-/opt/techclave}"
DEPLOY_TARGET="${DEPLOY_TARGET:-staging}"
STACK_SUBDIR="${STACK_SUBDIR:-$DEPLOY_TARGET}"
STACK_DIR="${STACK_DIR:-${STACK_ROOT}/${STACK_SUBDIR}}"
ENV_FILE="${STACK_DIR}/.env"
SECRETS_FILE="${STACK_DIR}/.secrets.env"
COMPOSE_FILE="${STACK_DIR}/docker-compose.yml"
CONTAINER_NAME="${CONTAINER_NAME:-booka-${DEPLOY_TARGET}-app}"
FORCE_RECREATE="${FORCE_RECREATE:-false}"
READY_ATTEMPTS="${READY_ATTEMPTS:-30}"
READY_SLEEP_SECONDS="${READY_SLEEP_SECONDS:-5}"
CLEANUP_DOCKER="${CLEANUP_DOCKER:-true}"
REPO_DIR="${REPO_DIR:-/opt/Booking}"
REMOTE_NAME="${REMOTE_NAME:-origin}"
BRANCH_NAME="${BRANCH_NAME:-$DEPLOY_TARGET}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-ghcr.io/cemek7/booking}"
IMAGE_CHANNEL="${IMAGE_CHANNEL:-$DEPLOY_TARGET}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-300}"
ROUTE_CHECKER="${ROUTE_CHECKER:-/usr/local/bin/techclave-check-public-routes}"
MODE="${1:-configured}"

if [[ "$MODE" =~ ^(-h|--help)$ ]]; then
  sed -n '3,17p' "$0"
  exit 0
fi

if [[ "$MODE" != "configured" && "$MODE" != "--remote" && "$MODE" != "--watch" ]]; then
  echo "Usage: $0 [--remote|--watch]" >&2
  exit 2
fi

for required in "$ENV_FILE" "$SECRETS_FILE" "$COMPOSE_FILE"; do
  if [[ ! -f "$required" ]]; then
    echo "Missing required file: $required" >&2
    exit 1
  fi
done

compose() {
  docker compose --env-file "$ENV_FILE" --env-file "$SECRETS_FILE" -f "$COMPOSE_FILE" "$@"
}

# Both files, .env first. This is not just for our own variables: Compose gives
# variables already in the SHELL priority over every --env-file. Sourcing .env
# alone exported its REDIS_PASSWORD, which then beat .secrets.env in the app's
# REDIS_URL even when both files were passed to Compose — so the app and Redis
# disagreed, and every page returned 503. The shell must end up holding exactly
# what Compose would have chosen.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

if [[ -z "${APP_IMAGE:-}" ]]; then
  echo "APP_IMAGE must be set in $ENV_FILE" >&2
  exit 1
fi

if [[ -z "${APP_PUBLIC_URL:-}" ]]; then
  echo "APP_PUBLIC_URL must be set in $ENV_FILE" >&2
  exit 1
fi

ready_url="${APP_PUBLIC_URL%/}/api/ready"

running_image_ref() {
  docker inspect "$CONTAINER_NAME" --format '{{.Config.Image}}' 2>/dev/null || true
}

refresh_configured_image() {
  local running_image_id=""
  local latest_image_id
  local final_image_id

  if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    running_image_id="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"
  fi

  echo "Pulling $APP_IMAGE"
  docker pull "$APP_IMAGE" >/dev/null
  latest_image_id="$(docker image inspect "$APP_IMAGE" --format '{{.Id}}')"

  echo "Latest image id:  $latest_image_id"
  echo "Running image id: ${running_image_id:-<none>}"

  compose config >/dev/null

  if [[ "$FORCE_RECREATE" != "true" && -n "$running_image_id" && "$running_image_id" == "$latest_image_id" ]]; then
    echo "$DEPLOY_TARGET app is already on the latest image."
  else
    echo "Recreating $DEPLOY_TARGET app on the latest image."
    compose up -d --force-recreate app
  fi

  # Readiness, not liveness: /api/health stayed 200 through the Redis outage.
  for ((i = 1; i <= READY_ATTEMPTS; i += 1)); do
    if curl -fsS "$ready_url" 2>/dev/null | grep -q '"status":"ready"'; then
      break
    fi
    if ((i == READY_ATTEMPTS)); then
      echo "Readiness check failed for $ready_url" >&2
      return 1
    fi
    sleep "$READY_SLEEP_SECONDS"
  done

  final_image_id="$(docker inspect "$CONTAINER_NAME" --format '{{.Image}}')"
  if [[ "$final_image_id" != "$latest_image_id" ]]; then
    echo "Running container image does not match the pulled image." >&2
    echo "Expected: $latest_image_id" >&2
    echo "Actual:   $final_image_id" >&2
    return 1
  fi

  echo "$DEPLOY_TARGET refresh complete on $final_image_id."

  if [[ "$CLEANUP_DOCKER" == "true" ]]; then
    docker builder prune -af >/dev/null || true
    docker image prune -af >/dev/null || true
  fi
}

set_app_image() {
  local image="$1"
  sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${image}|" "$ENV_FILE"
  APP_IMAGE="$image"
}

refresh_remote_image() {
  local sha
  local candidate_image

  if [[ ! -e "$REPO_DIR/.git" ]]; then
    echo "Missing Git checkout: $REPO_DIR" >&2
    return 1
  fi
  sha="$(timeout 30s git -C "$REPO_DIR" ls-remote "$REMOTE_NAME" "refs/heads/$BRANCH_NAME" | awk 'NR == 1 { print $1 }')"
  if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Unable to resolve $REMOTE_NAME/$BRANCH_NAME" >&2
    return 1
  fi

  candidate_image="${IMAGE_REPOSITORY}:${IMAGE_CHANNEL}-${sha}"
  if ! docker manifest inspect "$candidate_image" >/dev/null 2>&1; then
    echo "Image for $BRANCH_NAME@$sha is not published yet; no deployment performed."
    return 0
  fi

  # Compare against what is RUNNING, not what .env says. .env is rewritten before
  # the rollout, so a rollout that failed halfway used to leave .env pinned to
  # the new image; every later tick then saw a match, reported "no deployment
  # performed", and never tried again.
  if [[ "$(running_image_ref)" == "$candidate_image" ]]; then
    echo "$DEPLOY_TARGET is already running $candidate_image; no deployment performed."
    return 0
  fi

  echo "Published image found for $BRANCH_NAME@$sha; deploying to $DEPLOY_TARGET."
  set_app_image "$candidate_image"
  refresh_configured_image
}

case "$MODE" in
  configured)
    refresh_configured_image
    ;;
  --remote)
    refresh_remote_image
    ;;
  --watch)
    while true; do
      if ! refresh_remote_image; then
        echo "Remote refresh failed; retrying after ${POLL_INTERVAL_SECONDS}s." >&2
      fi
      sleep "$POLL_INTERVAL_SECONDS"
    done
    ;;
esac

# Runs on every tick, not only after a rollout, so a regression the proxy or a
# dependency introduces later still fails the unit. Hosts come from .env rather
# than being written here, so one script serves both stacks.
# MARKETING_PUBLIC_URL may list several hosts, separated by spaces or commas.
route_bases=("$APP_PUBLIC_URL")
if [[ -n "${MARKETING_PUBLIC_URL:-}" ]]; then
  read -ra marketing_hosts <<<"${MARKETING_PUBLIC_URL//,/ }"
  route_bases+=("${marketing_hosts[@]}")
fi
"$ROUTE_CHECKER" "${route_bases[@]}"
