# Second Pass Review

Date: 2026-06-23

## Architecture Map by Subsystem

- Product/UI: strong surface area, clear product direction, broad internal tooling
- API layer: mostly converged on `createHttpHandler`, which is the best existing architectural center for backend access control
- Booking domain: split between `createReservation` and `BookingEngine`
- Auth domain: split between page auth, middleware auth, and historical unified-auth utilities
- Messaging: split between older WhatsApp processor and newer v2 pipeline
- Events: canonical bus exists, but the codebase still uses a legacy facade and multiple direct bus instantiations

## Code-Quality Hotspots

### 1. Booking duplication

- `src/app/api/bookings/route.ts` writes through `createReservation`
- `src/lib/booking/engine.ts` implements a parallel booking lifecycle with its own validation, payment handling, and event publication
- `src/lib/dialogBookingBridge.ts` still depends on `BookingEngine`

Impact:

- behavior can drift between API booking and conversational booking
- fixes in one path do not guarantee fixes in the other

### 2. Auth fragmentation

- API routes are centered on `src/lib/error-handling/route-handler.ts`
- page-level auth is centered on `src/lib/auth/server-auth.ts`
- historical “unified auth” utilities still exist in `src/types/unified-auth.ts`

Impact:

- naming suggests one source of truth, but enforcement is still spread across layers
- easier to introduce subtle tenant/role inconsistencies

### 3. Event bus duplication

- canonical implementation: `src/lib/eventbus/eventBus.ts`
- compatibility wrapper: `src/lib/eventBus.ts`
- multiple modules instantiate `new EventBusService()` directly

Impact:

- more lifecycle complexity than needed
- harder to reason about processing ownership and initialization

### 4. Type-system blind spots in core logic

- `src/lib/reservationService.ts` had `@ts-nocheck`
- `src/lib/booking/engine.ts` still has `@ts-nocheck`
- `src/lib/whatsapp/messageProcessor.ts` still has `@ts-nocheck`
- `src/lib/worker/queue.ts` still has `@ts-nocheck`

Impact:

- weakens the value of strict TypeScript in the most failure-prone code

## Launch Readiness / Production Risk

### Strengths

- broad test surface
- serious operational intent: Redis, workers, observability, Sentry, deployment assets
- route handler wrapper already centralizes a lot of risky backend concerns

### Main Risks

- booking behavior split across multiple service paths
- payment domain responsibilities spread across multiple modules
- messaging stack has both legacy and v2 paths alive at once
- root-level documentation is noisy enough to obscure the active truth
- committed logs and build artifacts indicate repo hygiene drift

## What I’d Refactor First

### Phase 1

- make `createReservation` the default write path for all non-conversational booking writes
- keep `BookingEngine` only as a transitional orchestration layer and explicitly mark it as such
- standardize all shared event publication on `getEventBus()`
- remove `@ts-nocheck` from the core reservation path

### Phase 2

- collapse payment orchestration toward `src/lib/payments/lifecycle.ts`
- reduce direct business logic in the legacy WhatsApp processor and continue converging on `src/lib/whatsapp/v2/pipeline.ts`
- shrink historical auth helpers that overlap with the route-handler center

### Phase 3

- archive historical reports into docs folders
- keep root focused on active entry docs and plans only
