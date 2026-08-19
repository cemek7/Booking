begin;

alter table if exists leads
  add column if not exists stage text,
  add column if not exists qualified_at timestamptz,
  add column if not exists last_contacted_at timestamptz;

create table if not exists ai_front_desk_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_type text not null,
  event_category text not null,
  channel text,
  actor_role text,
  actor_id text,
  customer_id uuid references customers(id) on delete set null,
  reservation_id uuid references reservations(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  staff_id uuid references tenant_users(id) on delete set null,
  campaign_run_id uuid references sias_campaign_runs(id) on delete set null,
  message_id text,
  correlation_id text,
  amount numeric(12,2),
  currency text,
  status_from text,
  status_to text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_front_desk_events_tenant_created
  on ai_front_desk_events (tenant_id, created_at desc);

create index if not exists idx_ai_front_desk_events_tenant_type_created
  on ai_front_desk_events (tenant_id, event_type, created_at desc);

create index if not exists idx_ai_front_desk_events_tenant_category_created
  on ai_front_desk_events (tenant_id, event_category, created_at desc);

create index if not exists idx_ai_front_desk_events_tenant_customer_created
  on ai_front_desk_events (tenant_id, customer_id, created_at desc)
  where customer_id is not null;

alter table ai_front_desk_events enable row level security;

drop policy if exists ai_front_desk_events_tenant_access on ai_front_desk_events;
create policy ai_front_desk_events_tenant_access on ai_front_desk_events
  for all using (
    tenant_id in (
      select tenant_id from tenant_users
      where user_id = auth.uid() and role in ('owner', 'manager', 'staff')
    )
  );

create or replace view ai_front_desk_funnel_daily_view as
select
  tenant_id,
  date(created_at at time zone 'utc') as event_date,
  count(*) filter (where event_type = 'inquiry_received') as inquiries,
  count(*) filter (where event_type in ('lead_created', 'lead_qualified')) as qualified_leads,
  count(*) filter (where event_type = 'quote_sent') as quotes_sent,
  count(*) filter (where event_type = 'booking_created') as bookings_created,
  count(*) filter (where event_type = 'payment_completed') as payments_completed,
  count(*) filter (where event_type in ('follow_up_scheduled', 'follow_up_sent', 'recovery_sent')) as recovery_touches
from ai_front_desk_events
group by tenant_id, date(created_at at time zone 'utc');

create or replace view ai_front_desk_offer_performance_view as
select
  tenant_id,
  event_type,
  date(created_at at time zone 'utc') as event_date,
  count(*) as event_count,
  sum(coalesce(amount, 0)) as amount_total
from ai_front_desk_events
where event_type in ('offer_sent', 'upsell_sent', 'cross_sell_sent', 'recommendation_sent', 'catalog_sent', 'showcase_sent')
group by tenant_id, event_type, date(created_at at time zone 'utc');

create or replace view ai_front_desk_followup_pipeline_view as
select
  tenant_id,
  date(created_at at time zone 'utc') as event_date,
  count(*) filter (where event_type = 'follow_up_scheduled') as followups_scheduled,
  count(*) filter (where event_type = 'follow_up_sent') as followups_sent,
  count(*) filter (where event_type = 'recovery_sent') as recovery_sent,
  count(*) filter (where event_type = 'handoff_requested') as handoffs_requested
from ai_front_desk_events
where event_type in ('follow_up_scheduled', 'follow_up_sent', 'recovery_sent', 'handoff_requested')
group by tenant_id, date(created_at at time zone 'utc');

create or replace view ai_front_desk_revenue_attribution_view as
select
  tenant_id,
  date(created_at at time zone 'utc') as event_date,
  count(*) filter (where event_type = 'booking_created') as bookings_created,
  count(*) filter (where event_type = 'payment_completed') as payments_completed,
  sum(case when event_type = 'booking_created' then coalesce(amount, 0) else 0 end) as booked_revenue,
  sum(case when event_type = 'payment_completed' then coalesce(amount, 0) else 0 end) as paid_revenue
from ai_front_desk_events
where event_type in ('booking_created', 'payment_completed')
group by tenant_id, date(created_at at time zone 'utc');

commit;
