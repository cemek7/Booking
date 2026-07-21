# Operational Intelligence — Integration Pass Report

**Date:** 2026-07-21
**Branch:** `feat/operational-intelligence`
**Base:** `staging` (merge-base `bc9a7a2`)
**Integrator:** Claude Code
**Handoff:** `docs/superpowers/2026-07-21-claude-code-operational-intelligence-handoff.md`

## Executive summary

The 11-plan Operational Intelligence stack integrates cleanly. Branch-wide
typecheck is green, migrations are symmetric with full RLS, and the cross-spec
seams (consolidation items A–Q) hold in code. The integration pass found **4
test regressions the stack introduced** (all stale-mock drift from shared-path
refactors, production-safe) — **all fixed**. The remaining test failures are
**pre-existing on `staging` and identical at the merge-base** — the stack adds
**zero net test regressions**.

**Recommendation: proceed to a normal (non-squash) merge into `staging`**, with
two residual gaps noted below (one medium, one low) that do not block merge.

## Branch-wide validation

| Check | Result |
|-------|--------|
| `npx tsc` (typecheck:ci) | ✅ green (exit 0) |
| `npx eslint .` | ⚠️ 1152 errors / 524 warnings — **pre-existing repo baseline**, not stack-specific (dominated by `no-explicit-any` across the whole repo; touched ops-intel files are consistent with it) |
| `npm test` (before fixes) | 21 suites / 130 tests failing |
| `npm test` (after fixes) | **17 suites / 122 tests failing — exactly matches `staging` baseline** |

### Test triage method

Ran the full suite at HEAD and at the merge-base (`bc9a7a2`, a worktree sharing
`node_modules`) and diffed the failure sets:

- **Merge-base (staging):** 17 suites / 122 tests failing.
- **HEAD before fixes:** 21 suites / 130 tests failing.
- The **4 extra failing suites** (8 tests) passed at merge-base but failed at
  HEAD → **stack-introduced regressions**. Confirmed by running each in
  isolation at both revisions.
- The other 17 failing suites fail **identically at the merge-base** (verified
  the exact `actionValidator` failure list matches) → **inherited from staging,
  out of scope** for this stack.

## Regressions found and fixed

All four were **stale test mocks** left behind when the stack refactored shared
code paths. The source changes are correct for production; the pre-existing
hand-rolled Supabase mocks simply did not model the new queries. Fixes update
the mocks (and one bogus test fixture) to match production behavior — no source
logic was changed to force green.

| # | Suite | Root cause | Fix |
|---|-------|-----------|-----|
| 1 | `src/__tests__/lib/ai/customerRecall.test.ts` | Plan 8 swapped local `findCustomer` for shared `findCustomerByPhone`, which adds `.is('merged_into', null)`; mock chain lacked `.is()`. Also the test's phone `+234800` is only 6 digits — the new `normalizePhone` correctly rejects it as invalid → `getCustomerRecall` short-circuits to null. | Added `is` to the mock chain; replaced the bogus phone with a valid `+2348012345678`. |
| 2 | `tests/isolation/multi-tenant-isolation.test.ts` | Plan 8: customers `GET` now excludes merged rows via `.is('merged_into', null)`; mock's `customers` chain lacked `.is()` → 500. | Added `is: mockReturnThis()` to the customers branch. |
| 3 | `tests/authMe.test.ts` | Plan 4: auth path now selects `tenant_users.id` and calls `getEffectivePermissions` (queries `tenant_user_permissions`, throws if the tenant_user isn't found by id). Mock rows lacked `id` and the permissions table wasn't modeled. | Added `id` to tenant_users rows; `eq` tracks `id`/`tenant_user_id`; `tenant_user_permissions` resolves `[]`. |
| 4 | `tests/staffSkillUnassign.test.ts` | Same plan-4 auth dependency as #3. | Added `id` to the tenant membership fixture; added a `tenant_user_permissions` branch returning `[]`. |

**Verification:** the four suites pass in isolation (13/13), and the full-suite
failure count dropped to the staging baseline (122) with none of the four in the
failing set.

## Cross-plan seam verification (consolidation items A–Q)

| Item | Concern | Status |
|------|---------|--------|
| A / H / N | Single owned reservation-completion hook: multi-service snapshot + recipe consumption + event | ✅ `markReservationCompleted` is the **sole** writer of `reservations.status='completed'` (grep-verified; `paymentService` write is on `transactions`). Sums `services.price_cents × quantity` over `reservation_services` with legacy single-service fallback; fires `consumeForReservation` and `RESERVATION_COMPLETED`. The reservations PATCH route routes completion transitions through it without a double status write. |
| B | `stock_leaving_without_record` excludes `count_adjustment` | ✅ `inventory.ts:69` filters out `count_adjustment` movements. |
| C / P | Shared `BUSINESS_EVENT_ACTIONS` + `movement_type` vocabulary | ✅ registry exists and is imported widely. ⚠️ **Low-severity debt:** anomaly rule `triggerActions` use raw string literals (`'stock_count.approved'`, etc.) that currently **match** the registry values but don't reference the constant — see Residual gaps. |
| D / G | Capability→permission rewire at auth | ✅ `createApiHandler` resolves `getEffectivePermissions` at auth and gates on real permission IDs; `access.denied` business event emitted on denial. |
| F / L | Single evening WhatsApp message | ✅ `closeReportJob` folds the anomaly summary into one `sendTextMessage`, guarded by `delivered_at`; real-time critical alerts are the only separate send. |
| K | Capture confirm + reco accept run through the plan-2 execute spine | ✅ `decideRecommendation` accept path calls `validateAction` then `executeAction` (permission-gated); manual-only reco types (no action mapping) correctly do **not** execute. |
| M | `inventory_movements` extended, not recreated; RLS by convention | ✅ migration 126 adds columns (no `CREATE TABLE`); no parallel write path introduced. |
| Q | Migrations ≥122, additive, paired rollbacks | ✅ migrations 122–136, **15 forward + 15 rollback** (symmetric), every new table has `ENABLE ROW LEVEL SECURITY` + policies (counts verified per migration). |

## Residual gaps

### G1 — Approval replay is exactly-once only under *sequential* access (medium)

`resolveApprovalRequest` (`src/lib/approvals/requests.ts`) guards re-processing
with `if (request.status !== 'pending')` and a conditional
`.update(...).eq('status','pending')`. However, it calls `executeAction`
**before** the atomic status flip, and the approval path does **not** pass
through the `ai_action_log` idempotency wrapper that the WhatsApp `ownerCommands`
flow uses. Under **concurrent** approvals of the same pending request (double
click / double tab / retry), both callers can pass the pending check and execute
the underlying **money action** (refund / retail sale) twice before one wins the
status flip.

- **Blast radius:** financial (double refund / double sale) in a narrow
  concurrency window.
- **Recommended fix:** claim-then-execute — atomically transition
  `pending → approving` with a conditional update and only `executeAction` if
  that update returned a row; on success go `approving → approved`, on failure
  revert. Alternatively, pass an idempotency key derived from `request.id` into
  `executeAction` so `ai_action_log` dedups the replay.
- **Why deferred, not fixed here:** reordering money-critical logic has a real
  dual-write tradeoff (mark-approved-but-execution-failed) and warrants an owner
  design decision rather than a silent integration-pass change. Not a
  correctness issue for the common sequential path.

Related low note: `decideRecommendation` does not early-return when a
recommendation is already `accepted`, so a double-accept of an
action-backed reco relies on the same `executeAction` idempotency to avoid
double execution.

### G2 — Anomaly `triggerActions` use string literals, not the registry constant (low)

Consolidation item C asks the real-time rule `triggerActions` to reference
`BUSINESS_EVENT_ACTIONS`. They currently use raw strings
(`src/lib/anomalies/rules/{inventory,service,retail}.ts`). Every literal was
verified to match an existing registry value today, so there is **no runtime
drift** — but a future rename of a registry value would silently break rule
triggering. Cheap mechanical follow-up: swap the literals for the constants.

## Inherited (out-of-scope) failures

122 test failures are pre-existing on `staging` (identical at the merge-base) and
are **not** introduced by this stack. They span unrelated domains — Instagram
channel-awareness, PostHog identity, magic-link auth, health/readiness, analytics
dashboard, `actionValidator` walk-in/sales, evolution integration, etc. They
should be triaged on `staging` independently; this stack neither fixes nor worsens
them.

## Merge recommendation

**Proceed with a normal merge commit into `staging`** (do **not** squash — the
per-plan history and migration slices are worth preserving), after:

1. Landing the four test-mock fixes + this report (committed on the feature
   branch as the integration slice).
2. Owner sign-off (or a follow-up ticket) on **G1** — recommend fixing before
   the approvals feature is exposed to concurrent real-money use, but it does not
   block the merge itself.

Do **not** port this stack into `release/vps-launch`; cherry-pick only specific
launch-safe fixes later if required.

### Finish-criteria checklist

- [x] Branch-wide validation run and triaged (typecheck green; tests triaged vs merge-base; lint baseline characterized)
- [x] Integration bugs found during the pass fixed (4 regressions → green)
- [x] Residual gaps closed or explicitly documented as deferred (G1 medium, G2 low)
- [x] Self-review against plans/specs/consolidation done (items A–Q)
- [x] Merge recommendation written
- [x] Branch clean after the integration commit
