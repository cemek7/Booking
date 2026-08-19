# Tenant Customer Support — Design + Plan

**Date:** 2026-06-30 · **Task:** #15 · **Status:** Grounded design, ready for Codex.

## Repo reality (verified) — a half-scaffold already assumes in-app support

- `support_tickets`, `support_messages`, `support_assignments` are **referenced but never created** (no `CREATE TABLE` in `db/migrations`):
  - `db/migrations/052_enable_rls_remaining_tables.sql` enables RLS on `support_assignments`.
  - `src/app/api/superadmin/dashboard/route.ts` counts `support_tickets WHERE status='open'` (and *warns* on error — so it silently fails today).
  - `src/lib/offboarding/purgeWorker.ts` purges `support_tickets` by `tenant_id`, and `support_messages`/`support_assignments` by `ticket_id` (comment: "no tenant_id").
- No support API or UI exists.

**Buy-vs-build → BUILD in-app.** Repo reality decides it: the schema shape, RLS, superadmin count, and tenant-scoped purge already assume native tables. A 3rd-party helpdesk wouldn't satisfy those references or reuse our auth/tenancy. (Revisit only if support volume later demands a dedicated tool.)

**Nature of the feature:** support **for tenants** — a tenant owner/staff opens a ticket to **Boka** (superadmin/support team) who responds. This matches the superadmin open-ticket count.

## Data model (migration — use the next free number; `121` shown but **other session is at 117 and climbing, so verify the next free `NNN` at build time**)

**Grounded in migration 052's RLS comments** ("assigned_to / assigned_by are auth.users ids", "no tenant_id — scoped via support_tickets") and `ctx.user.id` (UUID `auth.users.id`):

```
support_tickets   (id UUID, tenant_id UUID FK, subject TEXT, status TEXT
                   [open|pending|resolved|closed] default 'open',
                   priority TEXT [low|normal|high] default 'normal',
                   created_by UUID REFERENCES auth.users(id), created_at, updated_at)
support_messages  (id UUID, ticket_id UUID FK->support_tickets ON DELETE CASCADE,
                   author_user_id UUID REFERENCES auth.users(id),
                   author_role TEXT [tenant|support], body TEXT, created_at)   -- NO tenant_id
support_assignments (ticket_id UUID FK->support_tickets ON DELETE CASCADE,
                   assigned_to UUID REFERENCES auth.users(id),
                   assigned_by UUID REFERENCES auth.users(id),
                   assigned_at TIMESTAMPTZ default now())   -- NO tenant_id; matches 052 RLS
```
`status='open'` default (superadmin count already queries this). Index `support_tickets(tenant_id, status, created_at DESC)`. Add tenant-scoped RLS policies matching the 052 pattern (`tenant_users` membership for tenant rows; service_role for the admin client). **052 already enabled RLS on `support_assignments` — its policies reference `assigned_to`/`assigned_by`, so use exactly those column names.**

## Architecture / files

| File | Responsibility |
|---|---|
| `db/migrations/121_support_tickets.sql` | the 3 tables (idempotent), matching referenced columns |
| `src/lib/support/tickets.ts` | `createTicket`, `addMessage`, `listTickets`, `getTicketThread`, `setTicketStatus`, `assignTicket` (admin client) |
| `src/app/api/support/tickets/route.ts` | GET (my tenant's tickets) + POST (create) — owner/manager/staff |
| `src/app/api/support/tickets/[id]/route.ts` | GET thread + POST reply (tenant-scoped) |
| `src/app/api/superadmin/support/route.ts` | GET all tickets + POST assign/status — superadmin only |
| `src/components/support/TicketList.tsx`, `TicketThread.tsx` | tenant UI |
| `src/app/dashboard/support/page.tsx` | tenant support page (owner/manager/staff) |
| `src/components/superadmin/SupportQueue.tsx` + mount in superadmin dashboard | Boka-side handling |

## Plan (TDD tasks)

**T1 — migration 121** (3 tables, idempotent). Commit.

**T2 — `support/tickets.ts` lib (TDD, mock admin).**
- `createTicket(admin, {tenantId, createdBy, subject, body, priority?})` → insert ticket (status 'open') + first `support_messages` row (author_role 'tenant'). Returns ticket id.
- `addMessage(admin, {ticketId, authorUserId, authorRole, body})` → insert message + bump `updated_at`.
- `listTickets(admin, {tenantId, status?})`, `getTicketThread(admin, {ticketId, tenantId})` (ticket + messages, tenant-guarded), `setTicketStatus`, `assignTicket`. Tests mirror `src/lib/dsar/*.test.ts` mock-admin pattern: assert insert payloads, tenant scoping (`.eq('tenant_id', …)`), and that thread reads are tenant-guarded.

**T3 — tenant API routes.**
- `GET /api/support/tickets?status=` → `listTickets({ tenantId: ctx.user.tenantId })`; `POST` → `createTicket`. Roles `owner|manager|staff`.
- `GET /api/support/tickets/[id]` → `getTicketThread` (404 if not this tenant); `POST` reply → `addMessage(authorRole:'tenant')`. Use `createHttpHandler` + `ApiErrorFactory`.

**T4 — superadmin API.** `GET /api/superadmin/support?status=` (all tickets, no tenant filter) + `POST` `{action:'assign'|'status', …}`. Roles: superadmin only (`{ auth:true, roles:['superadmin'] }`). Replies from support set `author_role:'support'`.

**T5 — tenant UI.** `TicketList` (authGet list, new-ticket form → POST) + `TicketThread` (authGet thread, reply → POST). `src/app/dashboard/support/page.tsx` `requireAuth(['owner','manager','staff'])` mounts them. Component tests with mocked `authGet/authPost` (mirror `MentionsFeed`/`ReviewModerationQueue`).

**T6 — superadmin handling.** `SupportQueue` component (list all open tickets, open thread, reply as support, set status/assign). Mount in the superadmin dashboard. The existing `support_tickets WHERE status='open'` count now resolves (tables exist).

## Out of scope (v1)
SLA timers, email notifications on ticket updates (could reuse `sendEmail`), CSAT, knowledge-base/self-serve, file attachments.

## Self-review / known gaps
- **User-id type — RESOLVED:** `ctx.user.id` is the auth user id (UUID); `escalation_queue.assigned_agent_id UUID REFERENCES auth.users(id)`; chats messages route writes `user_id: ctx.user?.id`. → all support user ids are **UUID `auth.users(id)`** (reflected above).
- **Column names — RESOLVED:** migration 052 RLS already names `support_assignments.assigned_to` / `assigned_by`; the migration must use exactly those.
- **RLS:** 052 enabled RLS on `support_assignments` (and references `support_tickets` for scoping). The new migration must add policies for `support_tickets`/`support_messages` (tenant_users membership) — otherwise authenticated reads via a non-service client are blocked. These routes use the service-role admin client, so the routes work regardless; add policies for defense-in-depth + any future anon access.
- **Notifications:** ticket reply → notify the other party. Defer (reuse `sendEmail`/AlertService) — flagged, not built in v1.
- **Superadmin reply identity:** `author_role:'support'` distinguishes Boka replies; ensure superadmin user id is captured.
