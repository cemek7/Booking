\if :{?tenant_id}
\else
\echo 'Usage: psql "$DATABASE_URL" -v tenant_id=<TENANT_UUID> -f scripts/sql/verify_ai_front_desk_stage_b.sql'
\quit 1
\endif

\echo Verifying tenant_daily_summary
select *
from tenant_daily_summary
where tenant_id = :'tenant_id'
order by date desc
limit 7;

\echo Verifying customer_profile_summary
select customer_id, customer_name, customer_phone, lifetime_bookings, last_visit, favorite_service, favorite_staff, days_since_visit, risk_score
from customer_profile_summary
where tenant_id = :'tenant_id'
order by lifetime_bookings desc, last_visit desc nulls last
limit 10;

\echo Verifying service_performance_summary
select service_id, bookings, revenue, cancellations, completion_rate
from service_performance_summary
where tenant_id = :'tenant_id'
order by bookings desc, revenue desc
limit 10;

\echo Verifying staff_performance_summary
select staff_id, bookings, completion_rate, estimated_revenue
from staff_performance_summary
where tenant_id = :'tenant_id'
order by bookings desc, estimated_revenue desc
limit 10;

\echo Verifying availability_snapshot
select staff_id, service_id, date, available_slots
from availability_snapshot
where tenant_id = :'tenant_id'
order by date asc, staff_id asc, service_id asc
limit 20;

\echo Verifying ai_training_events
select created_at, channel, user_role, intent, backend_action, success, correction
from ai_training_events
where tenant_id = :'tenant_id'
order by created_at desc
limit 20;
