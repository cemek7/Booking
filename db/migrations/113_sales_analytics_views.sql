-- 113_sales_analytics_views.sql
--
-- Creates the four read-only analytics VIEWS the AI Front Desk's sales/follow-up/
-- owner-BI grounding queries (src/lib/ai/grounding-service.ts) but which no migration
-- ever created:
--   customer_service_history_view, staff_customer_history_view,
--   tenant_revenue_view, followup_candidates_view
--
-- These power the conversational-BI + lead-recovery features ("which customers book
-- which service", "who's lapsed / at risk", "revenue by service"). Until now the
-- grounding queries fail-quiet (ignore error -> empty array), so those signals
-- silently returned nothing.
--
-- SCHEMA-SOURCE NOTE: `services` and `tenant_users` are NOT created by any file in
-- db/migrations/ -- they live only in the Supabase DB. These views are reconstructed
-- from the columns the application code demonstrably reads in production
-- (services.name/price; tenant_users.id/name; customers.id/tenant_id/name/phone/
-- last_visit/total_bookings/no_show_count from migration 067; reservations
-- .customer_id/.service_id/.tenant_staff_id/.start_at/.status). Validate against the
-- live schema before applying. risk_score / is_followup_candidate / candidate_reason
-- have no source column -- they are derived here.
--
-- tenant_id is sourced from customers (UUID) via the reservations.customer_id FK,
-- deliberately sidestepping the legacy reservations.tenant_id (TEXT, migration 0001).
-- The grounding filters every view with .eq('tenant_id', <uuid>).
--
-- Manual fallback: each statement is CREATE OR REPLACE VIEW and safe to run by hand.

BEGIN;

-- A "visit"/realized booking excludes cancellations, no-shows and refunds.
-- (Status is unconstrained TEXT; 'confirmed' dominates, 'completed' is rare -- so a
--  realized visit is a non-cancelled PAST reservation, NOT status='completed'.)

-- ---------------------------------------------------------------------------
-- 1. customer_service_history_view  (grain: customer x service)
--    Cols consumed: customer_id, customer_name, customer_phone, service_id,
--    service_name, booking_count, completed_count, estimated_revenue,
--    last_completed_at  (+ tenant_id for the filter)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW customer_service_history_view AS
SELECT
  c.tenant_id                                                       AS tenant_id,
  r.customer_id                                                     AS customer_id,
  c.name                                                            AS customer_name,
  c.phone                                                           AS customer_phone,
  r.service_id                                                      AS service_id,
  s.name                                                            AS service_name,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
  )                                                                 AS booking_count,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  )                                                                 AS completed_count,
  COALESCE(SUM(s.price) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  ), 0)                                                             AS estimated_revenue,
  MAX(r.start_at) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  )                                                                 AS last_completed_at
FROM reservations r
JOIN customers c       ON c.id = r.customer_id
LEFT JOIN services s   ON s.id = r.service_id
WHERE r.customer_id IS NOT NULL
GROUP BY c.tenant_id, r.customer_id, c.name, c.phone, r.service_id, s.name;

-- ---------------------------------------------------------------------------
-- 2. staff_customer_history_view  (grain: staff x customer)
--    Cols consumed: staff_id, staff_name, customer_id, customer_name,
--    customer_phone, booking_count, completed_count, last_completed_at
--    Staff key = reservations.tenant_staff_id -> tenant_users.id (the v2 booking FK).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW staff_customer_history_view AS
SELECT
  c.tenant_id                                                       AS tenant_id,
  r.tenant_staff_id                                                 AS staff_id,
  tu.name                                                           AS staff_name,
  r.customer_id                                                     AS customer_id,
  c.name                                                            AS customer_name,
  c.phone                                                           AS customer_phone,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
  )                                                                 AS booking_count,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  )                                                                 AS completed_count,
  MAX(r.start_at) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  )                                                                 AS last_completed_at
FROM reservations r
JOIN customers c            ON c.id = r.customer_id
LEFT JOIN tenant_users tu   ON tu.id = r.tenant_staff_id
WHERE r.customer_id IS NOT NULL
  AND r.tenant_staff_id IS NOT NULL
GROUP BY c.tenant_id, r.tenant_staff_id, tu.name, r.customer_id, c.name, c.phone;

-- ---------------------------------------------------------------------------
-- 3. tenant_revenue_view  (grain: booking_date x service x staff x customer)
--    Cols consumed: booking_date, service_id, service_name, staff_id, staff_name,
--    customer_id, customer_name, customer_phone, booking_count, completed_count,
--    estimated_revenue. Grounding filters booking_date BETWEEN start AND end.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW tenant_revenue_view AS
SELECT
  c.tenant_id                                                       AS tenant_id,
  (r.start_at AT TIME ZONE 'UTC')::date                             AS booking_date,
  r.service_id                                                      AS service_id,
  s.name                                                            AS service_name,
  r.tenant_staff_id                                                 AS staff_id,
  tu.name                                                           AS staff_name,
  r.customer_id                                                     AS customer_id,
  c.name                                                            AS customer_name,
  c.phone                                                           AS customer_phone,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
  )                                                                 AS booking_count,
  COUNT(*) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  )                                                                 AS completed_count,
  COALESCE(SUM(s.price) FILTER (
    WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
      AND r.start_at < now()
  ), 0)                                                             AS estimated_revenue
FROM reservations r
JOIN customers c            ON c.id = r.customer_id
LEFT JOIN services s        ON s.id = r.service_id
LEFT JOIN tenant_users tu   ON tu.id = r.tenant_staff_id
WHERE r.customer_id IS NOT NULL
GROUP BY
  c.tenant_id, (r.start_at AT TIME ZONE 'UTC')::date,
  r.service_id, s.name, r.tenant_staff_id, tu.name,
  r.customer_id, c.name, c.phone;

-- ---------------------------------------------------------------------------
-- 4. followup_candidates_view  (grain: customer)
--    Cols consumed: customer_id, customer_name, customer_phone, lifetime_bookings,
--    favorite_service, favorite_staff, days_since_visit, risk_score, next_booking_at,
--    is_followup_candidate, candidate_reason. Grounding filters is_followup_candidate=true.
--
--    Derived signals (no source columns):
--      days_since_visit       = whole days since the most recent realized PAST visit
--      risk_score (0..100)     = days_since_visit + 15*no_show_count, clamped
--      is_followup_candidate   = had a past visit, has NO upcoming booking, lapsed >= 30d
--      candidate_reason        = human-readable explanation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW followup_candidates_view AS
WITH base AS (
  SELECT
    c.tenant_id                                                     AS tenant_id,
    c.id                                                            AS customer_id,
    c.name                                                          AS customer_name,
    c.phone                                                         AS customer_phone,
    COALESCE(c.no_show_count, 0)                                    AS no_show_count,
    COUNT(*) FILTER (
      WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
    )                                                               AS lifetime_bookings,
    MAX(r.start_at) FILTER (
      WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
        AND r.start_at < now()
    )                                                               AS last_visit_at,
    MIN(r.start_at) FILTER (
      WHERE r.status NOT IN ('cancelled','no_show','refunded','refund_pending')
        AND r.start_at > now()
    )                                                               AS next_booking_at
  FROM customers c
  LEFT JOIN reservations r ON r.customer_id = c.id
  GROUP BY c.tenant_id, c.id, c.name, c.phone, c.no_show_count
)
SELECT
  b.tenant_id,
  b.customer_id,
  b.customer_name,
  b.customer_phone,
  b.lifetime_bookings,
  (
    SELECT s.name
    FROM reservations r2
    JOIN services s ON s.id = r2.service_id
    WHERE r2.customer_id = b.customer_id
      AND r2.status NOT IN ('cancelled','no_show','refunded','refund_pending')
    GROUP BY s.name
    ORDER BY COUNT(*) DESC NULLS LAST
    LIMIT 1
  )                                                                 AS favorite_service,
  (
    SELECT tu.name
    FROM reservations r3
    JOIN tenant_users tu ON tu.id = r3.tenant_staff_id
    WHERE r3.customer_id = b.customer_id
      AND r3.status NOT IN ('cancelled','no_show','refunded','refund_pending')
    GROUP BY tu.name
    ORDER BY COUNT(*) DESC NULLS LAST
    LIMIT 1
  )                                                                 AS favorite_staff,
  CASE
    WHEN b.last_visit_at IS NOT NULL
    THEN EXTRACT(DAY FROM (now() - b.last_visit_at))::int
  END                                                               AS days_since_visit,
  LEAST(100, GREATEST(0,
    COALESCE(EXTRACT(DAY FROM (now() - b.last_visit_at))::int, 0)
    + b.no_show_count * 15
  ))::int                                                           AS risk_score,
  b.next_booking_at,
  (
    b.last_visit_at IS NOT NULL
    AND b.next_booking_at IS NULL
    AND b.last_visit_at < now() - INTERVAL '30 days'
  )                                                                 AS is_followup_candidate,
  CASE
    WHEN b.last_visit_at IS NOT NULL
     AND b.next_booking_at IS NULL
     AND b.last_visit_at < now() - INTERVAL '30 days'
    THEN 'Lapsed ' || EXTRACT(DAY FROM (now() - b.last_visit_at))::int
         || ' days with no upcoming booking'
  END                                                               AS candidate_reason
FROM base b;

COMMIT;
