# Booking Hours and Reservation Safety Rollout

**Scope:** migration 152 and the application release that reads `tenants.settings.business_hours`.

This rollout is intentionally fail-closed. Migration 152 does not delete or repair overlapping reservations. If active historical rows overlap, it raises an exception and the whole transaction—including the hours backfill—rolls back.

## 1. Pre-deployment database audit

Run this in the target Supabase SQL Editor before applying the migration:

```sql
select
  a.tenant_id,
  coalesce(a.staff_id, '00000000-0000-0000-0000-000000000000'::uuid) as effective_staff_id,
  a.id as reservation_a,
  b.id as reservation_b,
  a.start_at as a_start,
  a.end_at as a_end,
  b.start_at as b_start,
  b.end_at as b_end
from public.reservations a
join public.reservations b
  on a.tenant_id = b.tenant_id
 and coalesce(a.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
   = coalesce(b.staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
 and a.id < b.id
 and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(b.start_at, b.end_at, '[)')
where a.status in ('pending', 'confirmed')
  and b.status in ('pending', 'confirmed')
  and a.tenant_id is not null
  and a.start_at is not null and a.end_at is not null and a.start_at < a.end_at
  and b.start_at is not null and b.end_at is not null and b.start_at < b.end_at;
```

Expected: zero rows. If rows appear, stop. An owner must decide which reservation is legitimate and cancel or reschedule the other; do not delete records to make the migration pass.

## 2. Apply migration 152

In the Supabase SQL Editor, run the complete contents of:

`db/migrations/152_booking_hours_reservation_safety.sql`

Then verify:

```sql
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.reservations'::regclass
  and conname = 'reservations_no_active_overlap';

select count(*) as tenants_missing_canonical_hours
from public.tenants
where not (coalesce(settings, '{}'::jsonb) ? 'business_hours');
```

Expected: one exclusion constraint (`contype = 'x'`) and zero tenants missing canonical hours.

From the release host, run the schema gate without printing credentials:

```bash
npm run db:validate
```

## 3. Deploy and validate staging

Deploy the application commit only after the database gate passes. In staging:

1. Sign in as an owner.
2. Open Settings → Agent → Business hours.
3. Set one weekday to a non-default range and one day to Closed; save.
4. Reload Settings and confirm the seven-day schedule round-trips unchanged.
5. Open the public booking page. Confirm the closed day has no slots and the custom day starts/ends at the configured tenant-local times.
6. Create a booking in an allowed slot and confirm the stored `start_at`/`end_at` are the correct UTC instants for `tenants.timezone`.
7. Confirm the AI hours answer matches the same schedule.

## 4. Prove concurrent-write rejection in staging

Use an isolated test tenant/staff and two SQL Editor tabs. Replace the placeholders with staging UUIDs and a future interval.

Tab A:

```sql
insert into public.reservations
  (tenant_id, staff_id, tenant_staff_id, start_at, end_at, status, metadata)
values
  ('<tenant-uuid>', '<staff-uuid>', '<staff-uuid>', '<start-utc>', '<end-utc>', 'pending',
   '{"migration_152_smoke":true}'::jsonb)
returning id;
```

Tab B: run the same statement with a partly overlapping interval. Expected: PostgreSQL error `23P01` naming `reservations_no_active_overlap`. An interval starting exactly when Tab A ends must succeed because ranges are half-open.

Clean up only the marked staging smoke rows:

```sql
delete from public.reservations
where tenant_id = '<tenant-uuid>'
  and metadata @> '{"migration_152_smoke":true}'::jsonb;
```

Also exercise the application route with two simultaneous requests and confirm one succeeds while the loser receives HTTP 409, not 500.

## 5. Production gate

Repeat sections 1 and 2 against production, deploy the verified immutable image, then run health, readiness, schema validation, and a single owner-led booking smoke test. Do not use synthetic concurrent inserts in production.

Legal/email checks before broader onboarding:

- Public policies identify `Techclave Ltd`, `RC 8489929`, at `25, Ndola Crescent, Wuse Zone 5, FCT, Nigeria`.
- Qualified counsel has completed the final policy review and the draft banner has been removed only after sign-off.
- `privacy@techclave.cloud`, `legal@techclave.cloud`, and `support@techclave.cloud` each receive a test message in a monitored destination inbox; record the UTC time and recipient confirmation.

## Rollback boundary

`152_booking_hours_reservation_safety_rollback.sql` removes only `reservations_no_active_overlap`. It deliberately retains `btree_gist` and backfilled `settings.business_hours`, because another database object may use the extension and owners may edit their hours after rollout.

Rolling back the application while retaining canonical hours is safe. Removing the constraint reopens the concurrency race, so rollback is an incident action, not a routine way to resolve rejected writes.
