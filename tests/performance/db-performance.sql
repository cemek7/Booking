-- Database Performance Testing Queries
-- Run these with EXPLAIN ANALYZE to get detailed performance metrics

-- Test 1: Booking Conflict Detection (Critical Performance Path)
-- This query is used by the DoubleBookingPrevention service
EXPLAIN ANALYZE
SELECT r.id, r.start_at, r.end_at, r.staff_id, r.status
FROM reservations r
WHERE r.tenant_id = 'test-tenant-123'
  AND r.staff_id = 'staff-456'
  AND r.status NOT IN ('cancelled', 'no_show')
  AND r.start_at < '2025-12-01 15:00:00'
  AND r.end_at > '2025-12-01 14:00:00'
LIMIT 1;

-- Performance Target: < 50ms execution time
-- Expected: Index seek on tenant_id, staff_id, start_at, end_at

-- Test 2: Available Time Slots Query
-- Used for displaying available booking times
EXPLAIN ANALYZE
WITH staff_schedule AS (
  SELECT generate_series(
    '2025-12-01 09:00:00'::timestamp,
    '2025-12-01 17:00:00'::timestamp,
    '30 minutes'::interval
  ) AS time_slot
),
booked_slots AS (
  SELECT r.start_at, r.end_at
  FROM reservations r
  WHERE r.tenant_id = 'test-tenant-123'
    AND r.staff_id = 'staff-456'
    AND r.date = '2025-12-01'
    AND r.status NOT IN ('cancelled', 'no_show')
)
SELECT ss.time_slot
FROM staff_schedule ss
LEFT JOIN booked_slots bs ON (
  ss.time_slot >= bs.start_at 
  AND ss.time_slot < bs.end_at
)
WHERE bs.start_at IS NULL
ORDER BY ss.time_slot;

-- Performance Target: < 100ms execution time
-- Expected: Efficient temporal join with proper indexing

-- Test 3: Analytics Dashboard Query
-- Heavy aggregation for dashboard metrics
EXPLAIN ANALYZE
SELECT 
  COUNT(*) as total_bookings,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings,
  COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
  AVG(EXTRACT(EPOCH FROM (end_at - start_at))/60) as avg_duration_minutes,
  SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END) as total_revenue
FROM reservations 
WHERE tenant_id = 'test-tenant-123'
  AND created_at >= NOW() - INTERVAL '30 days'
  AND created_at < NOW();

-- Performance Target: < 200ms execution time
-- Expected: Partial index on recent reservations

-- Test 4: Payment Reconciliation Query
-- Financial data reconciliation for accounting
EXPLAIN ANALYZE
SELECT 
  t.id,
  t.amount,
  t.status,
  t.payment_method,
  t.external_reference,
  t.reconciliation_status,
  r.id as reservation_id,
  r.customer_name
FROM transactions t
LEFT JOIN reservations r ON r.id = t.reservation_id
WHERE t.tenant_id = 'test-tenant-123'
  AND t.reconciliation_status = 'pending'
  AND t.created_at >= NOW() - INTERVAL '24 hours'
ORDER BY t.created_at DESC;

-- Performance Target: < 100ms execution time
-- Expected: Index on reconciliation_status and created_at

-- Test 5: Customer Booking History
-- Frequently accessed for customer service
EXPLAIN ANALYZE
SELECT 
  r.id,
  r.date,
  r.start_at,
  r.end_at,
  r.status,
  r.service_name,
  s.name as staff_name,
  r.total_amount
FROM reservations r
LEFT JOIN staff s ON s.id = r.staff_id
WHERE r.tenant_id = 'test-tenant-123'
  AND r.customer_email = 'customer@example.com'
ORDER BY r.created_at DESC
LIMIT 20;

-- Performance Target: < 150ms execution time
-- Expected: Compound index on tenant_id, customer_email

-- Test 6: Staff Utilization Report
-- Complex aggregation for business intelligence
EXPLAIN ANALYZE
SELECT 
  s.name as staff_name,
  COUNT(r.id) as total_bookings,
  SUM(EXTRACT(EPOCH FROM (r.end_at - r.start_at))/3600) as total_hours,
  AVG(EXTRACT(EPOCH FROM (r.end_at - r.start_at))/60) as avg_appointment_duration,
  SUM(CASE WHEN r.status = 'completed' THEN r.total_amount ELSE 0 END) as revenue_generated
FROM staff s
LEFT JOIN reservations r ON r.staff_id = s.id 
  AND r.tenant_id = 'test-tenant-123'
  AND r.created_at >= NOW() - INTERVAL '30 days'
WHERE s.tenant_id = 'test-tenant-123'
GROUP BY s.id, s.name
ORDER BY revenue_generated DESC;

-- Performance Target: < 300ms execution time
-- Expected: Proper staff and reservation indexing

-- Test 7: Fraud Detection Query
-- Security-related performance for payment monitoring
EXPLAIN ANALYZE
SELECT 
  fa.id,
  fa.transaction_id,
  fa.risk_score,
  fa.risk_factors,
  t.amount,
  t.customer_email,
  COUNT(*) OVER (PARTITION BY t.customer_email) as customer_transaction_count
FROM fraud_assessments fa
JOIN transactions t ON t.id = fa.transaction_id
WHERE fa.tenant_id = 'test-tenant-123'
  AND fa.risk_score > 70
  AND fa.created_at >= NOW() - INTERVAL '7 days'
ORDER BY fa.risk_score DESC, fa.created_at DESC;

-- Performance Target: < 200ms execution time
-- Expected: Index on risk_score and created_at

-- Test 8: Real-time Availability Check
-- High-frequency query for booking validation
EXPLAIN ANALYZE
SELECT EXISTS (
  SELECT 1 FROM reservations r
  WHERE r.tenant_id = 'test-tenant-123'
    AND r.staff_id = 'staff-456'
    AND r.status NOT IN ('cancelled', 'no_show')
    AND r.start_at < '2025-12-01 15:30:00'
    AND r.end_at > '2025-12-01 14:30:00'
) as has_conflict;

-- Performance Target: < 25ms execution time (real-time requirement)
-- Expected: Very fast index-only scan

-- Test 9: Tenant Data Volume Query
-- Monitoring query for scaling decisions
EXPLAIN ANALYZE
SELECT 
  tenant_id,
  COUNT(*) as reservation_count,
  MIN(created_at) as earliest_booking,
  MAX(created_at) as latest_booking,
  pg_size_pretty(pg_total_relation_size('reservations')) as table_size
FROM reservations
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY tenant_id
HAVING COUNT(*) > 1000
ORDER BY reservation_count DESC;

-- Performance Target: < 500ms execution time
-- Expected: Efficient tenant-based partitioning

-- Test 10: Concurrent Lock Performance
-- Testing reservation locking mechanism
EXPLAIN ANALYZE
SELECT r.id
FROM reservations r
WHERE r.tenant_id = 'test-tenant-123'
  AND r.staff_id = 'staff-456'
  AND r.start_at < '2025-12-01 15:00:00'
  AND r.end_at > '2025-12-01 14:00:00'
FOR UPDATE NOWAIT;

-- Performance Target: < 30ms execution time
-- Expected: Fast lock acquisition or immediate failure

-- Performance Testing Script for pgbench
-- Create this as a separate file: pgbench-booking-test.sql

\set customer_id random(1, 100000)
\set staff_id random(1, 100)
\set service_id random(1, 50)
\set booking_date '2025-12-' || random(1, 28)
\set booking_hour random(9, 17)
\set booking_minute random(0, 1) * 30

BEGIN;

-- Check availability
SELECT COUNT(*) FROM reservations 
WHERE staff_id = :staff_id 
  AND date = :'booking_date'
  AND EXTRACT(HOUR FROM start_at) = :booking_hour
  AND EXTRACT(MINUTE FROM start_at) = :booking_minute;

-- Create booking (simplified)
INSERT INTO reservations (
  tenant_id, customer_name, staff_id, service_name, 
  date, start_at, end_at, status, created_at
) VALUES (
  'test-tenant',
  'Customer ' || :customer_id,
  :staff_id,
  'Service ' || :service_id,
  :'booking_date',
  :'booking_date' || ' ' || :booking_hour || ':' || :booking_minute || ':00',
  :'booking_date' || ' ' || :booking_hour || ':' || (:booking_minute + 60) || ':00',
  'confirmed',
  NOW()
);

COMMIT;

-- Run with: pgbench -c 10 -T 60 -f pgbench-booking-test.sql booking_db
-- This simulates 10 concurrent users for 60 seconds