# Conversation And Support Boundaries

**Date:** 2026-06-30
**Status:** Canonical reference for inbox, AI state, escalation, and support ownership.

## Why this note exists

The repo currently stores customer communication and support operations across several tables:

- `chats`
- `messages`
- `whatsapp_conversations`
- `escalation_queue`
- `support_tickets`
- `support_messages`
- `support_assignments`

These are not meant to be competing sources of truth. They are different records for different
concerns. This note makes that explicit so future work does not merge unrelated domains.

## Core rule

There are **two different support domains** in Booka:

1. **Tenant-to-customer support**
   - A tenant's staff handling that tenant's customers.
   - Lives in the inbox stack.

2. **Tenant-to-Booka support**
   - A tenant asking Booka/superadmin for help with the platform.
   - Lives in the support ticket stack.

These domains must stay separate.

## Customer communication model

### `messages`

**Source of truth for message history.**

One row per inbound or outbound message event.

Owns:
- message content
- direction
- timestamp
- provider/raw payload
- user attribution for outbound staff replies

Does **not** own:
- inbox listing state
- AI workflow state
- handoff queue state

### `chats`

**Source of truth for inbox thread listing.**

One row per tenant-visible customer conversation thread.

Owns:
- thread identity in the dashboard
- customer identity pointer (`customer_phone`)
- thread-level summary metadata
- last message time
- unread count

This is a denormalized operational index over message history. It exists so the inbox does not have
to derive its thread list from raw `messages` on every render.

### `whatsapp_conversations`

**Source of truth for AI/runtime conversation state.**

Despite the historical name, this table is already multi-channel for WhatsApp and Instagram. It
stores the state machine used by the v2 front desk.

Owns:
- `role`
- `current_flow`
- `flow_step`
- `flow_data`
- `last_inbound_at`
- opt-out state
- human takeover state (`flow_data.human_handling_until`)

It does **not** own message history or inbox listing.

Long-term, this table should likely be renamed to something like
`channel_conversations` or `conversation_runtime_state`, but the behavioral boundary is what matters
now.

### `escalation_queue`

**Source of truth for human-handoff work items.**

One row per “this conversation needs a human” event.

Owns:
- why a handoff happened
- whether it is pending/claimed/resolved
- which staff member claimed it
- conversation snapshot for operator context

It does **not** replace `chats`, `messages`, or `whatsapp_conversations`.

## Booka support model

### `support_tickets`

**Source of truth for tenant-to-Booka support cases.**

This is for platform support, not customer chat handling.

Examples:
- billing issue
- Instagram connection broken
- AI misbehavior
- configuration/support request

Owns:
- tenant support case lifecycle
- subject/description
- status/priority
- current assignee

### `support_messages`

**Source of truth for tenant-to-Booka support thread history.**

Owns:
- ticket conversation messages
- author identity (`author_id`)
- author role (`tenant` or `support`)
- internal/private flags where applicable

### `support_assignments`

**Source of truth for assignment events/history for Booka support tickets.**

Owns:
- who assigned a ticket
- who it was assigned to
- when assignment happened

`support_tickets.assignee_id` is the current assignee.
`support_assignments` is the assignment log.

## Practical interpretation

When a customer sends a message:

1. `messages` stores the message event
2. `chats` updates inbox summary state
3. `whatsapp_conversations` updates AI/runtime state
4. `escalation_queue` is written only if human attention is required

When a tenant asks Booka for platform help:

1. `support_tickets` stores the case
2. `support_messages` stores the conversation thread
3. `support_assignments` stores assignment history

No customer conversation rows should be inserted into `support_*` tables just because a tenant is
helping one of its clients.

## Implementation guidance

- Build customer support features on top of:
  - `chats`
  - `messages`
  - `whatsapp_conversations`
  - `escalation_queue`

- Build Booka support features on top of:
  - `support_tickets`
  - `support_messages`
  - `support_assignments`

- Social listening may route into either:
  - leads
  - customer inbox/escalation
  - Booka support

But it should route by intent, not by table convenience.
