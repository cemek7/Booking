\echo 'Checking deliverability tables'
\dt message_templates
\dt tenant_messaging_stats
\dt whatsapp_number_quality

\echo 'Checking seeded shared templates'
SELECT tenant_id, message_type, template_name, language, status
FROM message_templates
WHERE tenant_id IS NULL
ORDER BY message_type, language;

\echo 'Checking shared number quality row'
SELECT phone_number_id, quality_rating, messaging_tier, limit_per_24h, account_status, updated_at
FROM whatsapp_number_quality
ORDER BY updated_at DESC
LIMIT 5;
