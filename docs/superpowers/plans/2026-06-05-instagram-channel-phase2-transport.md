# Instagram Channel — Phase 2: Transport & Identity (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An Instagram DM to a connected account flows through the existing v2 pipeline and the agent replies on Instagram — WhatsApp behavior byte-for-byte unchanged.

**Architecture:** Generalize the conversation identity from `phone` to `(channel, externalId)` using **optional params with WhatsApp defaults**, so existing call sites are untouched. Add an Instagram provider adapter and webhook that map the recipient IG account → tenant (no routing code) and enqueue into `whatsapp_message_queue` exactly like the WhatsApp webhook. The worker selects the send adapter by the conversation's channel.

**Depends on:** Phase 1 migration `078_instagram_channel.sql` (applied ✅ — adds `channel`, `external_id`, partial unique index).

**Tech Stack:** Next.js App Router, Supabase, TypeScript, Jest (jsdom), Meta Instagram Messaging API.

---

## Task list

1. **Channel-aware `conversationState` + `identityResolver`** (this plan, fully detailed) — defaults preserve WhatsApp.
2. **IG provider adapter** (charter) — `sendText`/`sendMedia` via IG Send API; generalize provider selection by channel.
3. **`/api/webhooks/instagram`** (charter) — GET verify + POST (signature, recipient→tenant, normalize, enqueue).
4. **Worker reply routing by channel** (charter) — pick adapter from conversation channel.
5. **Wire `processMessageV2` for channel** (charter) — thread channel through batch/conversation/send.

Tasks 2–5 are chartered at the bottom and get expanded once Task 1 is merged (they require reading `messageBatcher.ts`, `evolutionClient.getTenantWhatsAppConfig`, the worker, and the live IG Send API shape).

---

## Task 1: Channel-aware `conversationState` + `identityResolver`

**Context:** After migration 078, `whatsapp_conversations` has `channel` (default `'whatsapp'`) and `external_id` (backfilled = `phone_number` for existing rows). Today `conversationState` queries by `.eq('phone_number', phone)` and `ensureConversation` upserts with `onConflict: 'phone_number,tenant_id'`. We make these channel-aware **without changing any caller**: add a trailing optional `channel = 'whatsapp'` param and key reads/writes on `(channel, external_id)`. For WhatsApp we ALSO keep writing `phone_number` and keep using the `phone_number,tenant_id` conflict target, so the existing unique constraint and behavior are preserved. Instagram rows set `phone_number = null` and use the partial unique index `(tenant_id, channel, external_id)`.

**Files:**
- Modify: `src/lib/whatsapp/v2/conversationState.ts`
- Modify: `src/lib/whatsapp/v2/identityResolver.ts`
- Create: `src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts`

- [ ] **Step 1: Write the failing test for `conversationState` (Instagram path)**

Create `src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts`. Use the project's queue-based Supabase mock (mirrors `src/__tests__/lib/whatsapp/v2/actionValidator.test.ts`). The test asserts that an Instagram `ensureConversation` writes `channel:'instagram'`, `external_id`, and `phone_number:null`, and conflicts on the channel key.

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow; error: null }> = [];
const upsertCalls: Array<{ values: Record<string, unknown>; opts: Record<string, unknown> }> = [];

function pushDb(data: DbRow) { responses.push({ data, error: null }); }

function makeChain() {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order', 'limit'].forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  (chain as any).single = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  (chain as any).upsert = jest.fn().mockImplementation((values: any, opts: any) => {
    upsertCalls.push({ values, opts });
    return chain;
  });
  (chain as any).insert = jest.fn().mockResolvedValue({ data: null, error: null });
  (chain as any).update = jest.fn().mockReturnValue(chain);
  return chain;
}

const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));

import { ensureConversation } from '@/lib/whatsapp/v2/conversationState';

beforeEach(() => { responses.length = 0; upsertCalls.length = 0; });

describe('ensureConversation channel-awareness', () => {
  it('writes an Instagram row keyed on (channel, external_id) with null phone', async () => {
    pushDb({ id: 'c1', tenant_id: 't1', phone_number: null, external_id: 'IGSID_1', channel: 'instagram', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {} });
    await ensureConversation('IGSID_1', 't1', 'customer', 'instagram');
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].values).toMatchObject({ channel: 'instagram', external_id: 'IGSID_1', phone_number: null, tenant_id: 't1' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'tenant_id,channel,external_id' });
  });

  it('defaults to WhatsApp: writes phone_number and conflicts on phone_number,tenant_id', async () => {
    pushDb({ id: 'c2', tenant_id: 't1', phone_number: '+2348000000000', external_id: '+2348000000000', channel: 'whatsapp', role: 'customer', current_flow: 'idle', flow_step: 0, flow_data: {} });
    await ensureConversation('+2348000000000', 't1', 'customer');
    expect(upsertCalls[0].values).toMatchObject({ channel: 'whatsapp', external_id: '+2348000000000', phone_number: '+2348000000000' });
    expect(upsertCalls[0].opts).toMatchObject({ onConflict: 'phone_number,tenant_id' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts -i`
Expected: FAIL — current `ensureConversation` ignores the `channel` arg and always writes `phone_number`/`onConflict: 'phone_number,tenant_id'`.

- [ ] **Step 3: Make `conversationState` channel-aware**

In `src/lib/whatsapp/v2/conversationState.ts`, update the four functions. Add a trailing optional `channel: string = 'whatsapp'` and key on `(channel, external_id)`. Branch the WhatsApp vs Instagram write shape.

`getConversation`:
```typescript
export async function getConversation(
  externalId: string,
  tenantId: string,
  channel: string = 'whatsapp'
): Promise<ConvState | null> {
  const { data } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('id, tenant_id, phone_number, external_id, channel, role, current_flow, flow_step, flow_data')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data as ConvState | null) ?? null;
}
```

`ensureConversation`:
```typescript
export async function ensureConversation(
  externalId: string,
  tenantId: string,
  role: ConvRole = 'unknown',
  channel: string = 'whatsapp'
): Promise<ConvState> {
  const isWhatsApp = channel === 'whatsapp';
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .upsert(
      {
        channel,
        external_id: externalId,
        phone_number: isWhatsApp ? externalId : null,
        tenant_id: tenantId,
        role,
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
      },
      {
        onConflict: isWhatsApp ? 'phone_number,tenant_id' : 'tenant_id,channel,external_id',
        ignoreDuplicates: true,
      }
    )
    .select('id, tenant_id, phone_number, external_id, channel, role, current_flow, flow_step, flow_data')
    .single();

  if (error || !data) {
    const existing = await getConversation(externalId, tenantId, channel);
    if (!existing) throw new Error(`[conversationState] ensureConversation failed: ${error?.message}`);
    return existing;
  }
  return data as ConvState;
}
```

`updateConversation` and `resetConversation`:
```typescript
export async function updateConversation(
  externalId: string,
  tenantId: string,
  patch: ConvStatePatch,
  channel: string = 'whatsapp'
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .update(patch)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId);
  if (error) {
    console.error('[conversationState] updateConversation error', error);
    throw error;
  }
}

export async function resetConversation(
  externalId: string,
  tenantId: string,
  channel: string = 'whatsapp'
): Promise<void> {
  await updateConversation(externalId, tenantId, {
    current_flow: 'idle',
    flow_step: 0,
    flow_data: {},
  }, channel);
}
```

Also add `external_id?: string` and `channel?: string` to the `ConvState` type if it is explicitly typed in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts -i`
Expected: PASS (both cases).

- [ ] **Step 5: Write the failing test for `identityResolver` (Instagram path)**

Create `src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts` (same mock harness as Step 1, plus `order`/`limit` on the chain). Assert that for `channel='instagram'`, resolution looks up an existing conversation by `(channel, external_id)` and returns its tenant as a customer; with no existing conversation it returns `tenantId: null` (the webhook supplies the tenant from the recipient account — routing codes and the owner/staff phone shortcut are WhatsApp-only).

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type DbRow = Record<string, unknown> | null;
const responses: Array<{ data: DbRow; error: null }> = [];
function pushList(rows: Array<Record<string, unknown>>) { responses.push({ data: rows as any, error: null }); }
function pushOne(row: DbRow) { responses.push({ data: row, error: null }); }

function makeChain() {
  const chain: Record<string, unknown> = {};
  ['select', 'eq', 'neq', 'ilike', 'in', 'lt', 'gt', 'lte', 'gte', 'not', 'order'].forEach(m => {
    (chain as any)[m] = jest.fn().mockReturnValue(chain);
  });
  (chain as any).limit = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: [], error: null }));
  (chain as any).maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(responses.shift() ?? { data: null, error: null }));
  return chain;
}
const mockClient = { from: jest.fn().mockImplementation(() => makeChain()) };
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => mockClient) }));

import { resolveIncoming } from '@/lib/whatsapp/v2/identityResolver';

beforeEach(() => { responses.length = 0; });

describe('resolveIncoming Instagram', () => {
  it('resolves an existing IG conversation to its tenant as customer', async () => {
    pushList([{ tenant_id: 't9', role: 'customer' }]); // Step 1 existing-conversation lookup
    const r = await resolveIncoming('instagram', 'IGSID_9', 'hi do you have space saturday');
    expect(r.tenantId).toBe('t9');
    expect(r.role).toBe('customer');
  });

  it('returns null tenant for an unknown IG sender (webhook supplies tenant)', async () => {
    pushList([]); // no existing conversation
    const r = await resolveIncoming('instagram', 'IGSID_NEW', 'GLOW12 hello');
    expect(r.tenantId).toBeNull();
    expect(r.routingCodeFound).toBe(false); // routing codes are WhatsApp-only
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx jest src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts -i`
Expected: FAIL — `resolveIncoming` currently takes `(phone, messageText)` and has no channel branch.

- [ ] **Step 7: Make `resolveIncoming` channel-aware**

In `src/lib/whatsapp/v2/identityResolver.ts`, change the signature to `resolveIncoming(channel, externalId, messageText)` and branch. Keep all existing WhatsApp logic intact under the `whatsapp` branch (querying by `external_id` now instead of `phone_number`, since 078 backfilled it). For `instagram`, only do the existing-conversation lookup; otherwise return `baseResult` (unknown tenant).

```typescript
export async function resolveIncoming(
  channel: string,
  externalId: string,
  messageText: string
): Promise<ResolvedIdentity> {
  const baseResult: ResolvedIdentity = {
    tenantId: null,
    role: 'unknown',
    routingCodeFound: false,
    strippedMessage: messageText.trim(),
  };

  // ── Step 1: Existing conversation (all channels) ──
  const { data: existingConvs } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('tenant_id, role')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .not('tenant_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (existingConvs && existingConvs.length > 0) {
    const conv = existingConvs[0];
    let resolvedRole = (conv.role as ResolvedIdentity['role']) ?? 'customer';
    if (channel === 'whatsapp') {
      const staffRole = await resolveStaffRole(externalId, conv.tenant_id);
      if (staffRole) resolvedRole = staffRole;
    }
    return { ...baseResult, tenantId: conv.tenant_id, role: resolvedRole };
  }

  // ── WhatsApp-only: owner/staff phone shortcut + routing code ──
  if (channel === 'whatsapp') {
    const staffResult = await resolveByPhone(externalId);
    if (staffResult) return { ...baseResult, ...staffResult };

    const codeMatch = messageText.match(ROUTING_CODE_PATTERN);
    if (codeMatch) {
      const code = codeMatch[1];
      const { data: tenant } = await supabaseAdmin
        .from('tenants').select('id')
        .eq('routing_code', code).eq('v2_enabled', true).maybeSingle();
      if (tenant) {
        const stripped = messageText.replace(codeMatch[0], '').trim();
        return { tenantId: tenant.id, role: 'customer', routingCodeFound: true, strippedMessage: stripped || messageText.trim() };
      }
    }
  }

  return baseResult;
}
```

- [ ] **Step 8: Update the three WhatsApp webhook callers to pass the channel**

`resolveIncoming` now takes `(channel, externalId, messageText)`. Update each existing caller to pass `'whatsapp'` first. Files & lines:
- `src/app/api/webhooks/whatsapp/route.ts:200` → `resolveIncoming('whatsapp', fromNumber, content)`
- `src/app/api/webhooks/whatsapp/meta/route.ts:339` → `resolveIncoming('whatsapp', fromNumber, content)`
- `src/app/api/webhooks/whatsapp/[tenantId]/route.ts:641` → `resolveIncoming('whatsapp', fromNumber, content)`

(`ensureConversation`/`getConversation`/`updateConversation`/`resetConversation` callers need NO change — the new `channel` param defaults to `'whatsapp'`.)

- [ ] **Step 9: Run the full WhatsApp/v2 suite + typecheck (regression guard)**

Run: `npx jest src/__tests__/lib/whatsapp -i`
Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: all existing v2 suites pass; 0 TS errors (defaults keep every untouched caller valid).

- [ ] **Step 10: Commit**

```bash
git add src/lib/whatsapp/v2/conversationState.ts src/lib/whatsapp/v2/identityResolver.ts \
        src/app/api/webhooks/whatsapp/route.ts src/app/api/webhooks/whatsapp/meta/route.ts \
        src/app/api/webhooks/whatsapp/[tenantId]/route.ts \
        src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts \
        src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts
git commit -m "feat(whatsapp): channel-aware identity + conversation state (WhatsApp defaults preserved)"
```

---

## Tasks 2–5 (charters — expand after Task 1 merges)

**Task 2 — IG provider adapter.** Create `src/lib/whatsapp/providers/instagram.ts` implementing a minimal `ChannelClient { sendText, sendMedia }` against the IG Send API (`POST https://graph.instagram.com/<ver>/me/messages` with `{ recipient: { id: IGSID }, message: { text } }`, bearer = tenant IG token). Generalize `getProviderClient`/provider selection to return the IG adapter when `channel='instagram'`. *Reads first:* live IG Send API shape; `providers/index.ts`, `evolutionClient.getTenantWhatsAppConfig`.

**Task 3 — `/api/webhooks/instagram`.** GET verify (`hub.mode`/`hub.verify_token`/`hub.challenge`); POST: verify `X-Hub-Signature-256` against the app secret, extract recipient IG account id + sender IGSID + text, map recipient account → tenant (via stored IG account id from Phase 3), then mirror `webhooks/whatsapp/route.ts:197` exactly (`resolveIncoming('instagram', igsid, text)` → `ensureConversation(igsid, tenant, role, 'instagram')` → enqueue `whatsapp_message_queue` with a `channel` marker). *Reads first:* the WhatsApp webhook body in full; `whatsapp_message_queue` columns.

**Task 4 — Worker reply routing by channel.** In the worker / `processMessageV2` send path (`pipeline.ts:519`), select the adapter by the conversation's `channel` instead of always WhatsApp. *Reads first:* `src/app/api/worker/whatsapp/route.ts`, `pipeline.ts` send helpers.

**Task 5 — Thread channel through `processMessageV2`.** Add a `channel` param (default `'whatsapp'`) to `processMessageV2`, `claimBatch`, and the flow handlers, defaulting to WhatsApp so existing callers are unchanged; the IG queue path passes `'instagram'`. *Reads first:* `messageBatcher.ts`, the flow handlers' signatures.

---

## Self-review (Task 1)

- **Spec coverage:** Implements the "generalize identity by (channel, external_id)" half of spec §6 with WhatsApp defaults; transport/webhook/worker are Tasks 2–5.
- **Placeholder scan:** Task 1 has complete code + tests. Tasks 2–5 are declared charters.
- **Consistency:** `onConflict` targets match migration 078 (`phone_number,tenant_id` kept for WA; `tenant_id,channel,external_id` partial unique for IG). Param order `(externalId, tenantId, role?, channel?)` is consistent across all four `conversationState` functions; `resolveIncoming(channel, externalId, messageText)` matches all three updated callers.
