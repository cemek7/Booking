#!/usr/bin/env bash

# Ensures Booka-owned runtime secrets exist exactly once on the VPS, without
# printing values or overwriting an existing secret. Provider-issued credentials
# (Supabase, Meta, Stripe, Paystack, etc.) are deliberately never generated.
#
# Usage: ensure-generated-runtime-secrets.sh <staging|production>

set -euo pipefail
umask 077

TARGET="${1:-}"
STACK_ROOT="${STACK_ROOT:-/opt/techclave}"

if [[ "$TARGET" != "staging" && "$TARGET" != "production" ]]; then
  echo "Usage: $0 <staging|production>" >&2
  exit 1
fi

TARGET_DIR="$STACK_ROOT/$([[ "$TARGET" == "production" ]] && echo prod || echo staging)"
SECRET_FILE="$TARGET_DIR/.secrets.env"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Deployment directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

touch "$SECRET_FILE"
chmod 600 "$SECRET_FILE"
TEMP_FILE="$(mktemp "$TARGET_DIR/.secrets.env.tmp.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT
cp "$SECRET_FILE" "$TEMP_FILE"

has_value() {
  awk -F= -v key="$1" '$1 == key && length($2) > 0 { found=1 } END { exit !found }' "$TEMP_FILE"
}

append_generated() {
  local key="$1"
  if ! has_value "$key"; then
    printf '%s=%s\n' "$key" "$(openssl rand -hex 32)" >> "$TEMP_FILE"
  fi
}

# These secrets are owned exclusively by this Booka deployment. Keeping them in
# the persistent runtime file preserves signed links, encrypted Meta credentials,
# sessions, cron authentication, Redis access, and OAuth state across restarts.
append_generated STOREFRONT_CONTEXT_SECRET
append_generated NEXTAUTH_SECRET
append_generated ENCRYPTION_KEY
append_generated CRON_SECRET
append_generated JWT_SECRET
append_generated INSTAGRAM_OAUTH_STATE_SECRET
append_generated REDIS_PASSWORD

install -m 600 "$TEMP_FILE" "$SECRET_FILE"
trap - EXIT
echo "Generated runtime secrets ensured for $TARGET. Existing values were preserved."
