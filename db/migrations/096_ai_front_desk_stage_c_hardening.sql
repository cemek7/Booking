-- AI Front Desk Stage C Hardening
-- Tightens follow-up candidate semantics to customers with a real completed visit history.

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
