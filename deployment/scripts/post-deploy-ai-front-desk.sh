#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required"
  exit 1
fi

if [[ -z "${APP_URL:-}" ]]; then
  echo "APP_URL is required"
  exit 1
fi

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "CRON_SECRET is required"
  exit 1
fi

TENANT_ID_ARG="${1:-${TENANT_ID:-}}"

if [[ -z "${TENANT_ID_ARG}" ]]; then
  echo "Tenant ID is required as the first argument or TENANT_ID env var"
  echo "Example: bash deployment/scripts/post-deploy-ai-front-desk.sh <TENANT_UUID>"
  exit 1
fi

echo "Applying AI front desk Stage B schema..."
psql "$DATABASE_URL" -f scripts/sql/apply_ai_front_desk_stage_b.sql

echo "Verifying Booka revenue request intake schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  missing_columns text[];
begin
  select array_agg(required.name)
  into missing_columns
  from (values ('request_type'), ('status'), ('audit_summary')) as required(name)
  where not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booka_revenue_requests'
      and column_name = required.name
  );

  if missing_columns is not null then
    raise exception 'booka_revenue_requests missing columns: %', missing_columns;
  end if;
end $$;
SQL

echo "Triggering nightly aggregation..."
curl -fsS -X GET "$APP_URL/api/cron/nightly" \
  -H "authorization: Bearer $CRON_SECRET"

echo
echo "Verifying Stage B data for tenant $TENANT_ID_ARG ..."
bash deployment/scripts/verify-ai-front-desk-stage-b.sh "$TENANT_ID_ARG"
