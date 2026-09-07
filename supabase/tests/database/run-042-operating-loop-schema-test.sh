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

psql "$BOOKA_OPERATING_LOOP_TEST_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f "$(dirname "$0")/042_operating_loop_schema_test.sql"

bash "$(dirname "$0")/042_operating_loop_concurrency_test.sh"
