# AI Front Desk Upgrade Gap Analysis

Date: 2026-06-23

## Goal

Move Booka from a booking assistant into a deterministic AI front desk platform with:

- intent routing before LLM use
- grounded context retrieval
- compact context building
- provider independence
- validated actions only
- precomputed intelligence for owner queries
- deterministic relationship intelligence
- training-event capture for future model work

## Current Strengths Already Present

| Capability | Current Repo State |
|---|---|
| Rules-first message handling | `src/lib/ai/rulesEngine.ts` |
| Existing intent detector | `src/lib/intentDetector.ts` |
| Provider fallback logic | `src/lib/google-ai.ts`, `src/lib/openrouter.ts`, `src/lib/whatsapp/v2/pipeline.ts` |
| Action validation | `src/lib/whatsapp/v2/actionValidator.ts` |
| Slot computation and locking | `src/lib/whatsapp/v2/slotEngine.ts`, `src/lib/doubleBookingPrevention.ts` |
| Reservation write center | `src/lib/reservationService.ts` |
| v2 queue worker | `src/app/api/worker/whatsapp/route.ts` |
| Nightly aggregation job | `src/app/api/cron/nightly/route.ts` |
| LLM usage and wallet tracking | `src/lib/llmUsageTracker.ts`, `src/lib/ai/quotaTracker.ts`, `db/migrations/077_ai_wallets.sql` |

## Main Gaps

| Target Layer | Gap |
|---|---|
| Intent Router | current intent detection is broad and mixed with provider calls; there is no explicit front-door router module for the whole front desk |
| Grounding Service | prompt building still fetches broad raw business context directly inside the pipeline |
| Context Builder | there is no compact normalized context object produced from grounded data |
| Provider Abstraction | provider choice exists, but not as one clean AI provider interface used by the front-desk path |
| Action Validator | exists, but is under `whatsapp/v2` instead of being a front-desk-wide domain validator |
| Summary Tables | only `insights_daily` exists; the richer summary layer from the target document is missing |
| Relationship Intelligence | mostly missing as SQL views/materialized views |
| Training Event Capture | missing as one explicit `ai_training_events` pipeline |

## Recommended Build Order

### Phase 1

1. Introduce a true front-desk request pipeline:
   `Intent Router -> Grounding Service -> Context Builder -> AI Provider -> Action Validator -> Reservation/Domain Services`

2. Move the v2 WhatsApp pipeline onto that structure incrementally rather than rewriting it.

3. Keep deterministic business truth in services and validators.

### Phase 2

1. Add summary tables and nightly jobs.
2. Route owner analytics queries to summaries first.

### Phase 3

1. Add relationship views.
2. Add training-event capture.

## New Canonical Modules To Add

| File | Purpose |
|---|---|
| `src/lib/ai/intent-router.ts` | rules-first routing into front-desk intents |
| `src/lib/ai/grounding-service.ts` | intent-scoped data retrieval only |
| `src/lib/ai/context-builder.ts` | compact context assembly |
| `src/lib/ai/providers/index.ts` | vendor-neutral completion interface |
| `src/lib/booking/action-validator.ts` | domain-level validator used across channels |
| `src/lib/frontdesk/training-events.ts` | capture and store front-desk interaction traces |

## Where To Integrate First

| Entry Point | Why |
|---|---|
| `src/lib/whatsapp/v2/pipeline.ts` | this is already the best operational entry point for the AI front desk |
| `src/app/api/worker/whatsapp/route.ts` | current queue worker that drives the pipeline |
| `src/app/api/cron/nightly/route.ts` | existing place to add summary generation jobs |

## Retrieval Links

| Topic | Path |
|---|---|
| Main subsystem map | [subsystem-map.md](/home/ccemeka/Techclave/Booking/Booking/docs/architecture/subsystem-map.md) |
| Front desk gap analysis | [ai-front-desk-upgrade-gap-analysis.md](/home/ccemeka/Techclave/Booking/Booking/docs/architecture/ai-front-desk-upgrade-gap-analysis.md) |
| Engineering review | [../reviews/2026-06-23-second-pass.md](/home/ccemeka/Techclave/Booking/Booking/docs/reviews/2026-06-23-second-pass.md) |
