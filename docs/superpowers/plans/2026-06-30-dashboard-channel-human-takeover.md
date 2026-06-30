# Dashboard Channel — Human Takeover & Escalation Surfacing — Implementation Plan

> **For the implementer (Codex):** TDD per task — failing test, run, implement, run green, commit.
> Stage only each task's files via `git commit -- <paths>`; never `git add -A`. Before committing,
> `git status --short` and skip column-1 `M`/`A` files (staged by other sessions).

**Spec:** `docs/superpowers/specs/2026-06-30-dashboard-channel-human-takeover-design.md`
**Goal:** When staff reply from the dashboard, pause the AI for that conversation (human takeover);
surface `escalation_queue` handoffs in the chats UI.

**Repo conventions:** Jest + ts-jest + jsdom, `@jest/globals`, `@/`→`src/`. API: `createHttpHandler`.
Conversation helpers: `getConversation/updateConversation(externalId, tenantId, patch, channel)` in
`src/lib/whatsapp/v2/conversationState.ts`. Takeover flag lives in `whatsapp_conversations.flow_data`
(no migration). Channel mapping: `chats.metadata.channel === 'instagram' ? 'instagram' : 'whatsapp'`;
`chats.customer_phone` is the conversation `external_id` for both channels.

---

## Task 1 — Human-takeover helper (TDD)

**Files:** Create `src/lib/whatsapp/v2/humanTakeover.ts`, `…/humanTakeover.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const getConversation = jest.fn();
const updateConversation = jest.fn();
jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation: (...a: unknown[]) => getConversation(...a),
  updateConversation: (...a: unknown[]) => updateConversation(...a),
}));

import { isHumanHandling, setHumanHandling, clearHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';

describe('isHumanHandling', () => {
  const now = Date.parse('2026-06-30T12:00:00.000Z');
  it('true when human_handling_until is in the future', () => {
    expect(isHumanHandling({ human_handling_until: '2026-06-30T12:30:00.000Z' }, now)).toBe(true);
  });
  it('false when expired or unset', () => {
    expect(isHumanHandling({ human_handling_until: '2026-06-30T11:30:00.000Z' }, now)).toBe(false);
    expect(isHumanHandling({}, now)).toBe(false);
    expect(isHumanHandling(null, now)).toBe(false);
  });
});

describe('setHumanHandling / clearHumanHandling', () => {
  beforeEach(() => { getConversation.mockReset(); updateConversation.mockReset(); });

  it('merges a future timestamp into flow_data', async () => {
    getConversation.mockResolvedValue({ flow_data: { opt_in: { at: 'x' } } });
    await setHumanHandling({ externalId: '234', tenantId: 't1', channel: 'whatsapp', minutes: 30 });
    const [extId, tenantId, patch, channel] = updateConversation.mock.calls[0] as [string, string, { flow_data: Record<string, unknown> }, string];
    expect(extId).toBe('234'); expect(tenantId).toBe('t1'); expect(channel).toBe('whatsapp');
    expect(patch.flow_data.opt_in).toEqual({ at: 'x' });
    expect(typeof patch.flow_data.human_handling_until).toBe('string');
  });

  it('clear removes the key', async () => {
    getConversation.mockResolvedValue({ flow_data: { human_handling_until: 'x', opt_in: 1 } });
    await clearHumanHandling({ externalId: '234', tenantId: 't1', channel: 'whatsapp' });
    const [, , patch] = updateConversation.mock.calls[0] as [string, string, { flow_data: Record<string, unknown> }, string];
    expect(patch.flow_data.human_handling_until).toBeUndefined();
    expect(patch.flow_data.opt_in).toBe(1);
  });

  it('no-op when conversation missing', async () => {
    getConversation.mockResolvedValue(null);
    await setHumanHandling({ externalId: 'x', tenantId: 't', channel: 'whatsapp', minutes: 30 });
    expect(updateConversation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx jest src/lib/whatsapp/v2/humanTakeover.test.ts`
- [ ] **Step 3: Implement**

```typescript
import { getConversation, updateConversation } from './conversationState';
import type { ConvChannel } from './conversationState';

const KEY = 'human_handling_until';

export function isHumanHandling(flowData: Record<string, unknown> | null | undefined, now: number = Date.now()): boolean {
  const until = flowData?.[KEY];
  return typeof until === 'string' && Date.parse(until) > now;
}

interface Target { externalId: string; tenantId: string; channel: ConvChannel }

export async function setHumanHandling(args: Target & { minutes: number }): Promise<void> {
  const conv = await getConversation(args.externalId, args.tenantId, args.channel);
  if (!conv) return;
  const until = new Date(Date.now() + args.minutes * 60_000).toISOString();
  await updateConversation(
    args.externalId, args.tenantId,
    { flow_data: { ...(conv.flow_data ?? {}), [KEY]: until } }, args.channel,
  );
}

export async function clearHumanHandling(args: Target): Promise<void> {
  const conv = await getConversation(args.externalId, args.tenantId, args.channel);
  if (!conv) return;
  const next = { ...(conv.flow_data ?? {}) };
  delete (next as Record<string, unknown>)[KEY];
  await updateConversation(args.externalId, args.tenantId, { flow_data: next }, args.channel);
}
```

- [ ] **Step 4: PASS. Step 5: Commit** `git commit -- src/lib/whatsapp/v2/humanTakeover.ts src/lib/whatsapp/v2/humanTakeover.test.ts -m "feat(takeover): human-handling flow_data helper"`

---

## Task 2 — Pause the AI in the pipeline

**Files:** Modify `src/lib/whatsapp/v2/pipeline.ts`; modify `src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts`

- [ ] **Step 1: Add import** (next to the other v2 imports near the top):

```typescript
import { isHumanHandling } from './humanTakeover';
```

- [ ] **Step 2: Insert the pause** in `handleCustomerMessage`, immediately AFTER the opt-in proof block (the block that calls `buildOptInProofPatch`) and BEFORE the `wantsHuman(message)` check:

```typescript
  // A human is handling this conversation from the dashboard → don't auto-reply.
  // (Inbound was already persisted by the webhook, so it still shows in the inbox.)
  if (isHumanHandling(conv!.flow_data)) {
    await markMessagesProcessed(allMessageIds);
    return;
  }
```

- [ ] **Step 3: Test** — add to `pipeline.channel.test.ts` a case where `getConversation` returns a conv with a future `flow_data.human_handling_until`, drive a customer message, and assert no provider send occurs (mirror the existing channel-test mocks; `updateConversation` is already mocked there). Run: `npx jest src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts` → green.

- [ ] **Step 4: Commit** `git commit -- src/lib/whatsapp/v2/pipeline.ts src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts -m "feat(takeover): pause AI when a human is handling the chat"`

---

## Task 3 — Set takeover on a staff reply

**Files:** Modify `src/app/api/chats/[id]/messages/route.ts`

- [ ] **Step 1: Add import**

```typescript
import { setHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';
```

- [ ] **Step 2: After the message insert succeeds** (right after `span.addEvent('Message inserted into DB');`), pause the AI for this conversation:

```typescript
      // Staff replied → a human is handling; pause the AI for a window.
      await setHumanHandling({
        externalId: chat.customer_phone,
        tenantId: chat.tenant_id,
        channel,
        minutes: 30,
      }).catch((e) => defaultLogger.warn('setHumanHandling failed', { error: String(e) }));
```

- [ ] **Step 3: Typecheck** `npm run typecheck 2>&1 | grep -i "chats/\[id\]/messages" || echo OK`
- [ ] **Step 4: Commit** `git commit -- "src/app/api/chats/[id]/messages/route.ts" -m "feat(takeover): staff reply pauses AI for 30m"`

---

## Task 4 — Release-to-AI route + composer control

**Files:** Create `src/app/api/chats/[id]/release/route.ts`; modify `src/components/chat/ChatComposer.tsx` (+ its test if present)

- [ ] **Step 1: Release route**

```typescript
export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { clearHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';

export const POST = createHttpHandler(
  async (ctx) => {
    const chatId = ctx.params?.id;
    if (!chatId) throw ApiErrorFactory.validationError({ id: 'chat id required' });
    const admin = createSupabaseAdminClient();
    const { data: chat } = await admin.from('chats').select('tenant_id, customer_phone, metadata').eq('id', chatId).single();
    if (!chat) throw ApiErrorFactory.notFound('Chat');
    if (ctx.user?.tenantId && ctx.user.tenantId !== chat.tenant_id) throw ApiErrorFactory.forbidden('Access denied');
    const channel = chat.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp';
    await clearHumanHandling({ externalId: chat.customer_phone, tenantId: chat.tenant_id, channel });
    return { success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'staff'] },
);
```

- [ ] **Step 2: Composer control.** In `ChatComposer`, add a "Release to AI" button that `authPost`s `/api/chats/${chatId}/release` (pass the active chat id through props if not already available). Show a small "You're handling this — AI paused" hint while handling. Keep the existing send behaviour. Add/extend a component test asserting the release POST fires.
- [ ] **Step 3: Commit** `git commit -- "src/app/api/chats/[id]/release/route.ts" src/components/chat/ChatComposer.tsx -m "feat(takeover): release-to-AI route + composer control"`

---

## Task 5 — Escalation surfacing in the chats UI

**Files:** Create `src/components/chat/EscalationBanner.tsx`, `…test.tsx`; mount in `ChatsPanel`

- [ ] **Step 1: Failing test** (mock `@/lib/auth/auth-api-client`)

```tsx
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { ApiResponse } from '@/lib/auth/auth-api-client';

const authGet = jest.fn<(u: string) => Promise<ApiResponse<unknown>>>();
const authPost = jest.fn<(u: string, b?: unknown) => Promise<ApiResponse<unknown>>>();
jest.mock('@/lib/auth/auth-api-client', () => ({
  authGet: (...a: unknown[]) => authGet(...(a as [string])),
  authPost: (...a: unknown[]) => authPost(...(a as [string, unknown])),
}));

import EscalationBanner from '@/components/chat/EscalationBanner';

describe('EscalationBanner', () => {
  beforeEach(() => { authGet.mockReset(); authPost.mockReset(); authPost.mockResolvedValue({ status: 200, data: { success: true } }); });

  it('shows pending escalations and claims one', async () => {
    authGet.mockResolvedValue({ status: 200, data: { escalations: [{ id: 'e1', customer_phone: '234', reason: 'wants human' }] } });
    const onOpen = jest.fn();
    render(<EscalationBanner onOpenCustomer={onOpen} />);
    expect(await screen.findByText(/wants human/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /claim/i }));
    await waitFor(() => expect(authPost).toHaveBeenCalledWith('/api/escalation', expect.objectContaining({ id: 'e1', status: 'claimed' })));
    expect(onOpen).toHaveBeenCalledWith('234');
  });
});
```

> NOTE: confirm `GET /api/escalation?status=pending` returns `{ escalations: [...] }` (the route in
> `src/app/api/escalation/route.ts` selects `id, customer_phone, session_id, reason, status, …`).
> Adjust the response key in the component/test to match the route's actual envelope.

- [ ] **Step 2: Implement** `EscalationBanner` — `authGet('/api/escalation?status=pending')`, render each with a Claim button → `authPost('/api/escalation', { id, status: 'claimed' })` then `onOpenCustomer(customer_phone)` (parent selects that chat). Mount in `ChatsPanel` above the list, wiring `onOpenCustomer` to `setActiveId` (match by `customer_phone`).
- [ ] **Step 3: PASS. Step 4: Commit** `git commit -- src/components/chat/EscalationBanner.tsx src/components/chat/EscalationBanner.test.tsx src/components/chat/ChatsPanel.tsx -m "feat(takeover): surface + claim escalations in the inbox"`

---

## Self-review checklist
- `npx jest src/lib/whatsapp/v2/humanTakeover.test.ts src/components/chat` green.
- Pipeline pause: a future `human_handling_until` → no provider send; expired/unset → normal AI.
- Staff reply sets the window; "Release to AI" clears it; window auto-expires after 30m.
- Confirm `GET /api/escalation` envelope key before finalizing T5.
- Every commit staged only its own paths.
