-- AI Front Desk Stage B Hardening
-- Adds denormalized customer labels to summaries and upgrades availability snapshots
-- to service-aware keys after the initial Stage B migrations have already been applied.

alter table customers
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists customer_name text,
  add column if not exists phone_number text,
  add column if not exists email text,
  add column if not exists source text,
  add column if not exists risk_score text;

update customers
set
  name = coalesce(name, customer_name),
  customer_name = coalesce(customer_name, name),
  phone = coalesce(phone, phone_number),
  phone_number = coalesce(phone_number, phone)
where
  name is distinct from coalesce(name, customer_name)
  or customer_name is distinct from coalesce(customer_name, name)
  or phone is distinct from coalesce(phone, phone_number)
  or phone_number is distinct from coalesce(phone_number, phone);

create or replace function sync_customer_compat_columns()
returns trigger
language plpgsql
as $$
begin
  new.name := coalesce(new.name, new.customer_name);
  new.customer_name := coalesce(new.customer_name, new.name);
  new.phone := coalesce(new.phone, new.phone_number);
  new.phone_number := coalesce(new.phone_number, new.phone);
  return new;
end;
$$;

drop trigger if exists trg_sync_customer_compat_columns on customers;

create trigger trg_sync_customer_compat_columns
before insert or update on customers
for each row
execute function sync_customer_compat_columns();

create temp table customer_dedup_map on commit drop as
with ranked as (
  select
    id,
    tenant_id,
    nullif(btrim(coalesce(phone, phone_number)), '') as phone_key,
    row_number() over (
      partition by tenant_id, nullif(btrim(coalesce(phone, phone_number)), '')
      order by
        case when nullif(btrim(coalesce(name, customer_name)), '') is not null then 0 else 1 end,
        created_at desc nulls last,
        id
    ) as rn,
    first_value(id) over (
      partition by tenant_id, nullif(btrim(coalesce(phone, phone_number)), '')
      order by
        case when nullif(btrim(coalesce(name, customer_name)), '') is not null then 0 else 1 end,
        created_at desc nulls last,
        id
    ) as survivor_id
  from customers
  where nullif(btrim(coalesce(phone, phone_number)), '') is not null
)
select
  id as duplicate_id,
  survivor_id,
  tenant_id,
  phone_key
from ranked
where rn > 1
  and id <> survivor_id;

update reservations r
set customer_id = m.survivor_id
from customer_dedup_map m
where r.customer_id = m.duplicate_id;

update chats c
set customer_id = m.survivor_id
from customer_dedup_map m
where c.customer_id = m.duplicate_id;

update reviews r
set customer_id = m.survivor_id
from customer_dedup_map m
where r.customer_id = m.duplicate_id;

update analytics_events e
set customer_id = m.survivor_id
from customer_dedup_map m
where e.customer_id = m.duplicate_id;

update reservation_services rs
set customer_id = m.survivor_id
from customer_dedup_map m
where rs.customer_id = m.duplicate_id;

update customer_analytics ca
set customer_id = m.survivor_id
from customer_dedup_map m
where ca.customer_id = m.duplicate_id;

update sias_outcome_attributions soa
set customer_id = m.survivor_id
from customer_dedup_map m
where soa.customer_id = m.duplicate_id;

update sias_campaign_runs scr
set target_customer_id = m.survivor_id
from customer_dedup_map m
where scr.target_customer_id = m.duplicate_id;

delete from customer_profile_summary cps
using customer_dedup_map m
where cps.customer_id = m.duplicate_id;

delete from customers c
using customer_dedup_map m
where c.id = m.duplicate_id;

create unique index if not exists customers_tenant_phone_key
  on customers (tenant_id, phone);

create unique index if not exists customers_tenant_phone_number_key
  on customers (tenant_id, phone_number);

create index if not exists customers_tenant_email_idx
  on customers (tenant_id, email);

alter table services
  add column if not exists price_cents integer,
  add column if not exists duration_minutes integer,
  add column if not exists is_active boolean default true;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'price'
  ) then
    execute '
      update services
      set price_cents = coalesce(price_cents, round(coalesce(price, 0) * 100)::integer)
      where price_cents is null
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'duration'
  ) then
    execute '
      update services
      set duration_minutes = coalesce(duration_minutes, duration)
      where duration_minutes is null
    ';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'services'
      and column_name = 'active'
  ) then
    execute '
      update services
      set is_active = coalesce(is_active, active)
      where is_active is null
    ';
  end if;
end $$;

update services
set
  price_cents = coalesce(price_cents, 0),
  duration_minutes = coalesce(duration_minutes, 60),
  is_active = coalesce(is_active, true)
where
  price_cents is null
  or duration_minutes is null
  or is_active is null;

alter table customer_profile_summary
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

alter table availability_snapshot
  add column if not exists service_id uuid;

-- availability_snapshot is a derived table populated by the nightly job.
-- Clearing old rows is safe and avoids carrying forward non-service-aware snapshots.
delete from availability_snapshot
where service_id is null;

do $$
declare
  existing_pk text;
begin
  select conname
    into existing_pk
  from pg_constraint
  where conrelid = 'availability_snapshot'::regclass
    and contype = 'p';

  if existing_pk is not null then
    execute format('alter table availability_snapshot drop constraint %I', existing_pk);
  end if;
end $$;

alter table availability_snapshot
  alter column service_id set not null;

alter table availability_snapshot
  add constraint availability_snapshot_pkey
  primary key (tenant_id, staff_id, service_id, date);

drop index if exists availability_snapshot_tenant_date_idx;
create index if not exists availability_snapshot_tenant_date_idx
  on availability_snapshot (tenant_id, date, staff_id, service_id);
