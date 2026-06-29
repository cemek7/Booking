#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 1
fi

psql "$DATABASE_URL" -f scripts/sql/apply_ai_front_desk_stage_g.sql
bash deployment/scripts/verify-ai-front-desk-stage-g.sh "${TENANT_ID:-}"
