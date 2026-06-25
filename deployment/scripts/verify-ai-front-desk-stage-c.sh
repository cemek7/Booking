#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

TENANT_ID_ARG="${1:-${TENANT_ID:-}}"

if [[ -z "${TENANT_ID_ARG}" ]]; then
  echo "Tenant ID is required as the first argument or TENANT_ID env var"
  echo "Example: bash deployment/scripts/verify-ai-front-desk-stage-c.sh <TENANT_UUID>"
  exit 1
fi

psql "$DATABASE_URL" -v tenant_id="$TENANT_ID_ARG" -f scripts/sql/verify_ai_front_desk_stage_c.sql
