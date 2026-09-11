-- Migration 147: dated cost basis for WhatsApp messages
--
-- WHY THIS EXISTS
-- The per-message cost lived in an env var holding a NAIRA figure (NGN 14).
-- That number is really two things multiplied together — Meta's USD price and
-- the naira exchange rate — and collapsing them hid both:
--
--   * Meta may change prices only on the 1st of a quarter, with a month's
--     notice. A naira env var cannot hold "this takes effect on Jan 1", so the
--     change had to be remembered and applied by hand on the day. The comment
--     in messageRates.ts telling someone to update the rate on 2026-09-01 was
--     a week stale before anyone noticed.
--   * The naira moves on no schedule at all. A slide from 1340 to 1600 raises
--     Booka's real cost 19% with no announcement to read and nothing to update.
--
-- Storing the USD price and the FX rate separately, both dated, means a Meta
-- change is one row you can enter the day it is announced, and an FX move is
-- one row. Historic charges reconcile against the rate that was actually in
-- force rather than whatever the env var says today.

CREATE TABLE IF NOT EXISTS public.message_rate_card (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Meta's pricing categories. 'service' is a free-form reply inside the
  -- 24-hour window; the rest are template categories.
  category        TEXT NOT NULL
                    CHECK (category IN ('service', 'utility', 'marketing', 'authentication')),
  -- Meta bills in USD. This is the ONLY place the real price lives.
  cost_usd        NUMERIC(12,6) NOT NULL CHECK (cost_usd >= 0),
  -- Meta changes prices on the 1st of a quarter and announces a month ahead,
  -- so a future-dated row can be entered the day it is announced.
  effective_from  DATE NOT NULL,
  country_code    TEXT NOT NULL DEFAULT 'NG',
  source          TEXT,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One price per category per country per start date; re-running the seed below
-- must not create duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_rate_card_effective
  ON public.message_rate_card (country_code, category, effective_from);

CREATE INDEX IF NOT EXISTS idx_message_rate_card_lookup
  ON public.message_rate_card (country_code, category, effective_from DESC);

COMMENT ON TABLE public.message_rate_card IS
  'What Meta charges per delivered message, in USD, by category and start date. '
  'Credits are derived from this and platform_fx_rates, never stored directly.';

-- ── FX ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_fx_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base        TEXT NOT NULL DEFAULT 'USD',
  quote       TEXT NOT NULL DEFAULT 'NGN',
  rate        NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  as_of       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_fx_rates_lookup
  ON public.platform_fx_rates (base, quote, as_of DESC);

COMMENT ON TABLE public.platform_fx_rates IS
  'Quote currency per unit of base. Appended, never updated in place, so a '
  'charge can be reconciled against the rate that was in force when it settled. '
  'The send path reads the newest row; it never calls an FX API.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Platform cost basis, not tenant data. Service role only, both tables.
ALTER TABLE public.message_rate_card ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_fx_rates ENABLE ROW LEVEL SECURITY;
-- No policies: RLS with no policy denies everything to anon/authenticated,
-- and service_role bypasses RLS. That is exactly the intent.

-- ── Seed ─────────────────────────────────────────────────────────────────────
-- Meta's published Nigerian rates for the 2026-10-01 per-message change.
-- ON CONFLICT DO NOTHING so re-running never overwrites a corrected figure.
INSERT INTO public.message_rate_card (category, cost_usd, effective_from, country_code, source, note)
VALUES
  ('service',        0.010100, DATE '2026-10-01', 'NG', 'meta_published_2026-09', 'Per-message pricing begins 2026-10-01'),
  ('utility',        0.010100, DATE '2026-10-01', 'NG', 'meta_published_2026-09', NULL),
  ('authentication', 0.010100, DATE '2026-10-01', 'NG', 'meta_published_2026-09', NULL),
  ('marketing',      0.062000, DATE '2026-10-01', 'NG', 'meta_published_2026-09', 'Roughly 6x the service rate')
ON CONFLICT (country_code, category, effective_from) DO NOTHING;

-- Seed FX only if the table is empty, so a later real reading is never
-- displaced by re-running the migration.
INSERT INTO public.platform_fx_rates (base, quote, rate, as_of, source)
SELECT 'USD', 'NGN', 1321.225569, now(), 'open.er-api.com seed'
WHERE NOT EXISTS (SELECT 1 FROM public.platform_fx_rates WHERE base = 'USD' AND quote = 'NGN');
