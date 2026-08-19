create index if not exists idx_ai_training_events_tenant_created_at
  on ai_training_events (tenant_id, created_at desc);

create index if not exists idx_ai_training_events_tenant_intent_created_at
  on ai_training_events (tenant_id, intent, created_at desc);

create index if not exists idx_ai_training_events_tenant_success_created_at
  on ai_training_events (tenant_id, success, created_at desc);

create or replace view ai_training_event_daily_summary_view as
select
  tenant_id,
  date_trunc('day', created_at)::date as event_date,
  coalesce(channel, 'unknown') as channel,
  coalesce(user_role, 'unknown') as user_role,
  coalesce(intent, 'unknown') as intent,
  count(*)::int as total_events,
  count(*) filter (where success is true)::int as success_count,
  count(*) filter (where success is false)::int as failure_count,
  count(*) filter (where correction is not null and btrim(correction) <> '')::int as correction_count,
  count(*) filter (where backend_action is not null and btrim(backend_action) <> '')::int as backend_action_count
from ai_training_events
group by 1, 2, 3, 4, 5;

create or replace view ai_training_capture_health_view as
select
  e.tenant_id,
  t.name as tenant_name,
  count(*)::int as total_events,
  min(e.created_at) as first_event_at,
  max(e.created_at) as last_event_at,
  count(*) filter (where e.created_at >= now() - interval '7 days')::int as events_last_7d,
  count(*) filter (where e.success is true)::int as successful_events,
  count(*) filter (where e.success is false)::int as failed_events,
  count(*) filter (where e.intent is null or btrim(e.intent) = '')::int as missing_intent_events,
  count(*) filter (where e.backend_action is null or btrim(e.backend_action) = '')::int as missing_backend_action_events,
  count(*) filter (where e.correction is not null and btrim(e.correction) <> '')::int as corrected_events,
  case
    when count(*) = 0 then 0::numeric
    else round((count(*) filter (where e.success is true)::numeric / count(*)::numeric) * 100, 2)
  end as success_rate_percent
from ai_training_events e
left join tenants t on t.id = e.tenant_id
group by e.tenant_id, t.name;

create or replace view ai_training_failure_review_view as
select
  id,
  tenant_id,
  created_at,
  channel,
  user_role,
  intent,
  backend_action,
  success,
  correction,
  message,
  grounded_context,
  llm_response
from ai_training_events
where success is false
   or (correction is not null and btrim(correction) <> '')
   or intent is null
   or backend_action is null;
