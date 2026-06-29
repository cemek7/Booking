\echo '== structural checks =='
select to_regclass('public.ai_front_desk_events') as ai_front_desk_events;
select to_regclass('public.ai_front_desk_funnel_daily_view') as ai_front_desk_funnel_daily_view;
select to_regclass('public.ai_front_desk_offer_performance_view') as ai_front_desk_offer_performance_view;
select to_regclass('public.ai_front_desk_followup_pipeline_view') as ai_front_desk_followup_pipeline_view;
select to_regclass('public.ai_front_desk_revenue_attribution_view') as ai_front_desk_revenue_attribution_view;

\echo '== ai_front_desk_events columns =='
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ai_front_desk_events'
order by ordinal_position;

\echo '== recent ai_front_desk_events =='
select tenant_id, event_type, event_category, channel, actor_role, amount, currency, created_at
from ai_front_desk_events
where tenant_id = :'tenant_id'
order by created_at desc
limit 25;

\echo '== funnel view =='
select *
from ai_front_desk_funnel_daily_view
where tenant_id = :'tenant_id'
order by event_date desc
limit 14;

\echo '== offer performance view =='
select *
from ai_front_desk_offer_performance_view
where tenant_id = :'tenant_id'
order by event_date desc, event_type asc
limit 20;

\echo '== follow-up pipeline view =='
select *
from ai_front_desk_followup_pipeline_view
where tenant_id = :'tenant_id'
order by event_date desc
limit 14;

\echo '== revenue attribution view =='
select *
from ai_front_desk_revenue_attribution_view
where tenant_id = :'tenant_id'
order by event_date desc
limit 14;
