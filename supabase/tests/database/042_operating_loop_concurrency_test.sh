#!/usr/bin/env bash
set -euo pipefail

: "${BOOKA_OPERATING_LOOP_TEST_DATABASE_URL:?Set a dedicated local/CI PostgreSQL test database URL.}"

database_name="$(psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" -Atq -c 'select current_database()')"
case "$database_name" in
  *operating_loop_test*|*booka_test*) ;;
  *)
    echo "Refusing to run against database '$database_name'. Use a dedicated *operating_loop_test* or *booka_test* database." >&2
    exit 2
    ;;
esac

tenant_id='20000000-0000-0000-0000-000000000001'
owner_id='10000000-0000-0000-0000-000000000001'

run_pair() {
  local label="$1"
  local objective_id="$2"
  local dedupe_key="$3"
  local source_fingerprint="$4"
  local mode="$5"
  local scheduled_for_sql="$6"
  local scratch_dir
  scratch_dir="$(mktemp -d)"

  # Session A owns the same advisory lock used by persistence, then calls the
  # real persistence RPC. Session B calls the real defer/dismiss RPC while A
  # holds that lock. The old lock order (row lock -> advisory lock) deadlocks:
  # B owns the row and waits for A's advisory lock while A waits for B's row.
  # The corrected suppression RPC waits for the shared advisory lock before it
  # ever locks the objective row, so both calls complete.
  (
    psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${tenant_id}' || E'\\x1f' || '${dedupe_key}', 0));
SELECT pg_catalog.pg_sleep(0.4);
SELECT * FROM public.persist_operating_objective_draft(
  '${tenant_id}', 'confirm_booking', '${dedupe_key}', '${source_fingerprint}', 'Concurrent ${label}', 'Concurrent persistence must not deadlock.',
  '{}'::jsonb, '[]'::jsonb, 1, NULL, now() + interval '1 hour', 'active'
);
COMMIT;
SQL
  ) >"${scratch_dir}/persist.log" 2>&1 &
  local persist_pid=$!

  # Give session A enough time to acquire the advisory lock deterministically.
  sleep 0.1
  (
    psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
SET lock_timeout = '5s';
SELECT * FROM public.apply_operating_suppression(
  '${tenant_id}', '${owner_id}', '${objective_id}', '${mode}', ${scheduled_for_sql}, 'concurrency harness'
);
SQL
  ) >"${scratch_dir}/suppress.log" 2>&1 &
  local suppress_pid=$!

  if ! wait "$persist_pid"; then
    sed -n '1,160p' "${scratch_dir}/persist.log" >&2
    rm -f "${scratch_dir}/persist.log" "${scratch_dir}/suppress.log"
    rmdir "$scratch_dir"
    return 1
  fi
  if ! wait "$suppress_pid"; then
    sed -n '1,160p' "${scratch_dir}/suppress.log" >&2
    rm -f "${scratch_dir}/persist.log" "${scratch_dir}/suppress.log"
    rmdir "$scratch_dir"
    return 1
  fi

  local result
  result="$(psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" -Atq -v objective_id="$objective_id" -v tenant_id="$tenant_id" -v dedupe_key="$dedupe_key" <<'SQL'
SELECT CASE WHEN
  (SELECT status FROM public.operating_objectives WHERE tenant_id = :'tenant_id'::uuid AND id = :'objective_id'::uuid)
    IN ('deferred', 'dismissed')
  AND (SELECT count(*) FROM public.operating_objective_suppressions
       WHERE tenant_id = :'tenant_id'::uuid AND objective_id = :'objective_id'::uuid) = 1
  AND (SELECT count(*) FROM public.operating_objectives
       WHERE tenant_id = :'tenant_id'::uuid AND dedupe_key = :'dedupe_key' AND status IN ('active', 'queued')) = 0
THEN 'ok' ELSE 'invalid' END;
SQL
)"
  rm -f "${scratch_dir}/persist.log" "${scratch_dir}/suppress.log"
  rmdir "$scratch_dir"
  if [[ "$result" != 'ok' ]]; then
    echo "Concurrent ${label} persistence/suppression left an invalid objective state: ${result}" >&2
    return 1
  fi
}

psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.operating_objectives (id, tenant_id, objective_type, dedupe_key, source_fingerprint, title, explanation, expires_at)
VALUES
  ('30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000001', 'confirm_booking', 'concurrency-defer', 'v1:concurrency-defer', 'Concurrent defer', 'Tests lock ordering.', now() + interval '1 hour'),
  ('30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'confirm_booking', 'concurrency-dismiss', 'v1:concurrency-dismiss', 'Concurrent dismiss', 'Tests lock ordering.', now() + interval '1 hour');
SQL

run_pair 'defer' '30000000-0000-0000-0000-000000000008' 'concurrency-defer' 'v1:concurrency-defer' 'defer' "now() + interval '30 minutes'"
run_pair 'dismiss' '30000000-0000-0000-0000-000000000009' 'concurrency-dismiss' 'v1:concurrency-dismiss' 'dismiss' 'NULL'

echo '042/043 operating-loop two-session concurrency test passed'
