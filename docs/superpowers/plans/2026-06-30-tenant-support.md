# Tenant Customer Support — Implementation Plan

> **For the implementer (Codex):** TDD per task. Stage only each task's files via `git commit -- <paths>`;
> never `git add -A`. Before committing, `git status --short` and skip column-1 `M`/`A` (other sessions).

**Spec:** `docs/superpowers/specs/2026-06-30-tenant-support-design.md`
**Goal:** Complete the in-app support feature whose tables are referenced (RLS 052, superadmin
open-ticket count, off-boarding purge) but never created. Tenants open tickets to Boka; superadmin
responds.

**Repo conventions:** Jest + ts-jest + jsdom, `@jest/globals`, `@/`→`src/`. API: `createHttpHandler`,
`ApiErrorFactory`, `createSupabaseAdminClient`, `ctx.user?.{id,tenantId}`. User ids are UUID
`auth.users(id)` (`ctx.user.id`). Mock-admin test pattern: chainable builder recording ops (see
`src/lib/dsar/*.test.ts`). Dashboard components use `authGet/authPost` (see `MentionsFeed`).

---

## Task 1 — Migration

**Files:** Create `db/migrations/NNN_support_tickets.sql` — **pick the next free number at build time**
(`ls db/migrations | grep -oE '^[0-9]+' | sort -n | tail -1`; a concurrent session is past 117).
Column names match migration 052's RLS (`assigned_to`/`assigned_by`).

```sql
-- NNN_support_tickets.sql — completes the referenced support schema. Idempotent.
CREATE TABLE IF NOT EXISTS support_tickets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  subject    TEXT        NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','pending','resolved','closed')),
  priority   TEXT        NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high')),
  created_by UUID        REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_status
  ON support_tickets (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID        REFERENCES auth.users(id),
  author_role    TEXT        NOT NULL CHECK (author_role IN ('tenant','support')),
  body           TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS support_assignments (
  ticket_id   UUID        NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  assigned_to UUID        REFERENCES auth.users(id),
  assigned_by UUID        REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id)
);

ALTER TABLE support_tickets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages  ENABLE ROW LEVEL SECURITY;
-- support_assignments RLS already enabled in migration 052.

-- service_role full access (the API routes use the admin client).
DROP POLICY IF EXISTS support_tickets_service ON support_tickets;
CREATE POLICY support_tickets_service ON support_tickets FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS support_messages_service ON support_messages;
CREATE POLICY support_messages_service ON support_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Manual fallback: all statements above are idempotent.
```

- [ ] **Commit** `git commit -- db/migrations/NNN_support_tickets.sql -m "feat(support): support tickets/messages/assignments tables"`

---

## Task 2 — Tickets lib (TDD, mock admin)

**Files:** Create `src/lib/support/tickets.ts`, `…/tickets.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { createTicket, addMessage, listTickets, getTicketThread, setTicketStatus } from '@/lib/support/tickets';

function makeAdmin(rows: Record<string, unknown[]> = {}) {
  const ops: Array<{ table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> }> = [];
  const admin = {
    from(table: string) {
      const op = { table, kind: '', payload: undefined as unknown, filters: [] as Array<[string, unknown]> };
      ops.push(op);
      const b: Record<string, unknown> = {
        insert(p: unknown) { op.kind = 'insert'; op.payload = p; return b; },
        update(p: unknown) { op.kind = 'update'; op.payload = p; return b; },
        select() { op.kind ||= 'select'; return b; },
        eq(c: string, v: unknown) { op.filters.push([c, v]); return b; },
        order() { return b; },
        single() { return Promise.resolve({ data: (rows[table] ?? [])[0] ?? { id: 'tk1' }, error: null }); },
        maybeSingle() { return Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }); },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  return { admin: admin as never, ops };
}

describe('support/tickets', () => {
  it('createTicket inserts a ticket + first tenant message', async () => {
    const { admin, ops } = makeAdmin({ support_tickets: [{ id: 'tk1' }] });
    const id = await createTicket(admin, { tenantId: 't1', createdBy: 'u1', subject: 'help', body: 'broken' });
    expect(id).toBe('tk1');
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'insert')?.payload)
      .toMatchObject({ tenant_id: 't1', subject: 'help', status: 'open', created_by: 'u1' });
    expect(ops.find((o) => o.table === 'support_messages' && o.kind === 'insert')?.payload)
      .toMatchObject({ ticket_id: 'tk1', author_role: 'tenant', body: 'broken', author_user_id: 'u1' });
  });

  it('addMessage inserts and bumps ticket updated_at', async () => {
    const { admin, ops } = makeAdmin();
    await addMessage(admin, { ticketId: 'tk1', authorUserId: 'u2', authorRole: 'support', body: 'on it' });
    expect(ops.find((o) => o.table === 'support_messages' && o.kind === 'insert')?.payload)
      .toMatchObject({ ticket_id: 'tk1', author_role: 'support', body: 'on it' });
    expect(ops.some((o) => o.table === 'support_tickets' && o.kind === 'update')).toBe(true);
  });

  it('getTicketThread is tenant-scoped', async () => {
    const { admin, ops } = makeAdmin({ support_tickets: [{ id: 'tk1', tenant_id: 't1' }], support_messages: [{ id: 'm1' }] });
    const thread = await getTicketThread(admin, { ticketId: 'tk1', tenantId: 't1' });
    expect(thread?.ticket).toMatchObject({ id: 'tk1' });
    expect(thread?.messages).toEqual([{ id: 'm1' }]);
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'select')?.filters)
      .toEqual(expect.arrayContaining([['id', 'tk1'], ['tenant_id', 't1']]));
  });

  it('setTicketStatus updates the row', async () => {
    const { admin, ops } = makeAdmin();
    await setTicketStatus(admin, { ticketId: 'tk1', status: 'resolved' });
    expect(ops.find((o) => o.table === 'support_tickets' && o.kind === 'update')?.payload)
      .toMatchObject({ status: 'resolved' });
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type AuthorRole = 'tenant' | 'support';

export async function createTicket(
  admin: SupabaseClient,
  p: { tenantId: string; createdBy: string; subject: string; body: string; priority?: 'low' | 'normal' | 'high' },
): Promise<string> {
  const { data } = await admin
    .from('support_tickets')
    .insert({ tenant_id: p.tenantId, subject: p.subject, status: 'open', priority: p.priority ?? 'normal', created_by: p.createdBy })
    .select('id')
    .single();
  const id = (data as { id: string }).id;
  await admin.from('support_messages').insert({ ticket_id: id, author_user_id: p.createdBy, author_role: 'tenant', body: p.body });
  return id;
}

export async function addMessage(
  admin: SupabaseClient,
  p: { ticketId: string; authorUserId: string; authorRole: AuthorRole; body: string },
): Promise<void> {
  await admin.from('support_messages').insert({ ticket_id: p.ticketId, author_user_id: p.authorUserId, author_role: p.authorRole, body: p.body });
  await admin.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', p.ticketId);
}

export async function listTickets(admin: SupabaseClient, p: { tenantId?: string; status?: TicketStatus }): Promise<unknown[]> {
  let q = admin.from('support_tickets').select('*');
  if (p.tenantId) q = q.eq('tenant_id', p.tenantId);
  if (p.status) q = q.eq('status', p.status);
  const { data } = await q.order('created_at', { ascending: false });
  return (data as unknown[]) ?? [];
}

export async function getTicketThread(
  admin: SupabaseClient,
  p: { ticketId: string; tenantId?: string },
): Promise<{ ticket: unknown; messages: unknown[] } | null> {
  let tq = admin.from('support_tickets').select('*').eq('id', p.ticketId);
  if (p.tenantId) tq = tq.eq('tenant_id', p.tenantId);
  const { data: ticket } = await tq.maybeSingle();
  if (!ticket) return null;
  const { data: messages } = await admin.from('support_messages').select('*').eq('ticket_id', p.ticketId).order('created_at', { ascending: true });
  return { ticket, messages: (messages as unknown[]) ?? [] };
}

export async function setTicketStatus(admin: SupabaseClient, p: { ticketId: string; status: TicketStatus }): Promise<void> {
  await admin.from('support_tickets').update({ status: p.status, updated_at: new Date().toISOString() }).eq('id', p.ticketId);
}

export async function assignTicket(admin: SupabaseClient, p: { ticketId: string; assignedTo: string; assignedBy: string }): Promise<void> {
  await admin.from('support_assignments').upsert(
    { ticket_id: p.ticketId, assigned_to: p.assignedTo, assigned_by: p.assignedBy, assigned_at: new Date().toISOString() },
    { onConflict: 'ticket_id' },
  );
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `git commit -- src/lib/support/tickets.ts src/lib/support/tickets.test.ts -m "feat(support): tickets lib"`

---

## Task 3 — Tenant API routes

**Files:** Create `src/app/api/support/tickets/route.ts`, `…/[id]/route.ts`

- [ ] **`tickets/route.ts`**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { listTickets, createTicket, type TicketStatus } from '@/lib/support/tickets';

const STATUSES = ['open', 'pending', 'resolved', 'closed'];

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in context');
    const raw = new URL(ctx.request.url).searchParams.get('status');
    const status = STATUSES.includes(raw ?? '') ? (raw as TicketStatus) : undefined;
    const admin = createSupabaseAdminClient();
    return { success: true, tickets: await listTickets(admin, { tenantId, status }) };
  },
  'GET', { auth: true, roles: ['owner', 'manager', 'staff'] },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    const createdBy = ctx.user?.id;
    if (!tenantId || !createdBy) throw ApiErrorFactory.forbidden('No tenant/user in context');
    const body = await parseJsonBody<{ subject?: string; body?: string; priority?: 'low' | 'normal' | 'high' }>(ctx.request).catch(() => ({}));
    if (!body.subject?.trim() || !body.body?.trim()) throw ApiErrorFactory.validationError({ subject: 'subject and body are required' });
    const admin = createSupabaseAdminClient();
    const id = await createTicket(admin, { tenantId, createdBy, subject: body.subject.trim(), body: body.body.trim(), priority: body.priority });
    return { success: true, id };
  },
  'POST', { auth: true, roles: ['owner', 'manager', 'staff'] },
);
```

- [ ] **`tickets/[id]/route.ts`**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTicketThread, addMessage } from '@/lib/support/tickets';

export const GET = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id; const tenantId = ctx.user?.tenantId;
    if (!id || !tenantId) throw ApiErrorFactory.validationError({ id: 'id + tenant required' });
    const thread = await getTicketThread(createSupabaseAdminClient(), { ticketId: id, tenantId });
    if (!thread) throw ApiErrorFactory.notFound('Ticket');
    return { success: true, ...thread };
  },
  'GET', { auth: true, roles: ['owner', 'manager', 'staff'] },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id; const tenantId = ctx.user?.tenantId; const userId = ctx.user?.id;
    if (!id || !tenantId || !userId) throw ApiErrorFactory.validationError({ id: 'id + tenant + user required' });
    const body = await parseJsonBody<{ body?: string }>(ctx.request).catch(() => ({}));
    if (!body.body?.trim()) throw ApiErrorFactory.validationError({ body: 'body is required' });
    const admin = createSupabaseAdminClient();
    const thread = await getTicketThread(admin, { ticketId: id, tenantId }); // tenant-guard
    if (!thread) throw ApiErrorFactory.notFound('Ticket');
    await addMessage(admin, { ticketId: id, authorUserId: userId, authorRole: 'tenant', body: body.body.trim() });
    return { success: true };
  },
  'POST', { auth: true, roles: ['owner', 'manager', 'staff'] },
);
```

- [ ] **Commit** `git commit -- src/app/api/support/tickets/route.ts "src/app/api/support/tickets/[id]/route.ts" -m "feat(support): tenant ticket API (list/create/thread/reply)"`

---

## Task 4 — Superadmin API

**Files:** Create `src/app/api/superadmin/support/route.ts`

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { listTickets, addMessage, setTicketStatus, assignTicket, type TicketStatus } from '@/lib/support/tickets';

const STATUSES = ['open', 'pending', 'resolved', 'closed'];

export const GET = createHttpHandler(
  async (ctx) => {
    const raw = new URL(ctx.request.url).searchParams.get('status');
    const status = STATUSES.includes(raw ?? '') ? (raw as TicketStatus) : undefined;
    return { success: true, tickets: await listTickets(createSupabaseAdminClient(), { status }) }; // no tenant filter
  },
  'GET', { auth: true, roles: ['superadmin'] },
);

export const POST = createHttpHandler(
  async (ctx) => {
    const userId = ctx.user?.id;
    const body = await parseJsonBody<{ action?: string; ticketId?: string; status?: TicketStatus; assignedTo?: string; reply?: string }>(ctx.request).catch(() => ({}));
    if (!body.ticketId) throw ApiErrorFactory.validationError({ ticketId: 'ticketId required' });
    const admin = createSupabaseAdminClient();
    if (body.action === 'reply' && body.reply?.trim()) {
      await addMessage(admin, { ticketId: body.ticketId, authorUserId: userId ?? '', authorRole: 'support', body: body.reply.trim() });
    } else if (body.action === 'status' && body.status) {
      await setTicketStatus(admin, { ticketId: body.ticketId, status: body.status });
    } else if (body.action === 'assign' && body.assignedTo) {
      await assignTicket(admin, { ticketId: body.ticketId, assignedTo: body.assignedTo, assignedBy: userId ?? '' });
    } else {
      throw ApiErrorFactory.validationError({ action: "action must be 'reply' | 'status' | 'assign'" });
    }
    return { success: true };
  },
  'POST', { auth: true, roles: ['superadmin'] },
);
```

> Confirm `'superadmin'` is the role string used by `createHttpHandler`'s role gate (CLAUDE.md lists
> superadmin as the platform role). If the codebase uses a different superadmin check, match it.

- [ ] **Commit** `git commit -- src/app/api/superadmin/support/route.ts -m "feat(support): superadmin ticket API (list/reply/status/assign)"`

---

## Task 5 — Tenant UI

**Files:** Create `src/components/support/TicketList.tsx`, `TicketThread.tsx`, `src/app/dashboard/support/page.tsx` (+ a `TicketList.test.tsx`)

- [ ] **TicketList** — `authGet('/api/support/tickets')` → render list; a "New ticket" form (subject + body) → `authPost('/api/support/tickets', { subject, body })` → reload; clicking a ticket calls `onOpen(id)`.
- [ ] **TicketThread** — `authGet('/api/support/tickets/${id}')` → render ticket + messages; reply box → `authPost('/api/support/tickets/${id}', { body })` → reload.
- [ ] **page.tsx**

```tsx
export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import SupportClient from '@/components/support/SupportClient'; // small client wrapper holding TicketList + TicketThread state

export default async function SupportPage() {
  await requireAuth(['owner', 'manager', 'staff']);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Support</h1>
      <p className="text-sm text-gray-600">Get help from the Boka team.</p>
      <div className="mt-6"><SupportClient /></div>
    </div>
  );
}
```

- [ ] **Test** (`TicketList.test.tsx`): mocked `authGet/authPost` — loads tickets; submitting the form posts a new ticket. Mirror `MentionsFeed.test.tsx`.
- [ ] **Commit** `git commit -- src/components/support/ src/app/dashboard/support/page.tsx -m "feat(support): tenant support UI (tickets + thread)"`

---

## Task 6 — Superadmin support queue

**Files:** Create `src/components/superadmin/SupportQueue.tsx` (+ test); mount in the superadmin dashboard page.

- [ ] `SupportQueue` — `authGet('/api/superadmin/support?status=open')` → list; open a ticket (reuse the thread view, or a superadmin thread reading `/api/support/tickets/[id]` won't pass tenant guard — add a superadmin thread read in Task 4 if needed, or have superadmin GET accept `ticketId`). Reply → `authPost('/api/superadmin/support', { action:'reply', ticketId, reply })`; status/assign similarly.
- [ ] The existing `support_tickets WHERE status='open'` count in `superadmin/dashboard` now resolves (tables exist) — verify it stops warning.
- [ ] **Commit** `git commit -- src/components/superadmin/SupportQueue.tsx src/app/<superadmin-dashboard-page> -m "feat(support): superadmin support queue"`

> GAP to close in T4/T6: superadmin needs to READ a ticket thread without the tenant guard. Add a
> superadmin thread endpoint (e.g. `GET /api/superadmin/support/[id]` calling `getTicketThread` with
> no `tenantId`) OR extend the superadmin GET to return a single thread when `?ticketId=` is present.
> Implement whichever fits; the tenant `getTicketThread({ tenantId })` must stay tenant-scoped.

---

## Self-review checklist
- `npx jest src/lib/support src/components/support` green.
- `npm run typecheck` clean for `support` / `api/support` / `api/superadmin/support`.
- Tenant routes are tenant-scoped (`getTicketThread({tenantId})`); superadmin routes are not, and are
  `roles:['superadmin']`.
- Migration uses the next free number; column names match 052 (`assigned_to`/`assigned_by`).
- Superadmin open-ticket count no longer warns.
- Every commit staged only its own paths.
