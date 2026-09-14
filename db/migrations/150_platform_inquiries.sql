-- Migration 150: inbound inquiries to Techclave itself
--
-- WHY THIS EXISTS
-- The Techclave homepage had no contact route at all. The only contact page in
-- the repo belonged to the capability showcase, nothing linked to it, and its
-- form was an explicit demonstrator that made no network request — so a visitor
-- who wanted to talk to us had no way to, and nothing anywhere recorded that
-- they tried.
--
-- This is NOT the `leads` table. That one is tenant_id NOT NULL: it holds a
-- tenant's customers. An inquiry to Techclave has no tenant, and putting it
-- under some placeholder tenant would leak it into that tenant's lead list.
--
-- `notified_at` is the column that matters operationally. A row written but
-- never announced is the same failure as no row at all, so it is stamped only
-- when a human was actually told, and the superadmin dashboard raises an alert
-- for anything still unstamped.

CREATE TABLE IF NOT EXISTS public.platform_inquiries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  email        TEXT NOT NULL,
  company      TEXT,
  phone        TEXT,
  -- Which product or topic the inquiry is about; free text, not an enum, so a
  -- new product does not need a migration before its form can mention it.
  interest     TEXT,
  message      TEXT NOT NULL,
  -- Where the submission came from, so a second entry point can be told apart
  -- from the homepage form without guessing.
  source       TEXT NOT NULL DEFAULT 'techclave_contact',

  -- Abuse controls. The IP is stored only as a salted hash: it is needed to
  -- rate-limit a flood and for nothing else, and a raw address is personal data
  -- we have no reason to keep.
  ip_hash      TEXT,
  user_agent   TEXT,

  -- Operations.
  notified_at  TIMESTAMPTZ,
  handled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Newest first is the only listing order anyone wants.
CREATE INDEX IF NOT EXISTS idx_platform_inquiries_created
  ON public.platform_inquiries (created_at DESC);

-- Drives the "nobody has been told" alert; stays tiny because rows leave it.
CREATE INDEX IF NOT EXISTS idx_platform_inquiries_unnotified
  ON public.platform_inquiries (created_at DESC)
  WHERE notified_at IS NULL;

-- Rate limiting counts recent submissions from one hash.
CREATE INDEX IF NOT EXISTS idx_platform_inquiries_ip_recent
  ON public.platform_inquiries (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

COMMENT ON TABLE public.platform_inquiries IS
  'Inbound inquiries to Techclave from the public contact form. Not tenant '
  'data: see public.leads for a tenant''s own customers.';
COMMENT ON COLUMN public.platform_inquiries.notified_at IS
  'When a human was actually told. NULL means the inquiry arrived and nobody '
  'has seen it; the superadmin dashboard alerts on that.';
COMMENT ON COLUMN public.platform_inquiries.ip_hash IS
  'Salted hash of the submitter IP, for rate limiting only. Never the raw address.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- The public writes here through a service-role route handler and must never be
-- able to read it back: these rows carry other people's names, emails and
-- business plans. RLS with no policy denies everything to anon and
-- authenticated, and service_role bypasses RLS. That is exactly the intent.
ALTER TABLE public.platform_inquiries ENABLE ROW LEVEL SECURITY;
