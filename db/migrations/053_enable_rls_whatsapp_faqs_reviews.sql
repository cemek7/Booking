-- Migration 053: Enable RLS on WhatsApp operational tables, faqs, and reviews
--
-- Tables:
--   whatsapp_connection_logs     — diagnostic logs, owner/manager read, service_role writes
--   whatsapp_connection_metrics  — operational metrics, owner/manager read, service_role writes
--   whatsapp_message_queue       — internal job queue, service_role only
--   faqs                         — public-facing content, anon read (active only), owner/manager write
--   reviews                      — public-facing, anon read (published), customer insert, owner/manager moderate

-- ─────────────────────────────────────────────────────────────
-- 1. whatsapp_connection_logs  (owner/manager read; service_role writes)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_connection_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_logs_select ON public.whatsapp_connection_logs;
CREATE POLICY whatsapp_connection_logs_select ON public.whatsapp_connection_logs
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_connection_logs_service_role ON public.whatsapp_connection_logs;
CREATE POLICY whatsapp_connection_logs_service_role ON public.whatsapp_connection_logs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2. whatsapp_connection_metrics  (owner/manager read; service_role writes)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_connection_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connection_metrics_select ON public.whatsapp_connection_metrics;
CREATE POLICY whatsapp_connection_metrics_select ON public.whatsapp_connection_metrics
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_connection_metrics_service_role ON public.whatsapp_connection_metrics;
CREATE POLICY whatsapp_connection_metrics_service_role ON public.whatsapp_connection_metrics
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 3. whatsapp_message_queue  (internal job queue — service_role only)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.whatsapp_message_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_message_queue_service_role ON public.whatsapp_message_queue;
CREATE POLICY whatsapp_message_queue_service_role ON public.whatsapp_message_queue
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4. faqs  (anon read active FAQs for public booking pages; owner/manager write)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

-- Public (anon) can read active FAQs — needed for /book/[slug] page
DROP POLICY IF EXISTS faqs_public_select ON public.faqs;
CREATE POLICY faqs_public_select ON public.faqs
  FOR SELECT USING (is_active = true);

-- Owners/managers can read ALL faqs (including inactive) in their tenant
DROP POLICY IF EXISTS faqs_manager_select ON public.faqs;
CREATE POLICY faqs_manager_select ON public.faqs
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Only owners/managers can create, update, delete FAQs
DROP POLICY IF EXISTS faqs_write ON public.faqs;
CREATE POLICY faqs_write ON public.faqs
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  ) WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS faqs_service_role ON public.faqs;
CREATE POLICY faqs_service_role ON public.faqs
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 5. reviews  (anon read published; customers insert; owners/managers moderate)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Public (anon) can read published reviews — shown on business/booking pages
DROP POLICY IF EXISTS reviews_public_select ON public.reviews;
CREATE POLICY reviews_public_select ON public.reviews
  FOR SELECT USING (status = 'published');

-- Tenant members (owners/managers/staff) can read all reviews including pending/hidden
DROP POLICY IF EXISTS reviews_tenant_select ON public.reviews;
CREATE POLICY reviews_tenant_select ON public.reviews
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid())
  );

-- Authenticated customers can insert a review for their own reservation
DROP POLICY IF EXISTS reviews_customer_insert ON public.reviews;
CREATE POLICY reviews_customer_insert ON public.reviews
  FOR INSERT WITH CHECK (
    customer_id = auth.uid()
  );

-- Owners/managers can update (moderate: respond, hide, flag, publish)
DROP POLICY IF EXISTS reviews_manager_update ON public.reviews;
CREATE POLICY reviews_manager_update ON public.reviews
  FOR UPDATE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

-- Owners/managers can delete reviews
DROP POLICY IF EXISTS reviews_manager_delete ON public.reviews;
CREATE POLICY reviews_manager_delete ON public.reviews
  FOR DELETE USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS reviews_service_role ON public.reviews;
CREATE POLICY reviews_service_role ON public.reviews
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
