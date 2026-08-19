\if :{?tenant_id}
\else
\echo 'Usage: psql "$DATABASE_URL" -v tenant_id=<TENANT_UUID> -f scripts/sql/verify_ai_front_desk_stage_c.sql'
\quit 1
\endif

\echo Verifying customer_service_history_view
select tenant_id, customer_id, customer_name, service_id, service_name, booking_count, completed_count, estimated_revenue, last_completed_at
from customer_service_history_view
where tenant_id = :'tenant_id'
order by booking_count desc, estimated_revenue desc
limit 10;

\echo Verifying staff_customer_history_view
select tenant_id, staff_id, staff_name, customer_id, customer_name, booking_count, completed_count, last_completed_at
from staff_customer_history_view
where tenant_id = :'tenant_id'
order by booking_count desc, last_completed_at desc nulls last
limit 10;

\echo Verifying followup_candidates_view
select tenant_id, customer_id, customer_name, customer_phone, lifetime_bookings, favorite_service, favorite_staff, days_since_visit, risk_score, is_followup_candidate, candidate_reason
from followup_candidates_view
where tenant_id = :'tenant_id'
order by is_followup_candidate desc, days_since_visit desc nulls last
limit 20;

\echo Verifying tenant_revenue_view
select tenant_id, booking_date, service_name, staff_name, customer_name, booking_count, completed_count, estimated_revenue
from tenant_revenue_view
where tenant_id = :'tenant_id'
order by booking_date desc, estimated_revenue desc
limit 20;

