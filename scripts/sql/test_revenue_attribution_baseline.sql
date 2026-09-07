-- Minimal dependencies required to exercise migration 080 in disposable PostgreSQL.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select null::uuid $$;

create table if not exists public.tenants (
  id uuid primary key
);

create table if not exists public.customers (
  id uuid primary key
);

create table if not exists public.reservations (
  id uuid primary key
);

create table if not exists public.tenant_users (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid,
  role text
);
