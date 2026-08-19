# Subsystem Map

## Product Surface

- Public web entry points: `src/app`, especially `src/app/book`, `src/app/booka`, `src/app/products`
- Auth and onboarding UX: `src/app/auth`, `src/app/booka/auth`
- Internal dashboards: `src/app/dashboard`, `src/components/dashboard`, `src/components/analytics`

## API Layer

- Route handlers live under `src/app/api`
- Canonical wrapper for new API work: `src/lib/error-handling/route-handler.ts`
- Responsibilities handled there:
  - bearer-token verification
  - tenant membership validation
  - role and permission gates
  - consistent error responses

## Auth and Tenant Isolation

- Page/server-component auth: `src/lib/auth/server-auth.ts`
- Middleware auth resolution: `src/middleware/unified/auth/auth-handler.ts`
- API auth enforcement: `src/lib/error-handling/route-handler.ts`

### Canonical Rule

- Use `createHttpHandler` / `createApiHandler` for API routes
- Use `requireAuth` from `src/lib/auth/server-auth.ts` for page-level server rendering
- Do not add new ad hoc auth flows in route files

## Booking and Reservation Domain

- HTTP booking entry point: `src/app/api/bookings/route.ts`
- Canonical reservation write path for API/server flows: `src/lib/reservationService.ts`
- Legacy/extended orchestration path: `src/lib/booking/engine.ts`
- Chat-driven booking bridge: `src/lib/dialogBookingBridge.ts`
- Conflict detection and locking: `src/lib/doubleBookingPrevention.ts`
- Staff assignment: `src/lib/staffRouting.ts`

### Canonical Rule

- New HTTP and backend booking writes should flow through `createReservation`
- `BookingEngine` remains transitional for richer conversational orchestration until it is reduced onto the same write path

## Payments

- Higher-level lifecycle orchestration: `src/lib/payments/lifecycle.ts`
- Provider and transaction handling: `src/lib/paymentService.ts`, `src/lib/paystack.ts`
- Security/fraud helpers: `src/lib/paymentSecurityService.ts`

### Risk

- Payment behavior is split across multiple modules with overlapping responsibilities
- The lifecycle layer is more structured than some of the older provider/service code, so that should be the convergence target

## Messaging and AI

- Legacy WhatsApp processor: `src/lib/whatsapp/messageProcessor.ts`
- Newer v2 orchestration: `src/lib/whatsapp/v2/pipeline.ts`
- Provider abstraction: `src/lib/whatsapp/providers/*`
- Dialog/chat integration: `src/lib/dialog*`

### Canonical Rule

- Prefer v2 pipeline and provider abstractions for new messaging work
- Treat the older processor as compatibility code unless actively refactoring it

## Events and Background Work

- Canonical event bus: `src/lib/eventbus/eventBus.ts`
- Legacy compatibility facade: `src/lib/eventBus.ts`
- Worker queue infrastructure: `src/lib/worker/queue.ts`
- Worker scripts: `src/worker`, `scripts/whatsapp-worker.mjs`

### Canonical Rule

- Import the shared bus through `getEventBus()`
- Avoid new `EventBusService()` instances except where a truly isolated bus is required

## Observability and Operations

- Logging: `src/lib/logger/*`
- Tracing/metrics: `src/lib/observability/*`, `src/lib/metrics.ts`
- Deployment: `deployment/*`
- Runbooks and ops docs: `docs/runbooks`, `docs/operations-guide.md`
