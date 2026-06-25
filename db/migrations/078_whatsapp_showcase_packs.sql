-- Migration 078: WhatsApp showcase packs
-- Lets tenants build a reusable media/portfolio pack that can be sent in chat
-- as a lightweight "artifact" experience: intro text + images/docs/videos.

CREATE TABLE IF NOT EXISTS public.whatsapp_showcase_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL DEFAULT '',
  template_kind TEXT NOT NULL DEFAULT 'custom'
    CHECK (template_kind IN ('custom', 'portfolio', 'price_list', 'catalog', 'before_after')),
  description TEXT,
  intro_message TEXT,
  trigger_phrases TEXT[] NOT NULL DEFAULT ARRAY['portfolio', 'show me your work', 'gallery'],
  fallback_cta TEXT NOT NULL DEFAULT 'Reply BOOK to get started.',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_showcase_pack_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES public.whatsapp_showcase_packs(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('image', 'document', 'video')),
  title TEXT NOT NULL,
  caption TEXT,
  media_url TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  file_name TEXT,
  file_size BIGINT NOT NULL DEFAULT 0,
  cta_label TEXT,
  cta_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_showcase_packs_tenant_active
  ON public.whatsapp_showcase_packs (tenant_id, active, sort_order, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_showcase_packs_tenant_slug
  ON public.whatsapp_showcase_packs (tenant_id, slug)
  WHERE slug <> '';

CREATE INDEX IF NOT EXISTS idx_whatsapp_showcase_pack_items_pack
  ON public.whatsapp_showcase_pack_items (pack_id, active, sort_order, created_at DESC);

ALTER TABLE public.whatsapp_showcase_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_showcase_pack_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_showcase_packs_select ON public.whatsapp_showcase_packs;
CREATE POLICY whatsapp_showcase_packs_select ON public.whatsapp_showcase_packs
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_showcase_packs_write ON public.whatsapp_showcase_packs;
CREATE POLICY whatsapp_showcase_packs_write ON public.whatsapp_showcase_packs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_showcase_pack_items_select ON public.whatsapp_showcase_pack_items;
CREATE POLICY whatsapp_showcase_pack_items_select ON public.whatsapp_showcase_pack_items
  FOR SELECT USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_users
      WHERE user_id = auth.uid() AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS whatsapp_showcase_pack_items_write ON public.whatsapp_showcase_pack_items;
CREATE POLICY whatsapp_showcase_pack_items_write ON public.whatsapp_showcase_pack_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
