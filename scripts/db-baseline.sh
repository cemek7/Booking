#!/usr/bin/env bash
#
# db-baseline.sh — capture the LIVE public schema as a reproducible baseline snapshot.
# No Supabase CLI required. Uses plain pg_dump (local or dockerized).
#
# Solves launch-readiness audit C2: db/migrations/ is not the schema source of truth
# (~45 live tables have no migration), so a fresh environment built from migrations is
# broken. This dumps the complete current public schema to db/schema/baseline_<date>.sql.
#
# Public schema ONLY — never dumps Supabase-managed auth/storage/extensions schemas.
#
# ── Setup ────────────────────────────────────────────────────────────────────────
# Get the DIRECT connection string from:
#   Supabase Dashboard -> Project Settings -> Database -> Connection string
#   Use the DIRECT connection (host db.<REF>.supabase.co, port 5432) — NOT the 6543 pooler.
#   Find the server's Postgres major version there too (Settings -> Infrastructure).
#
# ── Usage ────────────────────────────────────────────────────────────────────────
#   export DATABASE_URL='postgresql://postgres:PASS@db.REF.supabase.co:5432/postgres'
#
#   # A) local pg_dump (works if your pg_dump major >= the server's major):
#   scripts/db-baseline.sh
#
#   # B) version-proof, dockerized pg_dump (no local install/CLI needed) — set the
#   #    server's Postgres major version so the client matches:
#   PG_MAJOR=17 scripts/db-baseline.sh
#
# If (A) fails with "server version mismatch: server X, pg_dump Y", use (B) with PG_MAJOR=X.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: set DATABASE_URL first (see the header of this script)." >&2
  exit 1
fi

DATE="$(date +%Y-%m-%d)"
OUT="db/schema/baseline_${DATE}.sql"
mkdir -p db/schema

PGDUMP_ARGS=(
  --schema=public
  --schema-only
  --no-owner
  --no-privileges
  --no-comments
  --quote-all-identifiers
)

echo "==> Writing baseline to ${OUT}"

if [[ -n "${PG_MAJOR:-}" ]]; then
  echo "==> Dockerized pg_dump (postgres:${PG_MAJOR}) — version-proof, no local tooling"
  docker run --rm -i "postgres:${PG_MAJOR}" \
    pg_dump "${DATABASE_URL}" "${PGDUMP_ARGS[@]}" > "${OUT}"
else
  echo "==> Local pg_dump ($(pg_dump --version 2>/dev/null | awk '{print $3}'))"
  echo "    If this errors with a server-version mismatch, re-run with PG_MAJOR=<server major>."
  pg_dump "${DATABASE_URL}" "${PGDUMP_ARGS[@]}" -f "${OUT}"
fi

# Make re-apply safe: bare CREATE TABLE -> CREATE TABLE IF NOT EXISTS.
sed -i -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' "${OUT}" 2>/dev/null \
  || sed -i '' -E 's/^CREATE TABLE "/CREATE TABLE IF NOT EXISTS "/' "${OUT}"

LINES=$(wc -l < "${OUT}")
TABLES=$(grep -cE '^CREATE TABLE' "${OUT}" || true)
echo "==> Done: ${OUT} (${LINES} lines, ${TABLES} tables)"
echo "==> VERIFY before trusting it — apply to a throwaway DB:"
echo "      docker run -d --name pg_verify -e POSTGRES_PASSWORD=x -p 55432:5432 postgres:\${PG_MAJOR:-16}"
echo "      psql 'postgresql://postgres:x@localhost:55432/postgres' -v ON_ERROR_STOP=1 -f ${OUT}"
echo "      docker rm -f pg_verify"
