# Dashboard Channel — Human Takeover & Escalation Surfacing — Design + Plan

**Date:** 2026-06-30 · **Task:** #11 · **Status:** Grounded design, ready for Codex.

## Repo reality (verified) — the inbox already exists

- `src/app/dashboard/chats/page.tsx` → `ChatsPanel` (`src/components/chat/ChatsPanel.tsx`) with `ChatComposer` + `useChatRealtime`: staff already **select a chat, compose, and send**.
- `src/app/api/chats/[id]/messages/route.ts` POST: inserts `direction:'outbound'` message **and sends to the customer's channel** via `getTenantChannelProviderClient(tenant_id, channel).sendTextMessage(number, text)`.
- The v2 pipeline (`src/lib/whatsapp/v2/pipeline.ts`) auto-replies to inbound customer messages. The only "human" concept is my `humanHandoff` (explicit "agent" → `escalation_queue` ticket, then STOP for that one message). There is **no persistent human-handling state** and **no AI pause**.

**So #11 is NOT "build an inbox."** The real gaps:

1. **No human-takeover state** → after a staff reply, the AI keeps auto-replying to the customer, fighting the human.
2. **Escalation tickets aren't surfaced** in the inbox — `escalation_queue` (built by the handoff work) has no dashboard consumer beyond `api/escalation` GET.

## Scope (the delta only)

1. **Human-takeover / "dashboard channel":** when a staff member replies from the dashboard (or claims an escalation), pause the AI for that conversation for a window; the AI just stores inbound messages without replying until the window lapses or staff "release to AI".
2. **Surface escalations** in the chats UI so staff can see/claim "customer requested human" conversations.

## Decisions

- Takeover state lives in the existing `whatsapp_conversations.flow_data` (JSONB) as `human_handling_until` (ISO). No migration. Reuses the `flow_data` flag pattern already in use (disclosure, opt_in).
- Default window: **30 minutes**, refreshed on each staff reply. Explicit "Release to AI" clears it.
- A claimed escalation also sets the takeover state for that conversation.

## Architecture / files

| File | Change |
|---|---|
| `src/lib/whatsapp/v2/humanTakeover.ts` | NEW — `setHumanHandling(admin, {tenantId, externalId, channel, minutes})`, `clearHumanHandling(...)`, `isHumanHandling(flowData, now?)` (pure) |
| `src/lib/whatsapp/v2/pipeline.ts` | EDIT — in `handleCustomerMessage`, after loading `conv`, if `isHumanHandling(conv.flow_data)` → store inbound (existing path) and `return` before the AI/booking branches |
| `src/app/api/chats/[id]/messages/route.ts` | EDIT — after a successful outbound staff send, call `setHumanHandling` for that conversation |
| `src/app/api/chats/[id]/release/route.ts` | NEW — POST: `clearHumanHandling` (owner/manager/staff) |
| `src/components/chat/ChatComposer.tsx` (or ChatsPanel) | EDIT — add a "Release to AI" control + a "human handling" indicator |
| `src/components/chat/EscalationBanner.tsx` | NEW — lists `escalation_queue` pending items (via `GET /api/escalation?status=pending`), claim → opens that chat + sets takeover |

## Plan (TDD tasks)

**T1 — `humanTakeover.ts` (pure + admin) + test.** `isHumanHandling(flowData, now)` true when `flow_data.human_handling_until` > now. `setHumanHandling` merges `{ human_handling_until: now+minutes }` into flow_data via `updateConversation`. `clearHumanHandling` removes it. Test the pure predicate + that set/clear call updateConversation with the merged patch (mock conversationState like `pipeline.channel.test.ts`).

**T2 — pipeline pause.** In `handleCustomerMessage`, after the opt-in/disclosure block, add: `if (isHumanHandling(conv!.flow_data)) { await markMessagesProcessed(allMessageIds); return; }` (inbound already persisted upstream; no AI reply). Extend `pipeline.channel.test.ts`-style coverage: a conversation with a future `human_handling_until` produces no provider send.

**T3 — set takeover on staff reply.** In `chats/[id]/messages` POST, after the provider handoff, resolve the conversation (tenant_id + channel + customer number) and `setHumanHandling(admin, …, 30)`. Guard: only for outbound staff messages. Add a focused test asserting `setHumanHandling` is invoked.

**T4 — release route + UI control.** `POST /api/chats/[id]/release` → `clearHumanHandling`. Add a "Release to AI" button + "🟢 AI / 🟕 You're handling" indicator in the composer (reads the conversation state via the chats payload). Component test: clicking Release calls the route.

**T5 — escalation surfacing.** `EscalationBanner` fetches `GET /api/escalation?status=pending`, shows count + list; "Claim" sets the chat active and calls a claim (reuse `api/escalation` POST with `status:'claimed'` + `setHumanHandling`). Component test with mocked `authGet/authPost`.

## Out of scope
Full agent-routing/SLA, canned responses, multi-agent assignment UI (escalation already has `assigned_agent_id`). Cross-channel unification beyond what `ChatsPanel.channel` already does.

## Self-review / known gaps
- **Inbound persistence — RESOLVED:** the **webhook** persists the inbound message (`webhooks/whatsapp/route.ts` `persistMessage`, `direction:'inbound'`) *before* `processMessageV2` runs. So pausing the AI in `handleCustomerMessage` does NOT drop messages — they still land in the inbox. T2 only needs to skip the AI reply (`markMessagesProcessed` + `return`).
- **Escalation↔chat mapping — GROUNDED:** `escalation_queue.customer_phone` maps to `chats.customer_phone`; chat channel lives in `chats.metadata.channel` (`'instagram'` else `'whatsapp'`), per `chats/[id]/messages`. EscalationBanner claims map via `customer_phone`.
- **Window refresh vs staleness:** 30-min window auto-expires (avoids stuck states); visible countdown is a later polish.
- **Realtime:** `useChatRealtime` syncs messages; the takeover indicator may lag until next load — acceptable for v1.
