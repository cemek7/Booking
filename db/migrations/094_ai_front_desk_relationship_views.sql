-- AI Front Desk Relationship Intelligence Views
-- Stage C: preference, loyalty, follow-up, and revenue views on PostgreSQL

create or replace view customer_service_history_view as
select
  r.tenant_id,
  r.customer_id,
  coalesce(c.name, c.customer_name) as customer_name,
  coalesce(c.phone, c.phone_number) as customer_phone,
  r.service_id,
  s.name as service_name,
  count(*)::int as booking_count,
  count(*) filter (where r.status = 'completed')::int as completed_count,
  count(*) filter (where r.status = 'cancelled')::int as cancelled_count,
  count(*) filter (where r.status = 'no_show')::int as no_show_count,
  max(r.start_at) as last_booking_at,
  max(r.start_at) filter (where r.status = 'completed') as last_completed_at,
  coalesce(sum(
    case when r.status = 'completed'
      then coalesce(s.price, 0)
      else 0
    end
  ), 0)::numeric(12,2) as estimated_revenue
from reservations r
left join customers c
  on c.id = r.customer_id
 and c.tenant_id = r.tenant_id
left join services s
  on s.id = r.service_id
 and s.tenant_id = r.tenant_id
where r.customer_id is not null
group by
  r.tenant_id,
  r.customer_id,
  coalesce(c.name, c.customer_name),
  coalesce(c.phone, c.phone_number),
  r.service_id,
  s.name;

create or replace view staff_customer_history_view as
select
  r.tenant_id,
  coalesce(r.tenant_staff_id, tu.id, r.staff_id) as staff_id,
  coalesce(tu.name, tu.phone, coalesce(r.tenant_staff_id, r.staff_id)::text) as staff_name,
  r.customer_id,
  coalesce(c.name, c.customer_name) as customer_name,
  coalesce(c.phone, c.phone_number) as customer_phone,
  count(*)::int as booking_count,
  count(*) filter (where r.status = 'completed')::int as completed_count,
  count(*) filter (where r.status = 'cancelled')::int as cancelled_count,
  count(*) filter (where r.status = 'no_show')::int as no_show_count,
  max(r.start_at) as last_booking_at,
  max(r.start_at) filter (where r.status = 'completed') as last_completed_at
from reservations r
left join customers c
  on c.id = r.customer_id
 and c.tenant_id = r.tenant_id
left join tenant_users tu
  on (
    tu.id = r.tenant_staff_id
    or (r.tenant_staff_id is null and tu.user_id = r.staff_id)
  )
 and tu.tenant_id = r.tenant_id
where r.customer_id is not null
  and coalesce(r.tenant_staff_id, r.staff_id) is not null
group by
  r.tenant_id,
  coalesce(r.tenant_staff_id, tu.id, r.staff_id),
  coalesce(tu.name, tu.phone, coalesce(r.tenant_staff_id, r.staff_id)::text),
  r.customer_id,
  coalesce(c.name, c.customer_name),
  coalesce(c.phone, c.phone_number);

create or replace view followup_candidates_view as
with customer_future_bookings as (
  select
    tenant_id,
    customer_id,
    min(start_at) as next_booking_at
  from reservations
  where customer_id is not null
    and status not in ('cancelled', 'no_show')
    and start_at > now()
  group by tenant_id, customer_id
)
select
  cps.tenant_id,
  cps.customer_id,
  coalesce(c.name, c.customer_name) as customer_name,
  coalesce(c.phone, c.phone_number) as customer_phone,
  cps.lifetime_bookings,
  cps.last_visit,
  cps.favorite_service,
  cps.favorite_staff,
  cps.days_since_visit,
  cps.risk_score,
  cfb.next_booking_at,
  case
    when cfb.next_booking_at is not null then false
    when cps.last_visit is null then false
    when cps.days_since_visit is null then false
    when cps.days_since_visit >= 90 then true
    when cps.days_since_visit >= 45 and cps.risk_score in ('medium', 'high') then true
    else false
  end as is_followup_candidate,
  case
    when cfb.next_booking_at is not null then 'has_future_booking'
    when cps.last_visit is null then 'no_completed_visit'
    when cps.days_since_visit >= 90 then 'inactive_90_plus_days'
    when cps.days_since_visit >= 45 and cps.risk_score in ('medium', 'high') then 'at_risk_lapsed'
    else 'not_due'
  end as candidate_reason
from customer_profile_summary cps
left join customers c
  on c.id = cps.customer_id
 and c.tenant_id = cps.tenant_id
left join customer_future_bookings cfb
  on cfb.customer_id = cps.customer_id
 and cfb.tenant_id = cps.tenant_id
where cps.last_visit is not null;

create or replace view tenant_revenue_view as
select
  r.tenant_id,
  date_trunc('day', r.start_at)::date as booking_date,
  r.service_id,
  s.name as service_name,
  coalesce(r.tenant_staff_id, tu.id, r.staff_id) as staff_id,
  coalesce(tu.name, tu.phone, coalesce(r.tenant_staff_id, r.staff_id)::text) as staff_name,
  r.customer_id,
  coalesce(c.name, c.customer_name) as customer_name,
  coalesce(c.phone, c.phone_number) as customer_phone,
  count(*)::int as booking_count,
  count(*) filter (where r.status = 'completed')::int as completed_count,
  count(*) filter (where r.status = 'cancelled')::int as cancelled_count,
  count(*) filter (where r.status = 'no_show')::int as no_show_count,
  coalesce(sum(
    case when r.status = 'completed'
      then coalesce(s.price, 0)
      else 0
    end
  ), 0)::numeric(12,2) as estimated_revenue
from reservations r
left join services s
  on s.id = r.service_id
 and s.tenant_id = r.tenant_id
left join customers c
  on c.id = r.customer_id
 and c.tenant_id = r.tenant_id
left join tenant_users tu
  on (
    tu.id = r.tenant_staff_id
    or (r.tenant_staff_id is null and tu.user_id = r.staff_id)
  )
 and tu.tenant_id = r.tenant_id
group by
  r.tenant_id,
  date_trunc('day', r.start_at)::date,
  r.service_id,
  s.name,
  coalesce(r.tenant_staff_id, tu.id, r.staff_id),
  coalesce(tu.name, tu.phone, coalesce(r.tenant_staff_id, r.staff_id)::text),
  r.customer_id,
  coalesce(c.name, c.customer_name),
  coalesce(c.phone, c.phone_number);
