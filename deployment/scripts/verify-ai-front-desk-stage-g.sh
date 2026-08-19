#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

TENANT_ID_ARG="${1:-${TENANT_ID:-}}"

psql "$DATABASE_URL" \
  -v tenant_id="${TENANT_ID_ARG}" \
  -f scripts/sql/verify_ai_front_desk_stage_g.sql
