-- Migration: FAQ knowledge graph and customer reviews
-- 030_faqs_and_reviews.sql

-- ── FAQs ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS faqs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_faqs_tenant_id ON faqs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_faqs_tenant_active ON faqs(tenant_id, is_active);

-- ── Customer reviews ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT CHECK (
    customer_email IS NULL
    OR customer_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
  ),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  is_published BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_published ON reviews(tenant_id, is_published);
-- Prevent duplicate reviews for the same reservation (NULL reservation_id is excluded
-- so anonymous reviews, which have no reservation, remain unrestricted).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_reviews_tenant_reservation
  ON reviews(tenant_id, reservation_id)
  WHERE reservation_id IS NOT NULL;
