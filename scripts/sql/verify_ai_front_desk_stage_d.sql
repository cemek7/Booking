\echo '== recent ai_training_events =='
select
  created_at,
  channel,
  user_role,
  intent,
  backend_action,
  success,
  correction
from ai_training_events
where tenant_id = :'tenant_id'
order by created_at desc
limit 25;

\echo '== training daily summary =='
select
  event_date,
  channel,
  user_role,
  intent,
  total_events,
  success_count,
  failure_count,
  correction_count,
  backend_action_count
from ai_training_event_daily_summary_view
where tenant_id = :'tenant_id'
order by event_date desc, total_events desc
limit 50;

\echo '== capture health =='
select
  tenant_id,
  tenant_name,
  total_events,
  first_event_at,
  last_event_at,
  events_last_7d,
  successful_events,
  failed_events,
  missing_intent_events,
  missing_backend_action_events,
  corrected_events,
  success_rate_percent
from ai_training_capture_health_view
where tenant_id = :'tenant_id';

\echo '== failure review =='
select
  created_at,
  channel,
  user_role,
  intent,
  backend_action,
  success,
  correction,
  left(message, 120) as message_preview
from ai_training_failure_review_view
where tenant_id = :'tenant_id'
order by created_at desc
limit 25;
