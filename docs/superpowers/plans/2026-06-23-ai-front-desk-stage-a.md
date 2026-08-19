# AI Front Desk Stage A

## Scope

Stage A converts the current WhatsApp v2 path from a large prompt-builder into an explicit front-desk pipeline:

`pipeline -> intent router -> grounding service -> context builder -> provider -> action validator -> domain service`

## Implemented On 2026-06-23

| Area | Status | Path |
|---|---|---|
| Intent router | implemented | `src/lib/ai/intent-router.ts` |
| Grounding service | implemented | `src/lib/ai/grounding-service.ts` |
| Context builder | implemented | `src/lib/ai/context-builder.ts` |
| Provider abstraction | implemented | `src/lib/ai/providers/index.ts` |
| Domain validator | implemented | `src/lib/booking/action-validator.ts` |
| v2 pipeline wiring | implemented | `src/lib/whatsapp/v2/pipeline.ts` |
| flow import migration | implemented | `src/lib/whatsapp/v2/flows/customerBooking.ts`, `src/lib/whatsapp/v2/flows/ownerCommands.ts` |

## Current Architectural Center

| Concern | Current center |
|---|---|
| Front-desk orchestration | `src/lib/whatsapp/v2/pipeline.ts` |
| Intent classification | `src/lib/ai/intent-router.ts` |
| Truth retrieval | `src/lib/ai/grounding-service.ts` |
| Prompt compaction | `src/lib/ai/context-builder.ts` |
| Model/provider selection | `src/lib/ai/providers/index.ts` |
| Action validation | `src/lib/booking/action-validator.ts` |
| Reservation writes | `src/lib/reservationService.ts` |

## What Stage A Does Not Finish

| Item | Remaining work |
|---|---|
| owner analytics summaries | add dedicated summary tables and nightly refresh jobs |
| relationship intelligence | add SQL views for follow-up and loyalty analysis |
| training event capture | add `ai_training_events` table and pipeline capture |
| full validator migration | completed in follow-up on 2026-06-23 |
| canonical modify/cancel path | add domain services for reschedule and cancel |

## Recommended Next Sequence

1. Add `cancelReservation` and `rescheduleReservation` domain services.
2. Add summary-table migrations and extend nightly cron.
3. Route owner-query grounding to summary tables before live booking queries.
4. Add `ai_training_events` capture around intent, grounding, action, and outcome.

## Verification

| Check | Result |
|---|---|
| `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` | passed |
