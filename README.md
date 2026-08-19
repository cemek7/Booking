# Boka / Techclave

Multi-tenant booking and customer-operations platform built with Next.js, Supabase, Redis, and a WhatsApp/Instagram automation layer.

This repo is one application with several responsibilities:

- Product surface: public booking, dashboards, onboarding, analytics, settings
- Domain services: bookings, reservations, payments, staff routing, reminders
- Messaging: WhatsApp/Instagram provider integrations and AI-assisted flows
- Platform concerns: auth, tenant isolation, observability, queues, offboarding

## Stack

- Next.js 16 + React 19
- TypeScript + Tailwind CSS 4
- Supabase (Postgres, auth, RLS)
- Redis + BullMQ
- Stripe + Paystack
- Sentry + OpenTelemetry + Prometheus-style metrics

## Current Architecture Center

The repo contains legacy paths and newer centralized wrappers. For new work, use these as the canonical entry points:

- API auth and tenant enforcement: `src/lib/error-handling/route-handler.ts`
- Server-rendered page auth: `src/lib/auth/server-auth.ts`
- Reservation creation from HTTP/API flows: `src/lib/reservationService.ts`
- Shared event publication: `src/lib/eventbus/eventBus.ts` via `getEventBus()`

Avoid introducing new direct imports of legacy compatibility modules unless you are maintaining existing behavior.

## Main Areas

- App routes: `src/app`
- API routes: `src/app/api`
- Core libraries: `src/lib`
- Middleware: `src/middleware`, `src/middleware/unified`
- UI components: `src/components`
- Database migrations: `db/migrations`
- Deployment assets: `deployment`
- Tests: `tests`, `src/__tests__`

## Local Development

```bash
npm install
npm run dev
```

Important scripts:

- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run test:integration`
- `npm run worker`

## Key Docs

- Repo docs index: [docs/README.md](/home/ccemeka/Techclave/Booking/Booking/docs/README.md)
- Architecture map: [docs/architecture/subsystem-map.md](/home/ccemeka/Techclave/Booking/Booking/docs/architecture/subsystem-map.md)
- Second-pass review: [docs/reviews/2026-06-23-second-pass.md](/home/ccemeka/Techclave/Booking/Booking/docs/reviews/2026-06-23-second-pass.md)

## Notes

- This repo currently contains a large amount of historical implementation and audit documentation.
- Legacy reports are being moved under `docs/reports/legacy-top-level/` so the repo root stays focused on the active codebase.
