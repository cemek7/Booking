# Instagram Phase 4 Close-out

This runbook closes the remaining verification steps for `docs/superpowers/plans/2026-06-04-instagram-channel.md` Phase 4.

## Code already in place

- `/api/chats` now exposes thread channel metadata
- `/api/chats/[id]/messages` now routes Instagram replies through the Instagram provider path
- Instagram replies are blocked outside the 24-hour customer-service window
- `/chat` shows channel badges and Instagram-specific reply guidance
- focused coverage exists for:
  - chat route gating
  - chat realtime hook channel mapping
  - Instagram webhook ingestion

## Focused verification command

```bash
npx jest \
  src/__tests__/app/api/chats/messages.route.test.ts \
  src/__tests__/hooks/useChatRealtime.test.tsx \
  src/__tests__/api/webhooks/instagram/route.test.ts \
  -i
```

Expected: all pass.

## Manual verification

## 1. Connect a tenant Instagram account

Use the tenant settings connect flow and confirm:
- token is stored in `whatsapp_provider_secrets` with `provider = 'instagram'`
- `instance_name` matches the tenant Instagram account id used by the webhook

## 2. Confirm inbound DM thread creation

Send a DM from a customer account to the tenant Instagram account and confirm:
- a `messages` row is created with the Instagram sender id
- a `chats` row is present for that sender
- the chat appears in `/chat` with the `IG` badge

## 3. Confirm in-window reply behavior

Within 24 hours of the inbound DM:
- open the thread in `/chat`
- send a staff reply
- confirm the reply is accepted and delivered through Instagram

## 4. Confirm out-of-window blocking

After the 24-hour window expires, or by manually aging `whatsapp_conversations.last_inbound_at`:
- try a staff reply in `/chat`
- confirm the UI shows the guard message
- confirm no outbound `messages` row is inserted for the blocked send

## 5. Confirm WhatsApp handoff policy

The current implementation blocks the Instagram send and instructs the operator to continue on WhatsApp. Verify your tenant ops flow actually has a WhatsApp path available for the same customer before marking Phase 4 complete.

## Done criteria

Phase 4 is closed when:
- channel badge is visible in `/chat`
- replies route correctly by channel
- Instagram sends are allowed inside the 24-hour window
- Instagram sends are blocked outside the 24-hour window
- staff know to use WhatsApp for proactive follow-up
