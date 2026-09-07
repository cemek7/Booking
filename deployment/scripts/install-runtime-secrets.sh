#!/usr/bin/env bash

# Installs a handoff file without printing its contents. Run this on the VPS:
#   install-runtime-secrets.sh /secure/path/.secrets.handoff.env staging
# The source is copied atomically with mode 600, then can be removed by the
# operator. Do not pass secret values as command-line arguments.

set -euo pipefail
umask 077

SOURCE_FILE="${1:-}"
TARGET="${2:-}"
STACK_ROOT="${STACK_ROOT:-/opt/techclave}"

if [[ -z "$SOURCE_FILE" || "$TARGET" != "staging" && "$TARGET" != "production" ]]; then
  echo "Usage: $0 /secure/path/.secrets.handoff.env <staging|production>" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_FILE" || ! -r "$SOURCE_FILE" ]]; then
  echo "Secret handoff file is missing or unreadable." >&2
  exit 1
fi

if [[ "$TARGET" == "production" ]]; then
  TARGET_DIR="$STACK_ROOT/prod"
else
  TARGET_DIR="$STACK_ROOT/staging"
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Deployment directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

TARGET_FILE="$TARGET_DIR/.secrets.env"
TEMP_FILE="$(mktemp "$TARGET_DIR/.secrets.env.tmp.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

# Validate only the format of variable names. Values are never echoed.
if ! awk -F= '
  /^[[:space:]]*($|#)/ { next }
  $1 !~ /^[A-Za-z_][A-Za-z0-9_]*$/ { exit 1 }
' "$SOURCE_FILE"; then
  echo "Secret handoff file contains an invalid environment-variable name." >&2
  exit 1
fi

install -m 600 "$SOURCE_FILE" "$TEMP_FILE"
mv -f "$TEMP_FILE" "$TARGET_FILE"
trap - EXIT

echo "Runtime secrets installed for $TARGET. No secret values were displayed."
