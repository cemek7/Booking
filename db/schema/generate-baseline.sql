-- generate-baseline.sql
--
-- Run this IN THE SUPABASE SQL EDITOR to reconstruct the full public-schema DDL
-- from the system catalogs (no pg_dump / CLI needed). Solves audit C2: gives a
-- version-controlled, reproducible baseline of the live schema.
--
-- HOW TO USE:
--   1. Paste this whole query into the Supabase SQL editor and Run.
--   2. The result is ONE row, ONE column `schema_sql`. Click the cell to expand,
--      then Copy.
--   3. Paste into  db/schema/baseline_<date>.sql  and commit.
--   4. Verify it applies to a throwaway DB before trusting it (see the runbook).
--
-- Emits, in dependency-safe order: CREATE TABLE (all public tables) -> ADD CONSTRAINT
-- (PK/unique/check, then FK) -> CREATE INDEX -> CREATE VIEW -> CREATE FUNCTION.
-- public schema ONLY (never Supabase-managed auth/storage/extensions).

with
tables as (
  select
    'CREATE TABLE IF NOT EXISTS ' || quote_ident(n.nspname) || '.' || quote_ident(c.relname) || E' (\n' ||
    string_agg(
      '  ' || quote_ident(a.attname) || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
        || case when a.attnotnull then ' NOT NULL' else '' end
        || case when ad.adbin is not null then ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) else '' end,
      E',\n' order by a.attnum
    ) || E'\n);' as ddl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
  where n.nspname = 'public' and c.relkind = 'r'
  group by n.nspname, c.relname
),
constraints as (
  select
    'ALTER TABLE ' || quote_ident(n.nspname) || '.' || quote_ident(rel.relname)
      || ' ADD CONSTRAINT ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid) || ';' as ddl,
    case con.contype when 'p' then 1 when 'u' then 2 when 'c' then 3 else 4 end as ord  -- FKs last
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public'
),
indexes as (
  -- CREATE INDEX for indexes NOT already created by a PK/unique constraint above.
  select replace(replace(indexdef, 'CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '),
                 'CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ') || ';' as ddl
  from pg_indexes
  where schemaname = 'public'
    and indexname not in (select conname from pg_constraint where contype in ('p', 'u'))
),
views as (
  select
    'CREATE OR REPLACE VIEW ' || quote_ident(schemaname) || '.' || quote_ident(viewname) || ' AS '
      || pg_get_viewdef((quote_ident(schemaname) || '.' || quote_ident(viewname))::regclass, true) as ddl
  from pg_views
  where schemaname = 'public'
),
functions as (
  select pg_get_functiondef(p.oid) || ';' as ddl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
)
select string_agg(ddl, E'\n\n' order by sect, ord) as schema_sql
from (
  select ddl, 1 as sect, 0   as ord from tables
  union all select ddl, 2, ord from constraints
  union all select ddl, 3, 0 from indexes
  union all select ddl, 4, 0 from views
  union all select ddl, 5, 0 from functions
) all_ddl;
