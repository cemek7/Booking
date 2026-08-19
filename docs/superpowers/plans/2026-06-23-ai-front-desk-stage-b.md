# AI Front Desk Stage B

## Scope

Stage B adds the precomputed intelligence layer behind the front-desk architecture:

- summary tables for owner questions
- nightly aggregation jobs
- availability snapshots for faster grounding
- owner-summary grounding shifted toward summaries first

## Implemented On 2026-06-23

| Area | Status | Path |
|---|---|---|
| summary table migration | implemented | `db/migrations/092_ai_front_desk_summaries.sql` |
| nightly tenant daily summary | implemented | `src/app/api/cron/nightly/route.ts` |
| nightly customer profile summary | implemented | `src/app/api/cron/nightly/route.ts` |
| nightly service performance summary | implemented | `src/app/api/cron/nightly/route.ts` |
| nightly staff performance summary | implemented | `src/app/api/cron/nightly/route.ts` |
| nightly availability snapshot generation | implemented | `src/app/api/cron/nightly/route.ts` |
| owner-query summary-first grounding | implemented | `src/lib/ai/grounding-service.ts` |
| availability snapshot grounding fallback | implemented | `src/lib/ai/grounding-service.ts` |
| post-deploy validation helper | implemented | `deployment/scripts/post-deploy-ai-front-desk.sh` |

## New Tables

| Table | Purpose |
|---|---|
| `tenant_daily_summary` | day-level owner reporting |
| `customer_profile_summary` | customer recency, loyalty, and favorites |
| `service_performance_summary` | service-level bookings, revenue, completion |
| `staff_performance_summary` | staff-level bookings and revenue |
| `availability_snapshot` | precomputed slot availability by staff/date |

## Current Limits

| Item | Current state |
|---|---|
| owner query interpretation | still depends on LLM reply composition |
| summary refresh cadence | nightly only |
| availability snapshots | generic 30-minute openings, not service-duration specific |
| top-customer naming | summary table stores customer IDs, not denormalized names |
| relationship views | not started in this stage |
| training event schema and pipeline capture | implemented in follow-up | `db/migrations/093_ai_training_events.sql`, `src/lib/ai/training-events.ts`, `src/lib/whatsapp/v2/pipeline.ts` |

## Recommended Next Sequence

1. Add canonical `cancelReservation` and `rescheduleReservation` services.
2. Route modify/cancel actions through those services.
3. Add `ai_training_events` capture around the front-desk pipeline.
4. Add Stage C relationship views for retention and follow-up intelligence.

## Verification

| Check | Result |
|---|---|
| `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` | passed |
