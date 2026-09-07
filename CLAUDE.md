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

PostgreSQL via Supabase with multi-tenant support. Identity is `auth.users` (Supabase-owned auth) + `public.tenant_users` (membership + role) — there is **no** `public.users` or `public.profiles` table. Key tables: `tenants`, `tenant_users`, `reservations` (canonical appointments; the `/api/bookings` routes are a facade over it), `messages`, `transactions`. Migrations in `db/migrations/`.

### Self-review

`.claude/agents/booka-self-review.md` is a repo-specific self-review agent that hunts this codebase's recurring bug classes (ghost tables/columns/routes, auth fragility, tenant-scope/RLS mistakes, hardcoded currency, unstable-hook render loops, internal-ID leaks) and verifies findings against the real schema. Use it after changes to API routes, hooks, DB queries, dashboards, or money display, and before preparing a migration.

## Multi-session collaboration (READ — applies to every agent/session)

This repo is worked on by **multiple concurrent agent sessions**. To avoid clobbering each other:

- **One worktree per branch.** The repo already runs several git worktrees (`git worktree list`). Do your work in the worktree for your branch. **Never `git checkout`/`git switch` in a working dir another session may share** — it yanks the branch out from under them.
- **Cross-branch work uses a throwaway worktree**, never a checkout in place: `git worktree add --detach <scratch> origin/<branch>` → cherry-pick/commit → `git push origin HEAD:<branch>` → `git worktree remove <scratch>`. This is how bug fixes get promoted onto `staging` without disturbing anyone.
- **`git fetch origin` at the start of every task** (and whenever the user says another agent touched something). A session's git context is a snapshot from when it started and never auto-refreshes — fetch is the only way to see others' pushed commits.
- **Push small and often.** Unpushed local commits are invisible to other sessions. `staging` is the deploy branch; `feature/techclave-showcase` is a separate public `/showcase` marketing site, quarantined from Booka's data layer — do not mix its commits into product fixes.

### Schema is the source of truth — ground every query

The live DB has **drifted from the migrations** — columns the code/baseline expect can be absent on live (this is a recurring 500 source). Rules:

- Authoritative column truth: **`db/schema/live_schema_2026-07-30.md`** (a live `information_schema` dump). It is INCOMPLETE — it omits the products/retail/inventory/observability subsystems, which exist via migration. For those, read the migrations.
- **Two migration dirs**: `db/migrations/` AND `supabase/migrations/`. Check both for whether a table/column exists.
- **`reservations`** has no `phone`/`customer_name`/`customer_email`/`customer_phone`/`staff_user_id`/`updated_at`. The phone is **`customer_number`**, name/email live in **`metadata`**, the staff ref is **`staff_id`** (holds a `tenant_users.user_id`).
- **Staff = `tenant_users` with role ≠ `owner`** (staff or manager). There is no `staff` table. Any `staff_id`/`staff_user_id` value must be a non-owner tenant member; validate/select with `.neq('role','owner')`, not `.eq('role','staff')` (which wrongly excludes managers).
- Migrations are plaintext, idempotent, RLS-aware, validated in a throwaway `postgres:16-alpine` container. **The user runs migrations** on the VPS — never run them against the real DB.
