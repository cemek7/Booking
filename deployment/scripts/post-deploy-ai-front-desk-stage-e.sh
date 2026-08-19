#!/usr/bin/env bash
set -euo pipefail

TENANT_ID="${1:-${TENANT_ID:-}}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

if [[ -z "${TENANT_ID}" ]]; then
  echo "Usage: $0 <TENANT_UUID>" >&2
  exit 1
fi

psql "$DATABASE_URL" -f scripts/sql/apply_ai_front_desk_stage_e.sql
bash deployment/scripts/verify-ai-front-desk-stage-e.sh "$TENANT_ID"
