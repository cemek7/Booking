#!/usr/bin/env bash
#
# db-launch-reconcile.sh — bring a Boka database up to the launch schema shape.
#
# Idempotent: every migration below is CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS,
# so re-running only fills what is absent. Run once per environment (dev / staging / prod).
#
# ⚠️ DELIBERATELY EXCLUDES db/migrations/114_products_catalog.sql — that is the OLD *relational*
# product catalog (products.category_id FK -> product_categories). The project uses the FLAT model:
#   116_flat_product_categories  — flat category reconcile
#   117_products_catalog_flat     — products(category TEXT, price_cents, stock_quantity)
#                                    + product_variants + inventory_movements + update_inventory RPC
# Running 114 against the flat schema errors with `column "category_id" does not exist` on its index
# and leaves an orphan (unused) product_categories table. So it is skipped here on purpose.
#
# Usage:
#   export DATABASE_URL='postgresql://postgres:PASS@db.REF.supabase.co:5432/postgres'  # DIRECT (5432)
#   scripts/db-launch-reconcile.sh
#
# Verify afterwards:
#   psql "$DATABASE_URL" -f db/schema/verify_launch_tables.sql

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: set DATABASE_URL first (DIRECT connection, port 5432 — not the 6543 pooler)." >&2
  exit 1
fi

MIGRATIONS=(
  090_email_unsubscribes
  111_messaging_consents
  116_flat_product_categories
  117_products_catalog_flat
  119_social_listening
  120_retail_orders
)

echo "==> Reconciling launch schema (flat products model; 114 intentionally skipped)"
for m in "${MIGRATIONS[@]}"; do
  f="db/migrations/${m}.sql"
  [[ -f "$f" ]] || { echo "ERROR: missing $f" >&2; exit 1; }
  echo "--> applying $f"
  # ON_ERROR_STOP=0 tolerates already-applied idempotent statements on a partial DB.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$f"
done

echo "==> Done. Verify with: psql \"\$DATABASE_URL\" -f db/schema/verify_launch_tables.sql"
