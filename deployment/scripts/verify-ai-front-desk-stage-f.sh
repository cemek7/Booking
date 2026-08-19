#!/usr/bin/env bash
set -euo pipefail

TENANT_ID="${1:-${TENANT_ID:-}}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

psql "$DATABASE_URL" -v tenant_id="${TENANT_ID:-}" -f scripts/sql/verify_ai_front_desk_stage_f.sql
