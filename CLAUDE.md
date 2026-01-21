# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
# Development server
npm run dev

# Production build
npm run build

# Start production server
npm start

# Linting
npm run lint

# Testing
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report

# Database migrations (requires DATABASE_URL env var)
psql $DATABASE_URL -f db/migrations/0001_init.sql
psql $DATABASE_URL -f db/seeds/seed_sample.sql
```

## Architecture Overview

This is **Boka**, a multi-tenant booking/reservation platform built with Next.js 16 (App Router), React 19, Supabase, and TypeScript.

### Directory Structure

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components organized by feature domain
- `src/lib/` - Business logic, services, and utilities
- `src/hooks/` - Custom React hooks (useBooking, useStaff, useServices, etc.)
- `src/types/` - Consolidated TypeScript types (canonical source of truth)
- `src/store/` - Zustand state management
- `src/middleware/` - Middleware orchestration system
- `db/` - PostgreSQL migrations and seeds

### Key Patterns

**Unified Route Handler**: All API routes use `createHttpHandler` from `src/lib/error-handling/route-handler.ts`:
```typescript
export const GET = createHttpHandler(
  async (ctx) => { /* handler logic */ },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
```

**Middleware Orchestrator**: Composable middleware chain at `src/middleware/unified/orchestrator.ts` with priority-based execution.

**Supabase Clients**: Factory functions in `src/lib/supabase/`:
- `getSupabaseServerComponentClient()` - Server components
- `getSupabaseRouteHandlerClient()` - API routes
- `createSupabaseAdminClient()` - Admin operations (service role)
- `getSupabaseBrowserClient()` - Browser (singleton)

### Role-Based Access Control

Four-tier hierarchy (lower number = higher privilege):
- **superadmin** (0) - Platform-wide access
- **owner** (1) - Tenant admin, tenant-scoped
- **manager** (2) - Team-scoped operations
- **staff** (3) - Personal access only

Role configuration in `src/lib/permissions/unified-permissions.ts`. Protected routes defined in `src/middleware.ts`.

### Type System

Canonical type definitions in `src/types/`:
- `index.ts` - Main exports for roles/permissions
- `auth.ts` - Authentication types (UnifiedAuthContext, AuthSession, etc.)
- `roles.ts` - Role definitions and utilities

### API Routes Structure

Routes organized by domain under `src/app/api/`:
- `/api/auth/*` - Authentication
- `/api/bookings/*`, `/api/reservations/*` - Booking management
- `/api/customers/*` - Customer data
- `/api/staff/*` - Staff management
- `/api/payments/*` - Stripe/Paystack integration
- `/api/webhooks/*` - External webhook handlers
- `/api/health` - Health check endpoint

### External Integrations

- **Supabase** - PostgreSQL database and auth
- **Stripe/Paystack** - Payment processing
- **SendGrid** - Email
- **Twilio** - SMS/voice
- **Evolution API** - WhatsApp
- **Google Calendar** - Calendar sync
- **OpenTelemetry** - Observability (disabled in dev)

### State Management

- **Zustand**: `src/store/useAppStore.ts`
- **React Query**: Server state, configured at `src/lib/queryClient.ts`
- **Supabase Realtime**: Live updates via custom hooks

### Database

PostgreSQL via Supabase with multi-tenant support. Key tables: `tenants`, `users`, `tenant_users`, `reservations`, `messages`, `transactions`. Migrations in `db/migrations/`.
