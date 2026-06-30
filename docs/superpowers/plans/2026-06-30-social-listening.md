# Social Listening — Implementation Plan

> **For the implementer (Codex):** Execute task-by-task. Each task: write the failing test, run it,
> implement, run it green, commit. Stage **only the files each task lists** via `git commit -- <paths>`
> (the repo has concurrent sessions — never `git add -A`). Before committing, run `git status --short`
> and avoid staging files with column-1 `M`/`A` (staged by others).

**Goal:** Provider-agnostic social-listening pipeline: detect tenant-name/handle mentions, store +
dedup them, notify the tenant, and convert a mention to a lead. The detection provider is chosen by a
separate spike; build against a `StubProvider` until then.

**Spec:** `docs/superpowers/specs/2026-06-30-social-listening-design.md` (model A).

**Conventions in this repo (match exactly):**
- Tests: Jest + ts-jest + jsdom; import from `@jest/globals`; `@/` → `src/`.
- API routes: `createHttpHandler(handler, METHOD, { auth, roles })` from `@/lib/error-handling/route-handler`; throw `ApiErrorFactory.*`; admin client `createSupabaseAdminClient()` from `@/lib/supabase/server`; `ctx.user?.tenantId`, `ctx.params`, `ctx.request`.
- Cron routes: raw `GET(request: NextRequest)` with `authorization === 'Bearer ${CRON_SECRET}'` else 401 (see `src/app/api/cron/status-check/route.ts`).
- Dashboard components: `authGet`/`authPost` from `@/lib/auth/auth-api-client` (returns `{ status, data }`).
- Mock-admin test pattern: a chainable builder recording ops (see `src/lib/dsar/*.test.ts`, `src/lib/moderation/reviews.test.ts`).
- Migration numbering: **`120` is a placeholder** — a concurrent session is actively adding migrations (already at 117). At build time, run `ls db/migrations | grep -oE '^[0-9]+' | sort -n | tail -1` and use the **next free number**; additive, idempotent (the repo has documented same-prefix collision hazards).

---

## Task 0 — Provider spike (research, NOT code)

Compare 2–3 aggregators (Brand24, Mentionlytics, Social Searcher, Brandwatch) on: platform coverage,
price, API quality/rate limits, mention dedup id stability. Output: a short doc
`docs/runbooks/social-listening-provider-spike.md` recommending one + adapter notes. Until done, the
build uses `StubProvider`. Does not block Tasks 1–10.

---

## Task 1 — Migration

**Files:** Create `db/migrations/120_social_listening.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 120_social_listening.sql
-- Social listening: per-tenant config + deduped mentions. Additive, idempotent.

CREATE TABLE IF NOT EXISTS tenant_listening_config (
  tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  business_name  TEXT        NOT NULL,
  handles        TEXT[]      NOT NULL DEFAULT '{}',
  keywords       TEXT[]      NOT NULL DEFAULT '{}',
  platforms      TEXT[]      NOT NULL DEFAULT '{}',
  enabled        BOOLEAN     NOT NULL DEFAULT false,
  last_polled_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_mentions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT        NOT NULL,
  external_id  TEXT        NOT NULL,
  platform     TEXT        NOT NULL,
  author       TEXT,
  url          TEXT,
  content      TEXT,
  matched_term TEXT,
  status       TEXT        NOT NULL DEFAULT 'new'
                            CHECK (status IN ('new','engaged','dismissed','converted')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_social_mentions_tenant_status
  ON social_mentions (tenant_id, status, created_at DESC);

-- Manual fallback: statements above are idempotent and safe to run by hand.
```

- [ ] **Step 2: Commit** — `git commit -- db/migrations/120_social_listening.sql -m "feat(listening): social listening tables (config + mentions)"`

---

## Task 2 — Types + provider interface + stub

**Files:** Create `src/lib/listening/types.ts`, `src/lib/listening/provider.ts`

- [ ] **Step 1: types.ts**

```typescript
export interface RawMention {
  externalId: string;
  platform: string;
  author?: string;
  url?: string;
  content?: string;
  matchedTerm?: string;
}

export interface ListeningQuery {
  businessName: string;
  handles: string[];
  keywords: string[];
  platforms: string[];
  since?: string; // ISO 8601; provider returns mentions after this
}

export interface TenantListeningConfig {
  tenantId: string;
  businessName: string;
  handles: string[];
  keywords: string[];
  platforms: string[];
  enabled: boolean;
  lastPolledAt: string | null;
}
```

- [ ] **Step 2: provider.ts**

```typescript
import type { ListeningQuery, RawMention } from './types';

/** A pluggable mention source. The concrete adapter is chosen by the spike. */
export interface ListeningProvider {
  readonly name: string;
  search(query: ListeningQuery): Promise<RawMention[]>;
}

/** Inert provider used until the spike picks a real aggregator. */
export const StubProvider: ListeningProvider = {
  name: 'stub',
  async search() {
    return [];
  },
};
```

- [ ] **Step 3: Commit** — `git commit -- src/lib/listening/types.ts src/lib/listening/provider.ts -m "feat(listening): provider interface + types + stub"`

---

## Task 3 — Query builder (TDD)

**Files:** Create `src/lib/listening/query.ts`, `src/lib/listening/query.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { buildListeningQuery } from '@/lib/listening/query';

const config = {
  tenantId: 't1', businessName: 'Glow Salon', handles: ['@glow'], keywords: ['lagos'],
  platforms: ['instagram', 'twitter'], enabled: true, lastPolledAt: '2026-06-29T00:00:00.000Z',
};

describe('buildListeningQuery', () => {
  it('maps config to a provider query and carries since from lastPolledAt', () => {
    const q = buildListeningQuery(config);
    expect(q.businessName).toBe('Glow Salon');
    expect(q.handles).toEqual(['@glow']);
    expect(q.keywords).toEqual(['lagos']);
    expect(q.platforms).toEqual(['instagram', 'twitter']);
    expect(q.since).toBe('2026-06-29T00:00:00.000Z');
  });

  it('omits since when no lastPolledAt', () => {
    expect(buildListeningQuery({ ...config, lastPolledAt: null }).since).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx jest src/lib/listening/query.test.ts`
- [ ] **Step 3: Implement**

```typescript
import type { ListeningQuery, TenantListeningConfig } from './types';

export function buildListeningQuery(config: TenantListeningConfig): ListeningQuery {
  return {
    businessName: config.businessName,
    handles: config.handles,
    keywords: config.keywords,
    platforms: config.platforms,
    ...(config.lastPolledAt ? { since: config.lastPolledAt } : {}),
  };
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `git commit -- src/lib/listening/query.ts src/lib/listening/query.test.ts -m "feat(listening): query builder"`

---

## Task 4 — Config lib (TDD, mock admin)

**Files:** Create `src/lib/listening/config.ts`, `src/lib/listening/config.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { getEnabledListeningConfigs } from '@/lib/listening/config';

function makeAdmin(rows: unknown[]) {
  const calls: Array<[string, unknown]> = [];
  const admin = {
    from() {
      const b: Record<string, unknown> = {
        select() { return b; },
        eq(c: string, v: unknown) { calls.push([c, v]); return b; },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  return { admin: admin as never, calls };
}

describe('getEnabledListeningConfigs', () => {
  it('returns mapped configs filtered to enabled', async () => {
    const { admin, calls } = makeAdmin([
      { tenant_id: 't1', business_name: 'Glow', handles: ['@g'], keywords: [], platforms: ['twitter'], enabled: true, last_polled_at: null },
    ]);
    const configs = await getEnabledListeningConfigs(admin);
    expect(calls).toContainEqual(['enabled', true]);
    expect(configs[0]).toMatchObject({ tenantId: 't1', businessName: 'Glow', platforms: ['twitter'] });
  });
}
);
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantListeningConfig } from './types';

interface Row {
  tenant_id: string; business_name: string; handles: string[] | null; keywords: string[] | null;
  platforms: string[] | null; enabled: boolean; last_polled_at: string | null;
}

export async function getEnabledListeningConfigs(admin: SupabaseClient): Promise<TenantListeningConfig[]> {
  const { data } = await admin.from('tenant_listening_config').select('*').eq('enabled', true);
  return ((data ?? []) as Row[]).map((r) => ({
    tenantId: r.tenant_id,
    businessName: r.business_name,
    handles: r.handles ?? [],
    keywords: r.keywords ?? [],
    platforms: r.platforms ?? [],
    enabled: r.enabled,
    lastPolledAt: r.last_polled_at,
  }));
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `git commit -- src/lib/listening/config.ts src/lib/listening/config.test.ts -m "feat(listening): enabled-config loader"`

---

## Task 5 — Ingest (TDD, mock admin + mock provider)

**Files:** Create `src/lib/listening/ingest.ts`, `src/lib/listening/ingest.test.ts`

Logic: build query → `provider.search` → fetch existing `external_id`s for this tenant+provider →
filter out dupes → insert new rows → bump `last_polled_at` → return the new `RawMention[]`.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { ingestMentions } from '@/lib/listening/ingest';
import type { ListeningProvider } from '@/lib/listening/provider';

const config = {
  tenantId: 't1', businessName: 'Glow', handles: [], keywords: [], platforms: ['twitter'],
  enabled: true, lastPolledAt: null,
};

function makeProvider(mentions: unknown[]): ListeningProvider {
  return { name: 'mock', async search() { return mentions as never; } };
}

// admin: social_mentions select(existing external_ids) + insert; config update
function makeAdmin(existing: string[]) {
  const inserted: unknown[] = [];
  const admin = {
    from(table: string) {
      const b: Record<string, unknown> = {
        select() { return b; },
        insert(rows: unknown) { if (table === 'social_mentions') inserted.push(...(rows as unknown[])); return b; },
        update() { return b; },
        eq() { return b; },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          const data = table === 'social_mentions' ? existing.map((e) => ({ external_id: e })) : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return b;
    },
  };
  return { admin: admin as never, inserted };
}

describe('ingestMentions', () => {
  it('inserts only new mentions (dedup by external_id) and returns them', async () => {
    const provider = makeProvider([
      { externalId: 'a', platform: 'twitter', content: 'love Glow' },
      { externalId: 'b', platform: 'twitter', content: 'Glow is great' },
    ]);
    const { admin, inserted } = makeAdmin(['a']); // 'a' already stored
    const result = await ingestMentions(admin, config, provider);
    expect(result.map((m) => m.externalId)).toEqual(['b']);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ tenant_id: 't1', provider: 'mock', external_id: 'b', platform: 'twitter' });
  });

  it('returns [] and inserts nothing when provider finds nothing', async () => {
    const { admin, inserted } = makeAdmin([]);
    const result = await ingestMentions(admin, config, makeProvider([]));
    expect(result).toEqual([]);
    expect(inserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListeningProvider } from './provider';
import type { RawMention, TenantListeningConfig } from './types';
import { buildListeningQuery } from './query';

export async function ingestMentions(
  admin: SupabaseClient,
  config: TenantListeningConfig,
  provider: ListeningProvider,
): Promise<RawMention[]> {
  const found = await provider.search(buildListeningQuery(config));
  if (found.length === 0) {
    await touchLastPolled(admin, config.tenantId);
    return [];
  }

  const { data: existingRows } = await admin
    .from('social_mentions')
    .select('external_id')
    .eq('tenant_id', config.tenantId)
    .eq('provider', provider.name);
  const existing = new Set(((existingRows ?? []) as Array<{ external_id: string }>).map((r) => r.external_id));

  const fresh = found.filter((m) => !existing.has(m.externalId));
  if (fresh.length > 0) {
    await admin.from('social_mentions').insert(
      fresh.map((m) => ({
        tenant_id: config.tenantId,
        provider: provider.name,
        external_id: m.externalId,
        platform: m.platform,
        author: m.author ?? null,
        url: m.url ?? null,
        content: m.content ?? null,
        matched_term: m.matchedTerm ?? null,
      })),
    );
  }
  await touchLastPolled(admin, config.tenantId);
  return fresh;
}

async function touchLastPolled(admin: SupabaseClient, tenantId: string): Promise<void> {
  await admin
    .from('tenant_listening_config')
    .update({ last_polled_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `git commit -- src/lib/listening/ingest.ts src/lib/listening/ingest.test.ts -m "feat(listening): dedup ingest"`

---

## Task 6 — Notify (light wiring)

**Files:** Create `src/lib/listening/notify.ts`

Reuse the committed `getAlertService()` (warning) for new mentions. Keep it best-effort.

```typescript
import { getAlertService } from '@/lib/monitoring/alerting';
import type { RawMention } from './types';

export async function notifyNewMentions(tenantId: string, mentions: RawMention[]): Promise<void> {
  if (mentions.length === 0) return;
  try {
    await getAlertService().sendInfoAlert(
      `${mentions.length} new social mention(s) to review`,
      { operation: 'social_listening', tenantId, metadata: { count: mentions.length } },
    );
  } catch {
    // best-effort
  }
}
```

- [ ] **Commit** `git commit -- src/lib/listening/notify.ts -m "feat(listening): notify owner of new mentions"`

---

## Task 7 — Cron route

**Files:** Create `src/app/api/cron/social-listening/route.ts`

```typescript
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getEnabledListeningConfigs } from '@/lib/listening/config';
import { ingestMentions } from '@/lib/listening/ingest';
import { notifyNewMentions } from '@/lib/listening/notify';
import { StubProvider } from '@/lib/listening/provider';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Swap StubProvider for the real adapter once the spike picks one.
  const provider = StubProvider;
  const admin = createSupabaseAdminClient();
  const configs = await getEnabledListeningConfigs(admin);

  let totalNew = 0;
  for (const config of configs) {
    try {
      const fresh = await ingestMentions(admin, config, provider);
      totalNew += fresh.length;
      await notifyNewMentions(config.tenantId, fresh);
    } catch {
      // continue other tenants
    }
  }
  return NextResponse.json({ ok: true, tenants: configs.length, newMentions: totalNew });
}
```

- [ ] **Commit** `git commit -- src/app/api/cron/social-listening/route.ts -m "feat(listening): cron poll route (provider-agnostic)"`

---

## Task 8 — Convert-to-lead (TDD)

**Files:** Create `src/lib/listening/convert.ts`, `src/lib/listening/convert.test.ts`

Inserts a `leads` row (`source='social'`, phone required by schema) and marks the mention
`converted`. Reject if phone missing.

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from '@jest/globals';
import { convertMentionToLead } from '@/lib/listening/convert';

function makeAdmin() {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];
  const admin = {
    from(table: string) {
      const b: Record<string, unknown> = {
        insert(p: unknown) { ops.push({ table, kind: 'insert', payload: p }); return b; },
        update(p: unknown) { ops.push({ table, kind: 'update', payload: p }); return b; },
        eq() { return b; },
        then(resolve: (v: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return b;
    },
  };
  return { admin: admin as never, ops };
}

describe('convertMentionToLead', () => {
  it('throws when phone is missing', async () => {
    const { admin } = makeAdmin();
    await expect(
      convertMentionToLead(admin, { mentionId: 'm1', tenantId: 't1', contact: { phone: '' } }),
    ).rejects.toThrow(/phone/i);
  });

  it('inserts a social lead and marks the mention converted', async () => {
    const { admin, ops } = makeAdmin();
    await convertMentionToLead(admin, {
      mentionId: 'm1', tenantId: 't1', contact: { phone: '2348000', name: 'Ada', notes: 'from IG' },
    });
    expect(ops).toContainEqual({ table: 'leads', kind: 'insert', payload: expect.objectContaining({ tenant_id: 't1', phone: '2348000', source: 'social', name: 'Ada' }) });
    const upd = ops.find((o) => o.table === 'social_mentions' && o.kind === 'update');
    expect(upd?.payload).toEqual({ status: 'converted' });
  });
});
```

- [ ] **Step 2: FAIL. Step 3: Implement**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConvertInput {
  mentionId: string;
  tenantId: string;
  contact: { phone: string; name?: string; email?: string; notes?: string };
}

export async function convertMentionToLead(admin: SupabaseClient, input: ConvertInput): Promise<void> {
  const phone = (input.contact.phone ?? '').trim();
  if (!phone) throw new Error('phone is required to convert a mention to a lead');

  await admin.from('leads').insert({
    tenant_id: input.tenantId,
    name: input.contact.name ?? null,
    phone,
    email: input.contact.email ?? null,
    source: 'social',
    intent: 'inquiry',
    notes: input.contact.notes ?? null,
    status: 'new',
  });

  await admin
    .from('social_mentions')
    .update({ status: 'converted' })
    .eq('id', input.mentionId)
    .eq('tenant_id', input.tenantId);
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `git commit -- src/lib/listening/convert.ts src/lib/listening/convert.test.ts -m "feat(listening): convert mention to lead"`

---

## Task 9 — API routes (list / status / convert)

**Files:** Create `src/app/api/listening/mentions/route.ts`, `.../[id]/route.ts`, `.../[id]/convert/route.ts`

- [ ] **`mentions/route.ts` — GET list (owner/manager, tenant-scoped)**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const VALID = ['new', 'engaged', 'dismissed', 'converted'];

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('No tenant in context');
    const raw = new URL(ctx.request.url).searchParams.get('status');
    const status = VALID.includes(raw ?? '') ? raw : undefined;

    const admin = createSupabaseAdminClient();
    let q = admin.from('social_mentions').select('*').eq('tenant_id', tenantId);
    if (status) q = q.eq('status', status);
    const { data } = await q.order('created_at', { ascending: false }).limit(100);
    return { success: true, mentions: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] },
);
```

- [ ] **`[id]/route.ts` — POST { status } engage/dismiss**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    const tenantId = ctx.user?.tenantId;
    if (!id || !tenantId) throw ApiErrorFactory.validationError({ id: 'id + tenant required' });
    const body: { status?: string } = await parseJsonBody<{ status?: string }>(ctx.request).catch(() => ({}));
    if (body.status !== 'engaged' && body.status !== 'dismissed') {
      throw ApiErrorFactory.validationError({ status: "status must be 'engaged' or 'dismissed'" });
    }
    const admin = createSupabaseAdminClient();
    await admin.from('social_mentions').update({ status: body.status }).eq('id', id).eq('tenant_id', tenantId);
    return { success: true, status: body.status };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
```

- [ ] **`[id]/convert/route.ts` — POST contact → lead**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { convertMentionToLead } from '@/lib/listening/convert';

export const POST = createHttpHandler(
  async (ctx) => {
    const id = ctx.params?.id;
    const tenantId = ctx.user?.tenantId;
    if (!id || !tenantId) throw ApiErrorFactory.validationError({ id: 'id + tenant required' });
    const body = await parseJsonBody<{ phone?: string; name?: string; email?: string; notes?: string }>(ctx.request).catch(() => ({}));
    if (!body.phone) throw ApiErrorFactory.validationError({ phone: 'phone is required' });
    const admin = createSupabaseAdminClient();
    await convertMentionToLead(admin, { mentionId: id, tenantId, contact: { phone: body.phone, name: body.name, email: body.email, notes: body.notes } });
    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] },
);
```

- [ ] **Commit** all three: `git commit -- src/app/api/listening/mentions/route.ts "src/app/api/listening/mentions/[id]/route.ts" "src/app/api/listening/mentions/[id]/convert/route.ts" -m "feat(listening): mentions API (list/status/convert)"`

---

## Task 10 — Dashboard mentions feed (TDD) + page

**Files:** Create `src/components/listening/MentionsFeed.tsx`, `.test.tsx`, `src/app/dashboard/mentions/page.tsx`

Mirror `src/components/moderation/ReviewModerationQueue.tsx` (authGet load, authPost actions, reload).

- [ ] **Step 1: Failing test** (mock `@/lib/auth/auth-api-client` `authGet`/`authPost`)

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(url: string) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(url: string, body?: unknown) => Promise<ApiResponse<unknown>>>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...a: unknown[]) => authGet(...(a as [string])),
  authPost: (...a: unknown[]) => authPost(...(a as [string, unknown])),
}));

import MentionsFeed from '@/components/listening/MentionsFeed';

describe('MentionsFeed', () => {
  beforeEach(() => {
    authGet.mockReset(); authPost.mockReset();
    authPost.mockResolvedValue({ status: 200, data: { success: true } });
  });

  it('loads new mentions and dismisses one', async () => {
    authGet.mockResolvedValue({ status: 200, data: { mentions: [{ id: 'm1', platform: 'twitter', content: 'love Glow', url: 'http://x', status: 'new' }] } });
    render(<MentionsFeed />);
    expect(await screen.findByText(/love Glow/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/listening/mentions/m1', { status: 'dismissed' }));
  });
});
```

- [ ] **Step 2: FAIL. Step 3: Implement `MentionsFeed.tsx`**

```tsx
'use client';
import React, { useCallback, useEffect, useState } from 'react';
import { authGet, authPost } from '@/lib/auth/auth-api-client';

interface Mention { id: string; platform: string; author?: string; content?: string; url?: string; status: string; }

export default function MentionsFeed() {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await authGet<{ mentions: Mention[] }>('/api/listening/mentions?status=new');
    setMentions(res.data?.mentions ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: 'engaged' | 'dismissed') => {
    setBusy(true);
    try { await authPost(`/api/listening/mentions/${id}`, { status }); await load(); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border border-[#e7e3d7] bg-white p-4">
      <h3 className="text-sm font-semibold text-[#10211a]">Social mentions</h3>
      <ul className="mt-3 space-y-3">
        {mentions.map((m) => (
          <li key={m.id} className="rounded border border-[#e7e3d7] p-3">
            <p className="text-xs text-[#3a4a43]">{m.platform}{m.author ? ` · ${m.author}` : ''}</p>
            <p className="mt-1 text-sm text-[#10211a]">{m.content}</p>
            {m.url && <a href={m.url} className="text-xs underline" target="_blank" rel="noopener noreferrer">View post</a>}
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy} onClick={() => setStatus(m.id, 'engaged')} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50">Mark engaged</button>
              <button type="button" disabled={busy} onClick={() => setStatus(m.id, 'dismissed')} className="rounded border px-3 py-1.5 text-xs disabled:opacity-50">Dismiss</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: PASS.** Then create the page:

```tsx
export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import MentionsFeed from '@/components/listening/MentionsFeed';

export default async function MentionsPage() {
  await requireAuth(['owner', 'manager']);
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Social mentions</h1>
      <p className="text-sm text-gray-600">Mentions of your business across platforms.</p>
      <div className="mt-6 max-w-2xl"><MentionsFeed /></div>
    </div>
  );
}
```

- [ ] **Step 5: Commit** `git commit -- src/components/listening/MentionsFeed.tsx src/components/listening/MentionsFeed.test.tsx src/app/dashboard/mentions/page.tsx -m "feat(listening): dashboard mentions feed + page"`

---

## Task 11 — Real provider adapter (AFTER spike)

Implement `ListeningProvider` for the chosen aggregator in `src/lib/listening/providers/<name>.ts`
(`search(query)` → maps the aggregator response to `RawMention[]` with a **stable `externalId`** per
post). Add env vars for its API key. Swap `StubProvider` → the real provider in the cron route. Verify
package name/version/API against the provider's current docs before coding (per repo dependency rule).

---

## Self-review checklist (run after Tasks 1–10)
- `npx jest src/lib/listening src/components/listening` → all green.
- `npm run typecheck` → no errors in `listening` / `api/listening` / `api/cron/social-listening`.
- Cron returns `{ ok: true }` with `StubProvider` (inert) — safe to deploy before the spike.
- `convertMentionToLead` rejects missing phone; lead `source='social'`.
- Every commit staged only its own paths.
