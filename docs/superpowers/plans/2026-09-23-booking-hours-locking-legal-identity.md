# Booking Hours, Reservation Safety, and Legal Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Techclave's verified legal identity, make owner-configured tenant-local business hours authoritative everywhere, and reject overlapping active reservations atomically.

**Architecture:** `tenants.settings.business_hours` becomes the canonical business-wide schedule and a focused domain module normalizes legacy values and converts tenant-local times to UTC. Application pre-checks remain for useful feedback, while a PostgreSQL GiST exclusion constraint becomes the final concurrency boundary; WhatsApp's existing `slot_locks` remains only a temporary conversational hold.

**Tech Stack:** Next.js 16, TypeScript, Jest, Supabase/PostgreSQL, Zod, PostgreSQL `btree_gist` and `tstzrange`.

**Spec:** `docs/superpowers/specs/2026-09-23-booking-hours-locking-legal-identity-design.md`

## Global Constraints

- Preserve the untracked staging smoke-test handoff; never add, modify, or delete it in this work.
- Do not publish the company TIN or any director/shareholder personal information.
- Legal identity is exactly `Techclave Ltd`, `RC 8489929`, and `25, Ndola Crescent, Wuse Zone 5, FCT, Nigeria`.
- Canonical business hours live at `tenants.settings.business_hours`; legacy data is fallback/backfill only.
- Missing schedules default to Monday-Friday 09:00-17:00 and closed weekends.
- Tenant-local input uses `tenants.timezone`, falling back to `Africa/Lagos` only for missing/invalid legacy values.
- `slot_locks` remains the WhatsApp temporary hold mechanism; `reservation_locks` is not used by booking creation.
- PostgreSQL error `23P01` must surface as the existing conflict response.
- No new `SECURITY DEFINER` function and no new browser access to service-role resources.
- Schema changes use the repository's numbered `db/migrations` convention because the Supabase CLI is unavailable in this workspace.

---

### Task 1: Verified legal identity

**Files:**
- Modify: `src/lib/legal/constants.ts`
- Modify: `src/app/privacy/page.tsx`
- Modify: `src/app/terms/page.tsx`
- Modify: `src/app/dpa/page.tsx`
- Create: `src/__tests__/site/legalIdentity.test.tsx`

**Interfaces:**
- Produces: `LEGAL.registrationNumber`, `LEGAL.registeredAddress`, and verified `LEGAL.entity`.
- Consumes: existing `LegalDocument`/`LegalSection` page components.

- [ ] **Step 1: Write the failing legal identity test**

  Assert that constants contain the verified entity, RC number, and registered address; render Privacy, Terms, and DPA and assert that each page contains the entity identity while no page contains `legal entity to be confirmed`.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `npm test -- src/__tests__/site/legalIdentity.test.tsx --runInBand`

  Expected: FAIL because `registrationNumber`/`registeredAddress` are absent and the placeholder entity remains.

- [ ] **Step 3: Implement the verified constants and page copy**

  Add the exact public CAC facts to `LEGAL`, update `lastUpdated` to `2026-09-23`, and render a concise registered-operator sentence in the three legal pages. Do not add TIN or personal information.

- [ ] **Step 4: Run legal and existing email-domain tests**

  Run: `npm test -- src/__tests__/site/legalIdentity.test.tsx src/__tests__/site/emailDomains.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 5: Commit the legal correction**

  ```bash
  git add src/lib/legal/constants.ts src/app/privacy/page.tsx src/app/terms/page.tsx src/app/dpa/page.tsx src/__tests__/site/legalIdentity.test.tsx
  git commit -m "fix(legal): publish verified Techclave identity"
  ```

### Task 2: Canonical business-hours domain and Settings round-trip

**Files:**
- Create: `src/lib/booking/businessHours.ts`
- Create: `src/lib/booking/businessHours.test.ts`
- Modify: `src/app/api/tenants/[tenantId]/settings/route.ts`
- Modify: `src/components/settings/SettingsWorkspace.tsx`
- Modify: `src/components/settings/BusinessHoursSection.tsx`
- Modify: `src/components/settings/SettingsWorkspace.test.tsx`

**Interfaces:**
- Produces: `BusinessHours`, `DayHours`, `normalizeBusinessHours(value)`, `resolveBusinessHours(input)`, `localDateTimeToUtc(date, time, timezone)`, `utcDayBounds(date, timezone)`, and `businessDayKey(date, timezone)`.
- Consumes: `tenants.settings`, optional legacy `metadata.business_hours`, and optional legacy table rows.

- [ ] **Step 1: Write failing domain tests**

  Cover valid schedules, closed-day normalization, invalid/missing times, legacy long day names, canonical precedence, weekday defaults, fixed-offset conversion, DST gap rejection, DST repeat choosing the earlier instant, and invalid timezone fallback.

- [ ] **Step 2: Run the domain test and confirm RED**

  Run: `npm test -- src/lib/booking/businessHours.test.ts --runInBand`

  Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused domain module**

  Use `Intl.DateTimeFormat(..., { timeZone })` and format-to-parts matching; do not use the process timezone. Keep the module independent of Supabase so tests exercise real conversion and normalization logic.

- [ ] **Step 4: Run the domain test and confirm GREEN**

  Run: `npm test -- src/lib/booking/businessHours.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 5: Write failing Settings tests**

  Assert that `businessHours` input is normalized to `business_hours`, the API returns only the canonical snake-case field, and saving the Agent tab preserves a seven-day schedule.

- [ ] **Step 6: Run Settings tests and confirm RED**

  Run: `npm test -- src/components/settings/SettingsWorkspace.test.tsx src/__tests__/app/api/tenant-settings-business-hours.test.ts --runInBand`

  Expected: FAIL until the route normalization and UI type consolidation exist.

- [ ] **Step 7: Implement Settings normalization**

  Extend the route validation refinement to validate `business_hours`; map legacy `businessHours` to `business_hours` before merging; remove the duplicate client-side camel-case contract; preserve authorization and unrelated settings.

- [ ] **Step 8: Run domain and Settings tests**

  Run: `npm test -- src/lib/booking/businessHours.test.ts src/components/settings/SettingsWorkspace.test.tsx src/__tests__/app/api/tenant-settings-business-hours.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 9: Commit canonical hours and Settings integration**

  ```bash
  git add src/lib/booking/businessHours.ts src/lib/booking/businessHours.test.ts src/app/api/tenants/[tenantId]/settings/route.ts src/components/settings/SettingsWorkspace.tsx src/components/settings/BusinessHoursSection.tsx src/components/settings/SettingsWorkspace.test.tsx src/__tests__/app/api/tenant-settings-business-hours.test.ts
  git commit -m "feat(booking): canonicalize tenant business hours"
  ```

### Task 3: Use canonical tenant-local hours in public booking and AI

**Files:**
- Modify: `src/lib/publicBookingService.ts`
- Create: `src/__tests__/lib/public-booking-hours.test.ts`
- Modify: `src/lib/llmContextManager.ts`
- Modify: `src/lib/dialogBookingBridge.ts`
- Create: `src/__tests__/lib/dialog-business-hours.test.ts`

**Interfaces:**
- Consumes: Task 2 business-hours functions.
- Produces: public availability/booking UTC timestamps and AI hours derived from the same canonical schedule.

- [ ] **Step 1: Write failing public-booking tests**

  Exercise a closed day, custom 10:00-16:00 hours, default hours, Africa/Lagos conversion, and a tenant outside the server timezone. Assert reservation queries use tenant-local UTC day bounds and booking inserts use the converted UTC instant.

- [ ] **Step 2: Run the public-booking test and confirm RED**

  Run: `npm test -- src/__tests__/lib/public-booking-hours.test.ts --runInBand`

  Expected: FAIL because public booking reads the legacy table and constructs server-local dates.

- [ ] **Step 3: Implement canonical public availability and creation**

  Fetch `settings`, `metadata`, and `timezone` once per flow; prefer canonical settings; use legacy rows only as fallback; generate local labels inside configured hours; query reservations with tenant-local UTC bounds; convert booking input to UTC before conflict detection and insertion; reject closed/out-of-hours requests.

- [ ] **Step 4: Run public-booking tests and confirm GREEN**

  Run: `npm test -- src/__tests__/lib/public-booking-hours.test.ts src/__tests__/lib/public-booking-tenant-info.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 5: Write failing AI schedule tests**

  Assert `llmContextManager` and `dialogBookingBridge` prefer `settings.business_hours`, fall back to metadata, and agree with the public-booking resolver about whether a tenant is open.

- [ ] **Step 6: Run AI schedule tests and confirm RED**

  Run: `npm test -- src/__tests__/lib/dialog-business-hours.test.ts --runInBand`

  Expected: FAIL because both AI paths currently read metadata directly.

- [ ] **Step 7: Replace independent AI parsing with the shared resolver**

  Select tenant `settings` alongside `metadata` and call the Task 2 module. Preserve existing lead-capture and response copy.

- [ ] **Step 8: Run all focused hours tests**

  Run: `npm test -- src/lib/booking/businessHours.test.ts src/__tests__/lib/public-booking-hours.test.ts src/__tests__/lib/public-booking-tenant-info.test.ts src/__tests__/lib/dialog-business-hours.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 9: Commit consumer integration**

  ```bash
  git add src/lib/publicBookingService.ts src/__tests__/lib/public-booking-hours.test.ts src/lib/llmContextManager.ts src/lib/dialogBookingBridge.ts src/__tests__/lib/dialog-business-hours.test.ts
  git commit -m "fix(booking): honor tenant-local opening hours"
  ```

### Task 4: Backfill schedules and enforce reservation overlap safety

**Files:**
- Create: `db/migrations/152_booking_hours_reservation_safety.sql`
- Create: `db/migrations/152_booking_hours_reservation_safety_rollback.sql`
- Create: `src/__tests__/scripts/bookingSafetyMigration.test.ts`
- Modify: `src/lib/reservationService.ts`
- Modify: `src/lib/publicBookingService.ts`
- Modify: `src/app/api/bookings/route.ts`
- Modify: `src/__tests__/app/api/bookings/bookings.test.ts`
- Create: `src/__tests__/lib/reservation-conflict.test.ts`
- Create: `src/lib/whatsapp/v2/slotEngine.test.ts`

**Interfaces:**
- Produces: `reservations_no_active_overlap` exclusion constraint and application error normalization from `23P01` to `code: 'conflict'`.
- Consumes: existing `slot_locks` for WhatsApp holds; does not call `reservation_locks` during booking creation.

- [ ] **Step 1: Write failing migration-contract tests**

  Read the SQL as text and assert it contains: non-destructive overlap preflight, unpinned `btree_gist`, half-open `tstzrange`, tenant/effective-staff equality, active-state predicate, canonical-hours backfill precedence, no deletion of reservations, and a rollback that only removes the new constraint.

- [ ] **Step 2: Run migration-contract tests and confirm RED**

  Run: `npm test -- src/__tests__/scripts/bookingSafetyMigration.test.ts --runInBand`

  Expected: FAIL because migration 152 does not exist.

- [ ] **Step 3: Write migration 152 and its rollback**

  Use a transaction; abort on detected active overlaps; backfill missing canonical schedules without overwriting existing values; create `btree_gist` without a version; add an idempotently named GiST exclusion constraint over tenant, `coalesce(staff_id, zero UUID)`, and `tstzrange(start_at,end_at,'[)')`; retain all legacy tables. Rollback drops only the constraint because deleting backfilled owner configuration would be unsafe.

- [ ] **Step 4: Run migration-contract tests and static SQL review**

  Run: `npm test -- src/__tests__/scripts/bookingSafetyMigration.test.ts src/__tests__/scripts/migrationNumbering.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 5: Write failing application conflict tests**

  Assert that `reservationService` maps an insert error with code `23P01` to `code: 'conflict'`; public and authenticated booking routes return conflict semantics; neither route calls `acquireSlotLock` on `reservation_locks`; and the existing WhatsApp `slot_locks` insert/release flow remains unchanged.

- [ ] **Step 6: Run conflict tests and confirm RED**

  Run: `npm test -- src/__tests__/lib/reservation-conflict.test.ts src/__tests__/app/api/bookings/bookings.test.ts src/lib/whatsapp/v2/slotEngine.test.ts --runInBand`

  Expected: FAIL because both routes still acquire the broken lock and raw exclusion errors are not normalized.

- [ ] **Step 7: Retire `reservation_locks` from booking creation and normalize conflicts**

  Keep friendly overlap pre-checks, remove acquire/release calls from public and authenticated creation paths, preserve WhatsApp `slot_locks`, and map `23P01` consistently.

- [ ] **Step 8: Run booking and WhatsApp regression tests**

  Run: `npm test -- src/__tests__/lib/reservation-conflict.test.ts src/__tests__/app/api/bookings/bookings.test.ts src/lib/whatsapp/v2/slotEngine.test.ts src/__tests__/lib/whatsapp/v2/customerBooking.salesActions.test.ts --runInBand`

  Expected: PASS.

- [ ] **Step 9: Commit schema and booking safety**

  ```bash
  git add db/migrations/152_booking_hours_reservation_safety.sql db/migrations/152_booking_hours_reservation_safety_rollback.sql src/__tests__/scripts/bookingSafetyMigration.test.ts src/lib/reservationService.ts src/lib/publicBookingService.ts src/app/api/bookings/route.ts src/__tests__/app/api/bookings/bookings.test.ts src/__tests__/lib/reservation-conflict.test.ts src/lib/whatsapp/v2/slotEngine.test.ts
  git commit -m "fix(booking): enforce active reservation exclusivity"
  ```

### Task 5: Verification and operator handoff

**Files:**
- Modify: `scripts/validate-schema.js`
- Create: `scripts/validate-schema.test.js`
- Create: `docs/runbooks/booking-hours-reservation-safety-rollout.md`
- Modify: `docs/runbooks/launch-readiness-operator-guide.md`

**Interfaces:**
- Produces: a release gate and exact staging/production verification commands without secrets.

- [ ] **Step 1: Write failing validator coverage**

  Extend the validator unit test to require the scheduling tables/columns used by the shipped code and add a static check for migration 152's constraint name.

- [ ] **Step 2: Run validator tests and confirm RED**

  Run: `npm test -- scripts/validate-schema.test.js src/__tests__/scripts/bookingSafetyMigration.test.ts --runInBand`

  Expected: FAIL until the manifest and checks are updated.

- [ ] **Step 3: Update the schema gate and rollout runbook**

  Document: overlap preflight, migration application, constraint inspection, canonical-hours verification, staging save/read test, concurrent insert test, rollback limitation, and the legal/email operator gates. Remove stale claims that the hours/lock tables do not exist.

- [ ] **Step 4: Run focused and repository-wide verification**

  Run:

  ```bash
  npm test -- src/__tests__/site/legalIdentity.test.tsx src/lib/booking/businessHours.test.ts src/__tests__/lib/public-booking-hours.test.ts src/__tests__/lib/dialog-business-hours.test.ts src/__tests__/lib/reservation-conflict.test.ts src/__tests__/app/api/bookings/bookings.test.ts src/__tests__/scripts/bookingSafetyMigration.test.ts --runInBand
  npm run typecheck:ci
  npx eslint src/lib/legal/constants.ts src/app/privacy/page.tsx src/app/terms/page.tsx src/app/dpa/page.tsx src/lib/booking src/lib/publicBookingService.ts src/lib/llmContextManager.ts src/lib/dialogBookingBridge.ts src/lib/reservationService.ts src/app/api/bookings/route.ts src/app/api/tenants/[tenantId]/settings/route.ts src/components/settings/BusinessHoursSection.tsx src/components/settings/SettingsWorkspace.tsx
  git diff --check
  ```

  Expected: all commands PASS with no new warnings.

- [ ] **Step 5: Self-review the complete diff**

  Confirm the implementation matches every specification section, no secret/personal data was added, the smoke-test handoff remains untracked and unchanged, migration 152 is non-destructive, and no production/staging state has been modified.

- [ ] **Step 6: Commit verification and handoff**

  ```bash
  git add scripts/validate-schema.js scripts/validate-schema.test.js docs/runbooks/booking-hours-reservation-safety-rollout.md docs/runbooks/launch-readiness-operator-guide.md
  git commit -m "docs(booking): add reservation safety rollout gate"
  ```

- [ ] **Step 7: Report the pre-deployment gate**

  Provide commit IDs, tests run, remaining operator actions, and the exact next staging SQL/deployment checkpoint. Do not push, migrate, or deploy without a separate explicit instruction.
