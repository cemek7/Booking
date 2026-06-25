-- 071_waha_core_multi_tenant.sql
-- Allow WAHA Core deployments to reuse session name "default" across tenants
-- as long as each tenant points to a distinct WAHA endpoint.
-- Keep strict uniqueness for Evolution instance names.

ALTER TABLE public.whatsapp_configurations
  DROP CONSTRAINT IF EXISTS whatsapp_configurations_instance_name_key;

-- Keep a non-unique lookup index for instance_name queries.
DROP INDEX IF EXISTS public.idx_whatsapp_cfg_instance;
CREATE INDEX IF NOT EXISTS idx_whatsapp_cfg_instance
  ON public.whatsapp_configurations (instance_name);

-- Evolution keeps globally unique active instance names.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_cfg_evolution_instance_active
  ON public.whatsapp_configurations (instance_name)
  WHERE provider = 'evolution' AND active = true;

-- WAHA Core: one "default" session per WAHA endpoint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_cfg_waha_endpoint_session_active
  ON public.whatsapp_configurations (provider_base_url, instance_name)
  WHERE provider = 'waha' AND active = true;
