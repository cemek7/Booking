# Tenant Offboarding Regression

This runbook covers the final audit/regression pass for `docs/superpowers/plans/2026-06-18-tenant-offboarding.md`.

## Goal

Verify the implemented offboarding flow behaves correctly in live-like conditions before the thread is marked complete.

## Read points

- [src/app/api/tenants/[tenantId]/offboard/route.ts](/home/ccemeka/Techclave/Booking/Booking/src/app/api/tenants/[tenantId]/offboard/route.ts:1)
- [src/app/api/tenants/[tenantId]/reactivate/route.ts](/home/ccemeka/Techclave/Booking/Booking/src/app/api/tenants/[tenantId]/reactivate/route.ts:1)
- [src/app/api/tenants/[tenantId]/export/route.ts](/home/ccemeka/Techclave/Booking/Booking/src/app/api/tenants/[tenantId]/export/route.ts:1)
- [src/lib/offboarding/offboardService.ts](/home/ccemeka/Techclave/Booking/Booking/src/lib/offboarding/offboardService.ts:1)
- [src/lib/offboarding/purgeWorker.ts](/home/ccemeka/Techclave/Booking/Booking/src/lib/offboarding/purgeWorker.ts:1)
- [src/lib/error-handling/route-handler.ts](/home/ccemeka/Techclave/Booking/Booking/src/lib/error-handling/route-handler.ts:274)
- [src/app/api/cron/nightly/route.ts](/home/ccemeka/Techclave/Booking/Booking/src/app/api/cron/nightly/route.ts:1)

## Focused tests

Run the offboarding suites first:

```bash
npx jest \
  src/__tests__/api/tenants/offboarding-routes.test.ts \
  src/__tests__/api/tenants/offboarding-modify-routes.test.ts \
  src/__tests__/components/settings/CloseAccountSection.test.tsx \
  -i
```

## Manual regression scenarios

## 1. Voluntary owner offboarding

- trigger `POST /api/tenants/:tenantId/offboard`
- confirm `tenants.lifecycle_state = scheduled_for_deletion`
- confirm `offboarding_tasks` rows are created
- confirm an audit log row is written

## 2. Reactivation during grace

- trigger `POST /api/tenants/:tenantId/reactivate`
- confirm lifecycle returns to `active`
- confirm blocked routes become accessible again

## 3. Export availability

- request `GET /api/tenants/:tenantId/export`
- confirm the signed export path resolves while the tenant is still in grace

## 4. Nightly teardown + operational purge

- age a test tenant past `scheduled_purge_at`
- run the nightly cron path
- confirm teardown tasks are processed
- confirm operational data/PII is purged as designed
- confirm the tenant row remains until the financial retention boundary

## 5. Financial purge

- age a test tenant past `financials_purge_at`
- run the nightly cron path again
- confirm final retention purge runs and the tenant reaches the terminal state expected by the plan

## 6. Lifecycle gate

For a non-`active` tenant, confirm normal tenant routes return the expected lock response while allowlisted offboarding/reactivation/export paths still work.

## Done criteria

The thread is closed when:
- focused offboarding tests pass
- all five manual scenarios above behave as planned
- no hard-cascade tenant delete path remains in live usage
