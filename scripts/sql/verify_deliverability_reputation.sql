-- Deliverability verification script that works in plain SQL runners
-- including Supabase SQL editor and psql.

SELECT
  table_schema,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'message_templates',
    'tenant_messaging_stats',
    'whatsapp_number_quality'
  )
ORDER BY table_name;

SELECT
  tenant_id,
  message_type,
  template_name,
  language,
  status
FROM message_templates
WHERE tenant_id IS NULL
ORDER BY message_type, language;

SELECT
  phone_number_id,
  quality_rating,
  messaging_tier,
  limit_per_24h,
  account_status,
  updated_at
FROM whatsapp_number_quality
ORDER BY updated_at DESC
LIMIT 5;
