-- Read-only verification for migration 159.
DO $verify$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'escalation_queue'
      AND column_info.column_name = 'retail_order_id'
      AND column_info.data_type = 'uuid'
  ) THEN
    missing := array_append(missing, 'column:escalation_queue.retail_order_id');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'escalation_queue'
      AND column_info.column_name = 'reason_code'
  ) THEN
    missing := array_append(missing, 'column:escalation_queue.reason_code');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'conversation_threads'
      AND column_info.column_name = 'human_handling_mode'
  ) THEN
    missing := array_append(missing, 'column:conversation_threads.human_handling_mode');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.retail_orders'::regclass
      AND constraint_info.conname = 'retail_orders_tenant_id_id_key'
      AND constraint_info.contype = 'u'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid) = 'UNIQUE (tenant_id, id)'
  ) THEN
    missing := array_append(missing, 'constraint:retail_orders_tenant_id_id_key');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.escalation_queue'::regclass
      AND constraint_info.conname = 'escalation_queue_retail_order_tenant_fkey'
      AND constraint_info.contype = 'f'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid)
        ILIKE '%FOREIGN KEY (tenant_id, retail_order_id)%REFERENCES retail_orders(tenant_id, id)%ON DELETE RESTRICT%'
  ) THEN
    missing := array_append(missing, 'constraint:escalation_queue_retail_order_tenant_fkey');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.escalation_queue'::regclass
      AND constraint_info.conname = 'escalation_queue_reason_code_check'
      AND constraint_info.contype = 'c'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid) ILIKE '%reason_code%retail_fulfillment%'
  ) THEN
    missing := array_append(missing, 'constraint:escalation_queue_reason_code_check');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = 'public.conversation_threads'::regclass
      AND constraint_info.conname = 'conversation_threads_human_handling_mode_check'
      AND constraint_info.contype = 'c'
      AND constraint_info.convalidated
      AND pg_catalog.pg_get_constraintdef(constraint_info.oid) ILIKE '%human_handling_mode%timed%until_released%'
  ) THEN
    missing := array_append(missing, 'constraint:conversation_threads_human_handling_mode_check');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes AS index_info
    WHERE index_info.schemaname = 'public'
      AND index_info.tablename = 'escalation_queue'
      AND index_info.indexname = 'uq_escalation_retail_fulfillment'
      AND index_info.indexdef ILIKE '%UNIQUE INDEX%'
      AND index_info.indexdef ILIKE '%retail_fulfillment%'
  ) THEN
    missing := array_append(missing, 'index:uq_escalation_retail_fulfillment');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation_info
    WHERE relation_info.oid = 'public.escalation_queue'::regclass
      AND relation_info.relrowsecurity
  ) THEN
    missing := array_append(missing, 'rls:escalation_queue');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation_info
    WHERE relation_info.oid = 'public.conversation_threads'::regclass
      AND relation_info.relrowsecurity
  ) THEN
    missing := array_append(missing, 'rls:conversation_threads');
  END IF;

  IF cardinality(missing) > 0 THEN
    RAISE EXCEPTION 'retail fulfilment handoff verification failed: %', array_to_string(missing, ', ');
  END IF;
END
$verify$;

SELECT 'retail_fulfillment_handoff_schema_ready' AS status;
