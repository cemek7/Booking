#!/usr/bin/env bash
#
# Booka rollout helper - generic, reusable for every deploy.
# Reads the tracked image tag from APP_IMAGE in the stack's .env, pulls it, and
# redeploys ONLY if the pulled image differs from what's running. Safe to run
# any time - a no-op when already current.
#
# Run under sudo (docker access + reads root-owned .env):
#   sudo bash booka-deploy.sh                 # pull + redeploy IF new + verify + health
#   sudo bash booka-deploy.sh check           # dry-run: is a newer image available? (best-effort, no pull)
#   sudo bash booka-deploy.sh verify          # show what's running now (no changes)
#   sudo bash booka-deploy.sh rollback        # revert to the previous image
#
# Target another stack by overriding STACK_DIR:
#   sudo STACK_DIR=/opt/techclave/prod bash booka-deploy.sh
#
set -uo pipefail

STACK_DIR="${STACK_DIR:-/opt/techclave/staging}"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_FILE="$STACK_DIR/.env"
SERVICE="${SERVICE:-app}"
PREV_FILE="$STACK_DIR/.booka-prev-image"
MODE="${1:-deploy}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
line()  { printf -- '---------------------------------------------\n'; }
short() { printf '%s' "${1:-}" | grep -oE 'sha256:[0-9a-f]{12}' | head -1 || printf 'none'; }

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

app_image() { grep -E '^APP_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }
port_val()  { grep -E '^APP_PORT=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"'"'"' '; }

# Digest of the RUNNING container's image: container -> image id -> RepoDigests[0].
running_digest() {
  local cid imgid
  cid="$(dc ps -q "$SERVICE" 2>/dev/null)"
  [ -z "$cid" ] && return 1
  imgid="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null)"
  [ -z "$imgid" ] && return 1
  docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$imgid" 2>/dev/null
}

# Digest of the LOCAL copy of the APP_IMAGE tag (populated/refreshed by `docker pull`).
local_tag_digest() {
  local ref; ref="$(app_image)"
  [ -z "$ref" ] && return 1
  docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$ref" 2>/dev/null
}

running_tag() {
  local cid
  cid="$(dc ps -q "$SERVICE" 2>/dev/null)"
  [ -z "$cid" ] && return 1
  docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null
}

# Best-effort registry digest WITHOUT downloading layers (for the dry-run `check`).
# Uses the manifest descriptor digest, which is what RepoDigests reports.
remote_digest() {
  local ref; ref="$(app_image)"
  [ -z "$ref" ] && return 1
  docker buildx imagetools inspect "$ref" --format '{{.Manifest.Digest}}' 2>/dev/null && return 0
  docker manifest inspect --verbose "$ref" 2>/dev/null \
    | grep -oE '"digest":[[:space:]]*"sha256:[0-9a-f]+"' | head -1 \
    | grep -oE 'sha256:[0-9a-f]+'
}

require_files() {
  [ -f "$ENV_FILE" ]     || { red "Missing $ENV_FILE"; exit 1; }
  [ -f "$COMPOSE_FILE" ] || { red "Missing $COMPOSE_FILE"; exit 1; }
  cd "$STACK_DIR" || exit 1
}

health() {
  local port url
  port="$(port_val)"
  url="$(grep -E '^(APP_PUBLIC_URL|APP_URL)=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  [ -z "$url" ] && url="https://staging.app.techclave.cloud"
  bold "Container status:"; dc ps; line
  if [ -n "$port" ]; then
    printf 'Local  health (127.0.0.1:%s): ' "$port"
    if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then green "OK"; else red "FAIL"; fi
  fi
  printf 'Public health (%s): ' "$url"
  if curl -fsS "${url%/}/api/health" >/dev/null 2>&1; then green "OK"; else red "FAIL (check Nginx/TLS/DNS)"; fi
}

wait_health() {
  local port; port="$(port_val)"
  [ -z "$port" ] && return 0
  for _ in $(seq 1 24); do
    curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1 && return 0
    sleep 5
  done
}

case "$MODE" in
  check)
    require_files
    run="$(running_digest || true)"
    rem="$(remote_digest || true)"
    bold "Update check ($(app_image))"
    echo "  running  : $(short "$run")"
    echo "  registry : $(short "$rem")"
    if [ -z "$rem" ]; then
      red "  Could not read the registry digest (auth? network?). Run 'deploy' - it pulls and is a no-op if current."
    elif [ -z "$run" ]; then
      green "  Nothing running yet - deploy will start it."
    elif printf '%s' "$run" | grep -q "$rem"; then
      green "  Up to date - no deploy needed."
    else
      green "  NEWER image available. Deploy with:  sudo bash $0"
    fi
    ;;

  verify)
    require_files
    line; bold "Currently running"
    echo "  tag    : $(running_tag || echo '<none>')"
    echo "  digest : $(running_digest || echo '<none>')"
    health
    ;;

  rollback)
    require_files
    [ -f "$PREV_FILE" ] || { red "No saved rollback image at $PREV_FILE"; exit 1; }
    prev="$(cat "$PREV_FILE")"
    [ -z "$prev" ] && { red "$PREV_FILE empty - nothing to roll back to."; exit 1; }
    bold "Rolling back to: $prev"
    repo="${prev%@*}"                                  # ghcr.io/cemek7/booking
    sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${prev}|" "$ENV_FILE"
    echo "Pinned APP_IMAGE to $prev"
    dc pull "$SERVICE" && dc up -d
    wait_health
    health
    ;;

  deploy)
    require_files
    bold "== Booka rollout =="
    echo "Stack: $STACK_DIR   Service: $SERVICE   Image: $(app_image)"
    [ -n "$(app_image)" ] || { red "APP_IMAGE not set in .env"; exit 1; }
    line

    before="$(running_digest || true)"
    [ -n "$before" ] && { echo "$before" > "$PREV_FILE"; echo "Rollback point saved: $(short "$before")"; }

    bold "Pulling $(app_image) ..."
    if ! dc pull "$SERVICE"; then
      red "Pull failed. If 'denied'/'unauthorized', log in to GHCR and re-run:"
      echo "  echo <GITHUB_PAT_read:packages> | docker login ghcr.io -u cemek7 --password-stdin"
      exit 1
    fi
    target="$(local_tag_digest || true)"
    line
    echo "  running now : $(short "$before")"
    echo "  pulled tag  : $(short "$target")"

    if [ -n "$before" ] && [ -n "$target" ] && [ "$before" = "$target" ]; then
      green "Already on the latest image - nothing to redeploy."
      health
      exit 0
    fi

    bold "New image - recreating container ..."
    dc up -d
    wait_health
    line; bold "Result"
    echo "  now running : $(running_digest || echo '<none>')"
    health
    line
    green "Rollout complete. Roll back if needed:  sudo bash $0 rollback"
    ;;

  *)
    red "Unknown mode: $MODE (use: deploy | check | verify | rollback)"
    exit 1
    ;;
esac
