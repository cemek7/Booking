# WhatsApp Brand Identity & Assistant Disclosure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp customer-facing WhatsApp replies with the tenant's brand identity (header, "formerly" on rename, bot-disclosure footer) on session-open and business-initiated messages, plus honor a minimal STOP/START opt-out.

**Architecture:** Two pure modules (`brandIdentity.ts`, `optOut.ts`) hold all the decision logic and are unit-tested in isolation. One I/O seam (`outboundBranding.ts`) loads tenant/conversation rows, applies the opt-out gate, and returns the branded string (or `null` to skip). The customer path in `pipeline.ts`, the waitlist notifier, and the cron rebooking sender call the seam. Branding is customer-facing only — owner/staff messages are untouched.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (`@supabase/supabase-js` admin client), Jest.

**Spec:** `docs/superpowers/specs/2026-06-08-whatsapp-brand-identity-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `db/migrations/070_tenant_brand_identity.sql` | Add brand columns to `tenants`, `last_inbound_at`/`opted_out_at` to `whatsapp_conversations` |
| `src/lib/whatsapp/v2/brandIdentity.ts` *(new)* | Pure: `resolveBrandContext`, `applyBrandIdentity` + types |
| `src/lib/whatsapp/v2/optOut.ts` *(new)* | Pure: `detectOptOutKeyword`, `isOptedOut` |
| `src/lib/whatsapp/v2/outboundBranding.ts` *(new)* | I/O seam: `brandCustomerText` (fetch + gate + compose) |
| `src/lib/whatsapp/v2/tenantBrand.ts` *(new)* | `renameTenantBrand`, `suggestEmojiForVertical` |
| `src/lib/whatsapp/v2/conversationState.ts` *(modify)* | Add `last_inbound_at`, `opted_out_at` to `ConvState` + selects |
| `src/lib/whatsapp/v2/pipeline.ts` *(modify)* | STOP handling, `last_inbound_at` touch, branded customer sends |
| `src/lib/whatsapp/v2/waitlist.ts` *(modify)* | Brand the slot-opened notification |
| `src/app/api/cron/nightly/route.ts` *(modify)* | Brand rebooking follow-up + nudge |
| `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts` *(modify)* | Default `brand_emoji` from vertical on activation |
| `src/app/api/admin/tenant/[id]/settings/route.ts` *(modify)* | Route `display_name` changes through `renameTenantBrand` |

**Test command:** `npx jest <path>` (config: `jest.config.cjs`). Tests live under `src/__tests__/lib/whatsapp/v2/`.

---

## Task 1: Migration — brand columns

**Files:**
- Create: `db/migrations/070_tenant_brand_identity.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 070_tenant_brand_identity.sql
-- SAFE: ADD COLUMN only. No renames, drops, or retypes.
-- Pre-flight: `tenants` and `whatsapp_conversations` both exist (referenced in
-- src/lib/whatsapp/v2/identityResolver.ts and conversationState.ts).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS display_name   TEXT,
  ADD COLUMN IF NOT EXISTS brand_emoji    TEXT,
  ADD COLUMN IF NOT EXISTS previous_names JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS renamed_at     TIMESTAMPTZ;

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_at    TIMESTAMPTZ;

-- Backfill last_inbound_at so existing conversations have a baseline (idempotent).
UPDATE whatsapp_conversations
   SET last_inbound_at = updated_at
 WHERE last_inbound_at IS NULL;
```

- [ ] **Step 2: Verify it applies cleanly (manual)**

Run: `psql "$DATABASE_URL" -f db/migrations/070_tenant_brand_identity.sql`
Expected: `ALTER TABLE` / `UPDATE N` with no errors. Re-running is a no-op (IF NOT EXISTS + WHERE NULL guard).

- [ ] **Step 3: Commit**

```bash
git add db/migrations/070_tenant_brand_identity.sql
git commit -m "feat(db): add tenant brand + conversation identity columns"
```

---

## Task 2: Pure brand logic — `brandIdentity.ts`

**Files:**
- Create: `src/lib/whatsapp/v2/brandIdentity.ts`
- Test: `src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts
import {
  resolveBrandContext,
  applyBrandIdentity,
  type TenantBrandFields,
  type ConversationBrandFields,
} from '@/lib/whatsapp/v2/brandIdentity';

const NOW = new Date('2026-06-08T12:00:00Z');

function tenant(overrides: Partial<TenantBrandFields> = {}): TenantBrandFields {
  return {
    name: 'Chris Barbershop',
    display_name: null,
    brand_emoji: '✂️',
    previous_names: null,
    renamed_at: null,
    ...overrides,
  };
}

describe('resolveBrandContext', () => {
  it('stamps header on session-open (last inbound > 30m ago)', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:00:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('suppresses header mid-conversation (last inbound 5m ago, not initiated)', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:55:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(false);
  });

  it('always stamps header when initiated, even mid-conversation', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-06-08T11:55:00Z' };
    const ctx = resolveBrandContext(tenant(), conv, { initiated: true, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('treats null last_inbound_at as session-open', () => {
    const ctx = resolveBrandContext(tenant(), { last_inbound_at: null }, { initiated: false, now: NOW });
    expect(ctx.stampHeader).toBe(true);
  });

  it('falls back to name when display_name is null', () => {
    const ctx = resolveBrandContext(tenant(), { last_inbound_at: null }, { initiated: true, now: NOW });
    expect(ctx.displayName).toBe('Chris Barbershop');
  });

  it('uses display_name when set', () => {
    const ctx = resolveBrandContext(
      tenant({ display_name: 'Chris Cuts' }),
      { last_inbound_at: null },
      { initiated: true, now: NOW }
    );
    expect(ctx.displayName).toBe('Chris Cuts');
  });

  it('shows formerly when customer predates the rename', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-01-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        display_name: 'Chris Grooming Lounge',
        renamed_at: '2026-03-01T00:00:00Z',
        previous_names: [{ name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' }],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBe('Chris Barbershop');
  });

  it('hides formerly when customer is newer than the rename', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-04-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        renamed_at: '2026-03-01T00:00:00Z',
        previous_names: [{ name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' }],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBeNull();
  });

  it('uses the most recent previous name after multiple renames', () => {
    const conv: ConversationBrandFields = { last_inbound_at: '2026-01-01T00:00:00Z' };
    const ctx = resolveBrandContext(
      tenant({
        renamed_at: '2026-05-01T00:00:00Z',
        previous_names: [
          { name: 'Chris Barbershop', renamed_at: '2026-03-01T00:00:00Z' },
          { name: 'Chris Cuts', renamed_at: '2026-05-01T00:00:00Z' },
        ],
      }),
      conv,
      { initiated: true, now: NOW }
    );
    expect(ctx.previousName).toBe('Chris Cuts');
  });
});

describe('applyBrandIdentity', () => {
  const baseCtx = { displayName: 'Chris Barbershop', emoji: '✂️', previousName: null, stampHeader: true };

  it('returns reply unchanged when stampHeader is false', () => {
    expect(applyBrandIdentity('Sure, 2pm works', { ...baseCtx, stampHeader: false })).toBe('Sure, 2pm works');
  });

  it('prepends header with emoji and appends footer', () => {
    const out = applyBrandIdentity('Booked for 2pm.', baseCtx);
    expect(out).toContain('*Chris Barbershop* ✂️');
    expect(out).toContain('Booked for 2pm.');
    expect(out).toContain('reply STOP to opt out');
  });

  it('omits emoji cleanly when null', () => {
    const out = applyBrandIdentity('Hi', { ...baseCtx, emoji: null });
    expect(out.split('\n')[0]).toBe('*Chris Barbershop*');
  });

  it('includes the formerly line when previousName is set', () => {
    const out = applyBrandIdentity('Time for a cut?', { ...baseCtx, previousName: 'Chris Cuts' });
    expect(out).toContain('_(formerly Chris Cuts)_');
  });

  it('is idempotent — does not double-stamp an already-branded reply', () => {
    const once = applyBrandIdentity('Booked.', baseCtx);
    const twice = applyBrandIdentity(once, baseCtx);
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts`
Expected: FAIL — "Cannot find module '@/lib/whatsapp/v2/brandIdentity'".

- [ ] **Step 3: Implement `brandIdentity.ts`**

```typescript
// src/lib/whatsapp/v2/brandIdentity.ts
/**
 * Pure brand-identity logic for customer-facing WhatsApp messages.
 * No I/O — fully unit-testable. The I/O seam lives in outboundBranding.ts.
 */

export interface TenantBrandFields {
  name: string;
  display_name: string | null;
  brand_emoji: string | null;
  previous_names: Array<{ name: string; renamed_at: string }> | null;
  renamed_at: string | null;
}

export interface ConversationBrandFields {
  last_inbound_at: string | null;
}

export interface BrandContext {
  displayName: string;
  emoji: string | null;
  previousName: string | null;
  stampHeader: boolean;
}

export interface ResolveOpts {
  initiated: boolean;
  now: Date;
  sessionGapMs?: number;
}

const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const FOOTER = '— automated assistant · reply STOP to opt out';

export function resolveBrandContext(
  tenant: TenantBrandFields,
  conv: ConversationBrandFields,
  opts: ResolveOpts
): BrandContext {
  const displayName = tenant.display_name ?? tenant.name;
  const emoji = tenant.brand_emoji ?? null;
  const sessionGap = opts.sessionGapMs ?? DEFAULT_SESSION_GAP_MS;

  const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : null;
  const isSessionOpen = lastInbound === null || opts.now.getTime() - lastInbound > sessionGap;
  const stampHeader = opts.initiated || isSessionOpen;

  let previousName: string | null = null;
  if (
    tenant.renamed_at &&
    Array.isArray(tenant.previous_names) &&
    tenant.previous_names.length > 0 &&
    lastInbound !== null &&
    lastInbound < new Date(tenant.renamed_at).getTime()
  ) {
    previousName = tenant.previous_names[tenant.previous_names.length - 1].name;
  }

  return { displayName, emoji, previousName, stampHeader };
}

export function applyBrandIdentity(reply: string, ctx: BrandContext): string {
  if (!ctx.stampHeader) return reply;

  // Idempotency guard — already branded (e.g. retry).
  if (reply.startsWith(`*${ctx.displayName}*`)) return reply;

  const header = ctx.emoji ? `*${ctx.displayName}* ${ctx.emoji}` : `*${ctx.displayName}*`;
  const lines: string[] = [header];
  if (ctx.previousName) lines.push(`_(formerly ${ctx.previousName})_`);
  lines.push('', reply, '', `_${FOOTER}_`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/v2/brandIdentity.ts src/__tests__/lib/whatsapp/v2/brandIdentity.test.ts
git commit -m "feat(whatsapp): pure brand-identity composition logic"
```

---

## Task 3: Pure opt-out logic — `optOut.ts`

**Files:**
- Create: `src/lib/whatsapp/v2/optOut.ts`
- Test: `src/__tests__/lib/whatsapp/v2/optOut.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/lib/whatsapp/v2/optOut.test.ts
import { detectOptOutKeyword, isOptedOut } from '@/lib/whatsapp/v2/optOut';

describe('detectOptOutKeyword', () => {
  it.each(['STOP', 'stop', '  Stop  ', 'UNSUBSCRIBE', 'stopp'])('detects stop for %p', (t) => {
    expect(detectOptOutKeyword(t)).toBe('stop');
  });

  it.each(['START', 'resume', 'UNSTOP'])('detects start for %p', (t) => {
    expect(detectOptOutKeyword(t)).toBe('start');
  });

  it('does NOT match keywords embedded in a sentence', () => {
    expect(detectOptOutKeyword('stop by at 5')).toBeNull();
    expect(detectOptOutKeyword('can I start my booking')).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(detectOptOutKeyword('book a haircut')).toBeNull();
  });
});

describe('isOptedOut', () => {
  it('true when opted_out_at is set', () => {
    expect(isOptedOut({ opted_out_at: '2026-06-01T00:00:00Z' })).toBe(true);
  });
  it('false when opted_out_at is null', () => {
    expect(isOptedOut({ opted_out_at: null })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/optOut.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `optOut.ts`**

```typescript
// src/lib/whatsapp/v2/optOut.ts
/**
 * Minimal opt-out detection. Matches ONLY when the whole trimmed message is a
 * keyword, so "stop by at 5" and "can I start" are not treated as opt-out.
 */
export type OptOutSignal = 'stop' | 'start' | null;

const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'STOPP']);
const START_WORDS = new Set(['START', 'RESUME', 'UNSTOP']);

export function detectOptOutKeyword(text: string): OptOutSignal {
  const word = text.trim().toUpperCase();
  if (STOP_WORDS.has(word)) return 'stop';
  if (START_WORDS.has(word)) return 'start';
  return null;
}

export function isOptedOut(conv: { opted_out_at: string | null }): boolean {
  return conv.opted_out_at != null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/optOut.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/v2/optOut.ts src/__tests__/lib/whatsapp/v2/optOut.test.ts
git commit -m "feat(whatsapp): minimal STOP/START opt-out detection"
```

---

## Task 4: Conversation state — expose new columns

**Files:**
- Modify: `src/lib/whatsapp/v2/conversationState.ts`

- [ ] **Step 1: Add fields to the `ConvState` interface**

In `src/lib/whatsapp/v2/conversationState.ts`, add two fields to the `ConvState` interface (after `flow_data`):

```typescript
export interface ConvState {
  id: string;
  tenant_id: string;
  phone_number: string | null;
  external_id?: string;
  channel?: string;
  role: ConvRole;
  current_flow: ConvFlow;
  flow_step: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow_data: Record<string, any>;
  last_inbound_at: string | null;
  opted_out_at: string | null;
}
```

- [ ] **Step 2: Add the columns to both selects**

In `getConversation`, change the `.select(...)` (currently line ~51) to:

```typescript
    .select('id, tenant_id, phone_number, role, current_flow, flow_step, flow_data, last_inbound_at, opted_out_at')
```

In `ensureConversation`, change the `.select(...)` after the upsert (currently line ~91) to the same string:

```typescript
    .select('id, tenant_id, phone_number, role, current_flow, flow_step, flow_data, last_inbound_at, opted_out_at')
```

- [ ] **Step 3: Verify it compiles**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: no new errors in `conversationState.ts`. (New rows return `null` for the new columns, which matches the types.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp/v2/conversationState.ts
git commit -m "feat(whatsapp): surface last_inbound_at + opted_out_at on ConvState"
```

---

## Task 5: I/O seam — `outboundBranding.ts`

**Files:**
- Create: `src/lib/whatsapp/v2/outboundBranding.ts`
- Test: `src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';

// Mock the supabase admin client used by the module.
const tenantRow = {
  name: 'Chris Barbershop',
  display_name: null,
  brand_emoji: '✂️',
  previous_names: null,
  renamed_at: null,
};

jest.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === 'tenants'
                  ? { data: (global as any).__tenantRow }
                  : { data: (global as any).__convRow },
            }),
            maybeSingle: async () =>
              table === 'tenants'
                ? { data: (global as any).__tenantRow }
                : { data: (global as any).__convRow },
          }),
        }),
      }),
    }),
  };
});

beforeEach(() => {
  (global as any).__tenantRow = tenantRow;
  (global as any).__convRow = { last_inbound_at: null, opted_out_at: null };
});

const NOW = new Date('2026-06-08T12:00:00Z');

it('brands a session-open reply using a provided conv', async () => {
  const out = await brandCustomerText('t1', '234999', 'Booked for 2pm.', {
    initiated: false,
    conv: { last_inbound_at: null, opted_out_at: null },
    now: NOW,
  });
  expect(out).toContain('*Chris Barbershop* ✂️');
  expect(out).toContain('Booked for 2pm.');
});

it('returns null for an initiated send to an opted-out customer', async () => {
  const out = await brandCustomerText('t1', '234999', 'Time for a cut?', {
    initiated: true,
    conv: { last_inbound_at: '2026-01-01T00:00:00Z', opted_out_at: '2026-05-01T00:00:00Z' },
    now: NOW,
  });
  expect(out).toBeNull();
});

it('still sends an inbound reply to an opted-out customer (they messaged us)', async () => {
  const out = await brandCustomerText('t1', '234999', 'Sure!', {
    initiated: false,
    conv: { last_inbound_at: '2026-06-08T11:00:00Z', opted_out_at: '2026-05-01T00:00:00Z' },
    now: NOW,
  });
  expect(out).not.toBeNull();
  expect(out).toContain('Sure!');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `outboundBranding.ts`**

```typescript
// src/lib/whatsapp/v2/outboundBranding.ts
/**
 * I/O seam between the pipeline's outbound paths and the pure brand logic.
 * Loads tenant brand fields + conversation flags, applies the opt-out gate,
 * and returns the branded text — or null when the send should be SKIPPED
 * (an initiated message to an opted-out customer).
 */
import { createClient } from '@supabase/supabase-js';
import {
  resolveBrandContext,
  applyBrandIdentity,
  type TenantBrandFields,
  type ConversationBrandFields,
} from './brandIdentity';
import { isOptedOut } from './optOut';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ConvFlags = ConversationBrandFields & { opted_out_at: string | null };

export interface BrandOpts {
  initiated: boolean;
  /** Pass the already-loaded conversation to preserve read-before-write of last_inbound_at. */
  conv?: ConvFlags | null;
  now?: Date;
}

export async function brandCustomerText(
  tenantId: string,
  phone: string,
  reply: string,
  opts: BrandOpts
): Promise<string | null> {
  const now = opts.now ?? new Date();

  let conv: ConvFlags = opts.conv ?? { last_inbound_at: null, opted_out_at: null };
  if (!opts.conv) {
    const { data } = await supabaseAdmin
      .from('whatsapp_conversations')
      .select('last_inbound_at, opted_out_at')
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone)
      .maybeSingle();
    if (data) conv = data as ConvFlags;
  }

  // Opt-out blocks business-initiated sends only; inbound replies always go through.
  if (opts.initiated && isOptedOut(conv)) return null;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, display_name, brand_emoji, previous_names, renamed_at')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant) return reply; // fail-open: send unbranded rather than drop the message

  const ctx = resolveBrandContext(tenant as TenantBrandFields, conv, {
    initiated: opts.initiated,
    now,
  });
  return applyBrandIdentity(reply, ctx);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/v2/outboundBranding.ts src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts
git commit -m "feat(whatsapp): outbound branding seam with opt-out gate"
```

---

## Task 6: Wire branding + STOP into the pipeline

**Files:**
- Modify: `src/lib/whatsapp/v2/pipeline.ts`

- [ ] **Step 1: Add imports**

At the top of `src/lib/whatsapp/v2/pipeline.ts`, after the existing `./flows/...` imports (around line 27), add:

```typescript
import { detectOptOutKeyword, type OptOutSignal } from './optOut';
import { brandCustomerText } from './outboundBranding';
import type { ConvState } from './conversationState';
```

- [ ] **Step 2: Add STOP handling + last_inbound_at touch in `processMessageV2`**

In `processMessageV2`, the block currently reads (lines ~63-68):

```typescript
  // ── 2. Load conversation state ─────────────────────────────────────────────
  let conv = await getConversation(phone, tenantId);
  if (!conv) {
    conv = await ensureConversation(phone, tenantId);
  }
```

Immediately AFTER that block (and before the "── 3. Route ──" comment), insert:

```typescript
  // ── 2a. Opt-out keyword (customers only) ──────────────────────────────────
  const optSignal: OptOutSignal = detectOptOutKeyword(rawMessage);
  if (optSignal && conv.role !== 'owner' && conv.role !== 'staff') {
    await handleOptOutSignal(phone, tenantId, optSignal);
    await markMessagesProcessed(batch.messageIds);
    return true;
  }

  // ── 2b. Record inbound time AFTER capturing the prior value in `conv` ──────
  // `conv.last_inbound_at` (loaded above) is the value branding will use this
  // turn; we update the DB to now() for the NEXT turn's session/drift checks.
  await supabaseAdmin
    .from('whatsapp_conversations')
    .update({ last_inbound_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('phone_number', phone);
```

- [ ] **Step 3: Add the `handleOptOutSignal` helper**

Add this function near the other handlers (e.g. just below `handleCustomerMessage`, before `callAIWithRetry`):

```typescript
// ─── Opt-out handler ──────────────────────────────────────────────────────────

async function handleOptOutSignal(
  phone: string,
  tenantId: string,
  signal: OptOutSignal
): Promise<void> {
  const evolutionConfig = await getTenantWhatsAppConfig(tenantId);
  if (!evolutionConfig) return;
  const client = getProviderClient(evolutionConfig);

  if (signal === 'stop') {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ opted_out_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone);
    await client.sendTextMessage(phone, "You're unsubscribed from reminders. Reply START to resume.");
  } else if (signal === 'start') {
    await supabaseAdmin
      .from('whatsapp_conversations')
      .update({ opted_out_at: null })
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone);
    await client.sendTextMessage(phone, "You're resubscribed. 👍");
  }
}
```

- [ ] **Step 4: Add branding params to `sendReplyAndPersistOutbound`**

Replace the `sendReplyAndPersistOutbound` signature and the send line. The function currently starts (line ~512):

```typescript
async function sendReplyAndPersistOutbound(
  waConfig: EvolutionAPIConfig,
  client: ReturnType<typeof getProviderClient>,
  tenantId: string,
  phone: string,
  reply: string
): Promise<void> {
  const sendResult = await client.sendTextMessage(phone, reply);
```

Change it to:

```typescript
async function sendReplyAndPersistOutbound(
  waConfig: EvolutionAPIConfig,
  client: ReturnType<typeof getProviderClient>,
  tenantId: string,
  phone: string,
  reply: string,
  opts?: { brand?: boolean; initiated?: boolean; conv?: ConvState | null }
): Promise<void> {
  let finalText = reply;
  if (opts?.brand) {
    const branded = await brandCustomerText(tenantId, phone, reply, {
      initiated: opts.initiated ?? false,
      conv: opts.conv
        ? { last_inbound_at: opts.conv.last_inbound_at, opted_out_at: opts.conv.opted_out_at }
        : undefined,
    });
    if (branded === null) return; // opted-out initiated send → skip silently
    finalText = branded;
  }

  const sendResult = await client.sendTextMessage(phone, finalText);
```

Then in the same function, change the persisted `content` from `reply` to `finalText`:

```typescript
  await supabaseAdmin.from('messages').insert({
    tenant_id: tenantId,
    chat_id: chat?.id ?? null,
    from_number: waConfig.instanceName,
    to_number: phone,
    content: finalText,
    direction: 'outbound',
    message_type: 'text',
    evolution_message_id: sendResult.messageId ?? null,
    timestamp: new Date().toISOString(),
  });
```

- [ ] **Step 5: Brand the three customer-path sends**

In `handleCustomerMessage` ONLY (not `handleOwnerOrStaffMessage`), add `{ brand: true, conv }` to each `sendReplyAndPersistOutbound` call. There are three:

Line ~164:
```typescript
    if (reply) await sendReplyAndPersistOutbound(evolutionConfig, client, tenantId, phone, reply, { brand: true, conv });
```

Lines ~180-187 (the fallback):
```typescript
    await sendReplyAndPersistOutbound(
      evolutionConfig,
      client,
      tenantId,
      phone,
      'Sorry, I didn\'t get that. Type *help* to see what I can do.',
      { brand: true, conv }
    );
```

Line ~191:
```typescript
  if (reply) await sendReplyAndPersistOutbound(evolutionConfig, client, tenantId, phone, reply, { brand: true, conv });
```

Leave all `handleOwnerOrStaffMessage` calls unchanged (owners/staff get no brand header).

- [ ] **Step 6: Verify it compiles**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: no new errors. (`conv` in `handleCustomerMessage` is typed via `getConversation` return and now carries `last_inbound_at`/`opted_out_at`.)

- [ ] **Step 7: Run the existing v2 pipeline tests**

Run: `npx jest src/__tests__ -t "pipeline" && npx jest src/__tests__/lib/whatsapp/v2`
Expected: PASS (no regressions). If a pipeline test stubs `sendReplyAndPersistOutbound` or supabase, confirm the new `update` call is tolerated by the mock; if not, extend the mock to no-op `.update().eq().eq()`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/v2/pipeline.ts
git commit -m "feat(whatsapp): brand customer replies + honor STOP/START in pipeline"
```

---

## Task 7: Brand the waitlist notification

**Files:**
- Modify: `src/lib/whatsapp/v2/waitlist.ts`

- [ ] **Step 1: Add the import**

At the top of `src/lib/whatsapp/v2/waitlist.ts`, add:

```typescript
import { brandCustomerText } from './outboundBranding';
```

- [ ] **Step 2: Brand the slot-opened send**

The block currently reads (around line 111):

```typescript
    const config = await getTenantWhatsAppConfig(tenantId);
    if (config) {
      const client = getProviderClient({ ...config, instanceName: instanceKey });
      await client.sendTextMessage(conv.phone_number, message);
    }
```

Replace the inner send with a branded, initiated send (skip if opted out):

```typescript
    const config = await getTenantWhatsAppConfig(tenantId);
    if (config) {
      const client = getProviderClient({ ...config, instanceName: instanceKey });
      const branded = await brandCustomerText(tenantId, conv.phone_number, message, { initiated: true });
      if (branded) await client.sendTextMessage(conv.phone_number, branded);
    }
```

- [ ] **Step 3: Verify it compiles + tests pass**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit && npx jest src/__tests__/lib/whatsapp/v2`
Expected: no new errors; existing waitlist tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp/v2/waitlist.ts
git commit -m "feat(whatsapp): brand waitlist slot-opened notification"
```

---

## Task 8: Brand the cron rebooking messages

**Files:**
- Modify: `src/app/api/cron/nightly/route.ts`

- [ ] **Step 1: Add the import**

At the top of `src/app/api/cron/nightly/route.ts`, add:

```typescript
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';
```

- [ ] **Step 2: Brand the follow-up send**

In `sendRebookingFollowUps`, the send currently reads (around line 327):

```typescript
    const sendRes = await client.sendTextMessage(reservation.customer_phone, greeting);
```

Replace with:

```typescript
    const branded = await brandCustomerText(
      reservation.tenant_id,
      reservation.customer_phone,
      greeting,
      { initiated: true }
    );
    if (!branded) continue; // customer opted out of reminders
    const sendRes = await client.sendTextMessage(reservation.customer_phone, branded);
```

(`reservation.tenant_id` is the in-scope tenant id in this loop — confirmed in the source.)

- [ ] **Step 3: Brand the nudge send**

In `sendRebookingNudges`, the send currently reads (around line 478):

```typescript
        const sendRes = await client.sendTextMessage(phone, nudge);
```

Replace with:

```typescript
        const branded = await brandCustomerText(tenant.id, phone, nudge, { initiated: true });
        if (!branded) continue; // customer opted out of reminders
        const sendRes = await client.sendTextMessage(phone, branded);
```

(In the nudge loop the tenant id is `tenant.id` and the recipient is `phone` — confirmed in the source.)

- [ ] **Step 4: Verify compile + run the rebooking tests**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit && npx jest src/__tests__/api/cron/nightly/rebooking.test.ts`
Expected: compiles. The existing rebooking tests mock `client.sendTextMessage`; they should still pass. If a test asserts the exact message string, update it to expect the branded output OR mock `brandCustomerText` to return its input — prefer mocking the seam:

```typescript
jest.mock('@/lib/whatsapp/v2/outboundBranding', () => ({
  brandCustomerText: jest.fn(async (_t: string, _p: string, reply: string) => reply),
}));
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/nightly/route.ts src/__tests__/api/cron/nightly/rebooking.test.ts
git commit -m "feat(whatsapp): brand rebooking follow-up + nudge, skip opted-out"
```

---

## Task 9: Rename helper + emoji default — `tenantBrand.ts`

**Files:**
- Create: `src/lib/whatsapp/v2/tenantBrand.ts`
- Test: `src/__tests__/lib/whatsapp/v2/tenantBrand.test.ts`
- Modify: `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts`
- Modify: `src/app/api/admin/tenant/[id]/settings/route.ts`

- [ ] **Step 1: Write the failing test for `suggestEmojiForVertical`**

```typescript
// src/__tests__/lib/whatsapp/v2/tenantBrand.test.ts
import { suggestEmojiForVertical } from '@/lib/whatsapp/v2/tenantBrand';

describe('suggestEmojiForVertical', () => {
  it.each([
    ['barber', '✂️'],
    ['barbershop', '✂️'],
    ['salon', '💇'],
    ['spa', '💆'],
    ['dental', '🦷'],
  ])('maps %s → %s', (vertical, emoji) => {
    expect(suggestEmojiForVertical(vertical)).toBe(emoji);
  });

  it('returns null for unknown / missing vertical', () => {
    expect(suggestEmojiForVertical('gym')).toBeNull();
    expect(suggestEmojiForVertical(null)).toBeNull();
    expect(suggestEmojiForVertical(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/tenantBrand.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tenantBrand.ts`**

```typescript
// src/lib/whatsapp/v2/tenantBrand.ts
/**
 * Tenant brand maintenance: emoji defaults + rename bookkeeping.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export function suggestEmojiForVertical(vertical: string | null | undefined): string | null {
  switch ((vertical ?? '').toLowerCase()) {
    case 'barber':
    case 'barbershop':
      return '✂️';
    case 'salon':
    case 'hair':
      return '💇';
    case 'spa':
      return '💆';
    case 'dental':
    case 'dentist':
      return '🦷';
    default:
      return null;
  }
}

/**
 * Records a customer-facing rename: archives the current name into
 * previous_names with a timestamp and sets the new display_name + renamed_at.
 */
export async function renameTenantBrand(tenantId: string, newDisplayName: string): Promise<void> {
  const { data: t } = await supabaseAdmin
    .from('tenants')
    .select('name, display_name, previous_names')
    .eq('id', tenantId)
    .maybeSingle();
  if (!t) throw new Error(`renameTenantBrand: tenant ${tenantId} not found`);

  const currentName = (t.display_name as string | null) ?? (t.name as string);
  const prev = Array.isArray(t.previous_names) ? t.previous_names : [];
  const now = new Date().toISOString();

  await supabaseAdmin
    .from('tenants')
    .update({
      display_name: newDisplayName,
      previous_names: [...prev, { name: currentName, renamed_at: now }],
      renamed_at: now,
    })
    .eq('id', tenantId);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/tenantBrand.test.ts`
Expected: PASS.

- [ ] **Step 5: Default the emoji at activation**

In `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts`, find the `activateV2` function. It currently builds an `updates` object and sets `routing_code` when missing. Add an emoji default alongside it.

Add the import near the top:

```typescript
import { suggestEmojiForVertical } from '@/lib/whatsapp/v2/tenantBrand';
```

Change the tenant select inside `activateV2` to also fetch `vertical` and `brand_emoji`:

```typescript
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, name, routing_code, v2_enabled, vertical, brand_emoji')
    .eq('id', tenantId)
    .maybeSingle();
```

Then, after the existing `if (!tenantRow?.routing_code && tenantRow?.name) { ... }` block, add:

```typescript
  if (!tenantRow?.brand_emoji) {
    const emoji = suggestEmojiForVertical((tenantRow as { vertical?: string } | null)?.vertical);
    if (emoji) updates.brand_emoji = emoji;
  }
```

> If the `tenants` table has no `vertical` column in your schema, omit it from the select and pass `null` to `suggestEmojiForVertical` — the owner can set the emoji manually later. (Header still works; emoji is simply omitted.)

- [ ] **Step 6: Wire `renameTenantBrand` into the settings PUT route**

In `src/app/api/admin/tenant/[id]/settings/route.ts`, the `PUT` handler (tenant id = `ctx.params?.id`) updates the account `name`. A change to the *customer-facing* brand must go through `renameTenantBrand` so the prior name is archived and `renamed_at` is set (this is what powers the "formerly" line).

Add the import near the top:

```typescript
import { renameTenantBrand } from '@/lib/whatsapp/v2/tenantBrand';
```

Add `display_name` to `UpdateSettingsSchema` (after the `name` field):

```typescript
  display_name: z.string().trim().optional(),
```

In the `PUT` handler, AFTER the existing `.from('tenants').update(payload)...` block (after the `if (error) { throw ... }` check, before `return { success: true, ... }`), add:

```typescript
    // Customer-facing rename goes through the brand helper so previous_names
    // and renamed_at are recorded (drift "formerly" support). Do NOT route this
    // through `payload` — that would skip the bookkeeping.
    if (data.display_name !== undefined) {
      await renameTenantBrand(tenantId, data.display_name);
    }
```

> Note: `data.display_name` must NOT be added to `payload` — `renameTenantBrand` owns the `display_name`/`previous_names`/`renamed_at` write.

- [ ] **Step 7: Verify compile**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/v2/tenantBrand.ts src/__tests__/lib/whatsapp/v2/tenantBrand.test.ts "src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts" "src/app/api/admin/tenant/[id]/settings/route.ts"
git commit -m "feat(whatsapp): tenant rename bookkeeping + vertical emoji default"
```

---

## Task 10: Full suite + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full v2 + cron suites**

Run: `npx jest src/__tests__/lib/whatsapp/v2 src/__tests__/api/cron/nightly`
Expected: all green.

- [ ] **Step 2: Typecheck the whole project**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: no new errors introduced by this work.

- [ ] **Step 3: Manual reasoning smoke (document in the PR description)**

Confirm by tracing the code:
- New customer first message (no conv row) → reply carries header + footer.
- Same customer replies 2 min later → mid-conversation, no header.
- Customer replies 40 min later → header again.
- Cron nudge to a customer last seen before a rename → header + "(formerly X)".
- Customer texts "STOP" → unsubscribe confirmation; next cron nudge skipped; their own follow-up message still answered.
- Owner/staff message → no header.

- [ ] **Step 4: Final commit (if any test fixtures changed)**

```bash
git add -A
git commit -m "test(whatsapp): brand identity suite green"
```

---

## Notes carried from exploration

- Run `tsc` with `NODE_OPTIONS="--max-old-space-size=4096"` (large codebase) and batch fixes before re-running.
- `@/lib/billing/ai-wallet` (`withTenantWalletSpend`) already exists — relevant to the program's future "Spec 5 (per-tenant wallet)", which is more built than the spec appendix assumed. Out of scope here; flagged for that spec.
- Keep the `.ilike()`-not-`.or()` rule for any future PostgREST lookups from AI-provided values (not touched by this plan).
