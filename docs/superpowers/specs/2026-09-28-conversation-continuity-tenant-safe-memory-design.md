# Booka Conversation Continuity and Tenant-Safe Memory — Design

**Date:** 2026-09-28
**Status:** Approved in brainstorming — pending implementation plan
**Scope:** Shared-number routing, customer-specific conversation ingestion, active workflow continuity, verified long-term memory, human handoff continuity, and reliability controls across WhatsApp and Instagram.
**Depends on:** the existing v2 WhatsApp/Instagram pipeline, customer commerce memory, tenant isolation, human handoff, and webhook idempotency foundations.

## 1. Objective

Booka must not ask customers to repeat information that it has already received and accepted. It must preserve an unfinished enquiry through follow-up questions, topic changes, retries, worker restarts, and human handoff. It must also remember useful verified preferences across future visits without leaking information between customers or businesses.

The design must work on Booka's shared WhatsApp number, where one external phone number can contact multiple Booka tenants, as well as on dedicated WhatsApp numbers and Instagram.

Success means:

- a routing code always selects the intended tenant;
- the same customer can contact multiple tenants without context crossing;
- every AI decision is grounded in the correct customer's current conversation;
- confirmed workflow fields are not silently forgotten or overwritten;
- rapid, duplicated, delayed, or reordered webhook deliveries do not lose state or duplicate business actions;
- verified long-term facts are tenant-scoped, source-backed, correctable, and deletable;
- human operators and the AI share the same conversation summary and open tasks.

## 2. Current state and confirmed gaps

### 2.1 Foundations already present

- `whatsapp_conversations` is tenant-scoped and carries v2 `role`, `current_flow`, `flow_step`, and `flow_data` state.
- WhatsApp and Instagram conversations are keyed by channel-specific external identifiers.
- `customerBooking.ts` persists structured booking fields under `flow_data.booking_in_progress`, along with option lists, slot locks, and pending confirmations.
- Inbound provider message IDs are used for webhook idempotency.
- Raw inbound messages are persisted and queued before the v2 pipeline executes.
- The pipeline has customer recall, lead context, human handoff, human takeover, opt-in proof, and a first-contact AI disclosure.
- `customers`, `customer_profile_summary`, normalized phone resolution, merge candidates, and atomic customer merge support already exist.
- `messages`, `chats`, `whatsapp_message_queue`, and `whatsapp_conversations` provide most of the storage needed for a durable ingestion path.

### 2.2 Gaps that can cause repeated questions or wrong context

1. **The v2 front-desk prompt does not ingest recent customer-specific turns.** It receives the current message, structured `flow_data`, customer recall, and business grounding, but not the recent transcript or a durable rolling conversation summary.
2. **The existing `llmContextManager` is not safe to wire into v2 as-is.** It locates the latest chat for a tenant, not the exact `(tenant, channel, external customer, conversation)` tuple. Reusing it directly could leak one customer's messages into another customer's prompt.
3. **Shared-number routing is sticky in the wrong place.** `identityResolver.resolveIncoming` checks the most recent conversation for a channel/external ID before checking a routing code. A customer who contacted tenant A can therefore be incorrectly routed back to A when explicitly starting with tenant B's code.
4. **Message batching is a read-modify-write JSON operation.** `appendPendingMessage` and `claimBatch` can overwrite or clear messages when webhook and worker writes overlap.
5. **Conversation state patches use a previously loaded `flow_data` object.** Concurrent handlers can overwrite fields written by another handler because there is no state version or compare-and-swap guard.
6. **Structured state depends too heavily on optional model output.** General enquiry details can remain only in prose if the model does not return `booking_update`, allowing them to disappear on the next turn.
7. **`whatsapp_conversations` represents a long-lived channel relationship, not an individual enquiry thread.** Resetting `flow_data` removes the active task but leaves no first-class historical thread summary or explicit open-loop model.
8. **Cross-channel identity is incomplete.** WhatsApp can resolve a tenant customer by normalized phone, while Instagram has an Instagram-scoped external ID. They must not be merged by name or model inference.
9. **Human handoff snapshots are not the canonical live state.** A later AI resume needs deterministic ingestion of operator messages and the state changes made during takeover.

## 3. Locked product decisions

| Decision | Choice |
|---|---|
| Memory strategy | Hybrid: structured active state + recent turns + rolling summary + verified long-term facts |
| Shared gateway continuity | Explicit routing code opens a 24-hour active tenant route |
| Routing precedence | An explicit valid routing code always overrides previous routing |
| Ambiguous routing | Ask which business the customer wants; never guess |
| Dedicated number | Route directly from the receiving phone-number ID |
| Instagram routing | Route from the receiving Instagram professional account ID |
| Cross-channel linking | Only after a verified shared identifier or explicit customer confirmation |
| Confirmed workflow fields | Cannot be cleared by model omission; only corrected explicitly or invalidated deterministically |
| Long-term memory | Tenant-specific verified facts only, with provenance and expiry |
| Sensitive facts | Health and similarly sensitive details excluded from general memory by default |
| Raw transcript prompting | Bounded recent window, never an unbounded transcript |
| Concurrency | Database-atomic message claiming and optimistic state versioning |
| Provider timeout | Do not blindly resend an outbound message with unknown delivery status |

## 4. Identity and routing model

Booka distinguishes four concepts that are currently partially collapsed:

1. **Channel identity** — a WhatsApp phone number or Instagram-scoped user ID.
2. **Tenant-customer relationship** — that channel identity interacting with one Booka tenant.
3. **Conversation relationship** — the long-lived channel relationship currently represented by `whatsapp_conversations`.
4. **Conversation thread** — one enquiry, booking, sale, or support journey within that relationship.

### 4.1 Shared WhatsApp routing order

For the shared gateway, resolve every inbound message in this order:

1. Validate the receiving Meta phone-number ID is the configured shared gateway.
2. If the message contains a valid routing code, route to that tenant and open/refresh a 24-hour route session.
3. Otherwise, if the sender uniquely matches an owner/staff identity, route operational commands to that tenant. If the person belongs to multiple tenants, request a tenant selection.
4. Otherwise, use one unexpired route session for the shared gateway, channel, and external sender.
5. If there is no route, the route expired, or more than one route is plausible, ask for the business code/link.

An old `whatsapp_conversations` row is not sufficient evidence of the currently intended tenant. A routing code always wins, including when the sender owns or works for another Booka business.

### 4.2 Route-session storage

Add a service-role-only table:

```text
shared_channel_route_sessions
  id                  uuid primary key
  channel             text              -- whatsapp initially
  gateway_scope       text              -- Meta phone-number ID, not dialable number
  external_id         text              -- sender identity required for lookup
  active_tenant_id    uuid
  source              text              -- routing_code | owner_identity | operator
  opened_at           timestamptz
  last_inbound_at     timestamptz
  expires_at          timestamptz
  created_at          timestamptz
  updated_at          timestamptz
  unique(channel, gateway_scope, external_id)
```

RLS is enabled. Only `service_role` receives table access. The application exposes no general client CRUD API for routes.

The default route lifetime is 24 hours. It is configurable, but cannot exceed the provider/customer-service policy window without an explicit product and compliance review.

### 4.3 Tenant-scoped channel identity

Add:

```text
customer_channel_identities
  id                  uuid primary key
  tenant_id           uuid
  customer_id         uuid
  channel             text              -- whatsapp | instagram
  external_id         text
  verification_state  text              -- observed | verified | revoked
  verification_source text              -- inbound_whatsapp | verified_phone | verified_email | booking | operator
  verified_at         timestamptz null
  revoked_at          timestamptz null
  created_at          timestamptz
  updated_at          timestamptz
  unique(tenant_id, channel, external_id)
```

The same WhatsApp number may map to different `customers` rows in different tenants. No global customer profile is created. Instagram and WhatsApp identities remain separate until a verified phone/email or an explicit authenticated confirmation links them to the same tenant customer.

## 5. Conversation and thread model

### 5.1 Preserve `whatsapp_conversations`

Do not replace or rename `whatsapp_conversations`. It remains the channel relationship and continues to hold compatibility flags such as role, opt-out, disclosure, human handling, and current flow pointers.

Add:

- `customer_id uuid null` — tenant-scoped customer link;
- `active_thread_id uuid null` — current thread pointer;
- `state_version bigint not null default 0` — optimistic concurrency guard.

### 5.2 First-class conversation threads

Add:

```text
conversation_threads
  id                         uuid primary key
  tenant_id                  uuid
  conversation_id            uuid            -- whatsapp_conversations.id
  customer_id                uuid null
  channel                    text
  status                     text            -- active | waiting_customer | waiting_business | human | completed | expired
  primary_intent             text null
  active_goal                jsonb
  open_loops                 jsonb            -- suspended questions/tasks to resume later
  structured_state           jsonb
  summary                    text null
  summary_json               jsonb
  summary_through_message_id uuid null
  state_version              bigint default 0
  opened_at                  timestamptz
  last_activity_at           timestamptz
  expires_at                 timestamptz null
  closed_at                  timestamptz null
  close_reason               text null
```

Enforce at most one active/waiting/human thread per conversation relationship with a partial unique index. Historical threads remain queryable for audits and customer history.

Add nullable `conversation_thread_id` to `messages`. Existing messages remain valid and can be associated lazily; no destructive backfill is required for launch.

### 5.3 Structured state contract

`structured_state` is versioned application data, not arbitrary model memory. Initial namespaces:

```json
{
  "schema_version": 1,
  "intent": "booking",
  "confirmed": {
    "service_id": "...",
    "service_name": "Haircut",
    "date": "2026-10-02",
    "time_preference": "afternoon",
    "customer_name": "Ada"
  },
  "proposed": {},
  "missing_fields": ["slot"],
  "next_expected_action": "choose_slot",
  "booking": {},
  "sales": {},
  "support": {}
}
```

The application owns the merge rules:

- model omission never deletes a confirmed field;
- a new explicit customer correction supersedes the old value and records provenance;
- invalid or unavailable values move to `proposed`/`missing_fields` rather than disappearing;
- authoritative booking, payment, inventory, and availability state always overrides prose;
- completed tasks move into the thread summary before active state is cleared;
- a topic diversion creates an `open_loops` entry so Booka can return to the original goal.

## 6. Durable ingestion and processing

### 6.1 Stop using JSON as the message queue

`flow_data.pending_messages` must no longer be the source of truth for batching. Persisted `messages` and `whatsapp_message_queue` rows become the canonical queue.

The webhook path:

1. verifies signature;
2. deduplicates by provider message ID;
3. resolves the receiving account/phone;
4. resolves the tenant route;
5. ensures tenant customer, conversation relationship, and active thread;
6. inserts the raw inbound message and queue row in one database transaction;
7. acknowledges only after durable persistence.

### 6.2 Atomic batch claim

Create a database function that atomically claims settled inbound queue rows for one conversation/thread using row locks and a processing lease. Requirements:

- `FOR UPDATE SKIP LOCKED` or an equivalent atomic update/return pattern;
- ordered by provider timestamp and database ID;
- respects the existing short batch-settle interval;
- changes claimed rows from pending to processing in the same transaction;
- returns the exact message IDs and contents claimed;
- expired leases are recoverable by a sweeper;
- a newly arriving message cannot be erased by a concurrent claim.

If implemented as `SECURITY DEFINER`, the function must live in a non-exposed schema where practical, pin `search_path`, validate the caller/use case, revoke `PUBLIC`/`anon`/`authenticated`, and grant execution only to `service_role`.

### 6.3 Idempotent effects

Every business action receives a deterministic correlation key derived from tenant, thread, inbound batch, and action type. Reservations, payments, quotes, leads, and outbound logical replies must refuse duplicate effects for the same key.

Inbound processing provides exactly-once application effects over at-least-once provider delivery. Outbound network delivery cannot be made mathematically exactly once when a provider times out after accepting a request. Booka therefore:

- writes one logical outbound message before sending;
- marks it `sending` with a lease;
- stores the provider message ID on success;
- marks timeouts as `delivery_unknown`;
- does not blindly resend `delivery_unknown` messages;
- reconciles through status webhooks or raises an operator alert.

This favors avoiding duplicate customer replies and duplicate bookings over speculative resend.

## 7. Context assembly

Create one v2 `ConversationContextAssembler`. It requires the exact tenant, relationship, thread, channel, and external identity. It must never fall back to the tenant's latest chat.

Context order:

1. system safety and tenant instructions;
2. grounded tenant data: services, products, staff, prices, policies, hours, availability;
3. verified tenant-customer facts;
4. active thread summary and structured state;
5. bounded recent turns for this thread only;
6. the newly claimed customer message batch;
7. retry/validation feedback, if any.

The recent-turn window defaults to 12 turns and is additionally constrained by a token budget. The summary covers earlier turns. The existing `llmContextManager` can donate redaction and truncation helpers, but its tenant-latest-chat lookup must not be reused.

Before a model call, a deterministic missing-field resolver evaluates structured state and verified customer facts. If the answer is already present, the model may confirm or use it but must not request it again.

### 7.1 Rolling summary

`summary_json` uses a stable shape:

```json
{
  "customer_goal": "Book a haircut tomorrow afternoon",
  "confirmed_facts": [],
  "decisions": [],
  "business_commitments": [],
  "customer_commitments": [],
  "open_questions": [],
  "open_loops": [],
  "last_offer": null,
  "handoff_notes": null
}
```

Update summaries asynchronously when the recent-turn window or token threshold is crossed and synchronously before closing, expiring, or handing off a thread. A summary update declares the last message it covers and uses optimistic versioning so an older summarization job cannot overwrite a newer summary.

Summary failure does not erase state or block a reply while recent turns fit the context budget. Repeated summary failure triggers an operational alert before the context window is exhausted.

## 8. Verified long-term memory

Existing deterministic `customer_profile_summary` remains the source for calculated history such as visit count, last service, preferred staff, spend, and rebooking interval. Do not duplicate those metrics as model-authored facts.

Add a narrow fact store only for explicit, non-derived preferences that do not already have a canonical column:

```text
customer_memory_facts
  id                  uuid primary key
  tenant_id           uuid
  customer_id         uuid
  namespace           text
  fact_key             text
  fact_value           jsonb
  status               text          -- active | superseded | revoked | expired
  source_type          text          -- explicit_message | operator
  source_message_id    text null      -- messages.id is text in the current schema
  source_record_id     uuid null
  confidence           numeric
  consent_basis        text null
  verified_at          timestamptz null
  expires_at           timestamptz null
  superseded_by        uuid null
  created_at           timestamptz
  updated_at           timestamptz
```

Rules:

- facts are always tenant-scoped;
- explicit customer statements or authorized operator actions may create facts;
- completed transactions update deterministic customer history and profile aggregates; a purchase alone never proves a preference;
- model inference alone cannot create an active long-term fact;
- contradictions create a new fact and supersede the old fact rather than silently rewriting history;
- sensitive health, biometric, financial credential, authentication, and free-form medical details are blocked from the general fact store;
- tenant offboarding, customer deletion, and DSAR/export flows include facts, summaries, identities, routes, and threads;
- retention is configurable and must be reflected in the final privacy policy before broad onboarding.

## 9. Human handoff and resumption

The handoff record points to the canonical thread and freezes an up-to-date summary snapshot for notification convenience. The thread remains the source of truth.

On handoff:

- set thread status to `human`;
- persist the latest summary and structured state;
- show the operator the customer goal, confirmed fields, open questions, last offers, and recent turns;
- suppress AI replies while preserving every inbound and operator message.

On AI resume:

- ingest operator messages written during takeover;
- apply any explicit operator state corrections;
- regenerate the thread summary through the latest message;
- resume only if no unresolved operator lock or sensitive escalation remains;
- tell the customer naturally that Booka is continuing, without repeating intake questions.

## 10. Failure and recovery behavior

| Failure | Behavior |
|---|---|
| Duplicate webhook | Acknowledge; no duplicate message, state transition, reply, booking, or payment action |
| Out-of-order webhook | Store provider timestamp; process within the settled ordered batch |
| Database unavailable before persistence | Return retriable failure so the provider retries |
| Worker crash after claim | Lease expires; another worker resumes the same batch |
| State version conflict | Reload latest state, deterministically re-merge, retry a bounded number of times |
| Summary generation failure | Continue with structured state + bounded recent turns; alert before context exhaustion |
| Grounding unavailable | Do not invent; retry or hand off rather than reset the conversation |
| Route expired | Ask for business code; do not use the most recent historical tenant |
| Multiple tenant memberships | Ask for tenant selection unless an explicit routing code is present |
| Provider send timeout | Mark delivery unknown; reconcile, do not blind-resend |
| Invalid model action | Reject, provide validation feedback, retry once, then hand off |
| Memory conflict | Prefer authoritative records and explicit latest correction; retain provenance |

## 11. Observability and product metrics

Record at minimum:

- repeated-question events: Booka asked for a field already confirmed;
- context-reuse rate: turns where existing state prevented a repeated question;
- routing-code overrides and ambiguous-route prompts;
- prevented cross-tenant route attempts;
- active-route expiry count;
- state-version conflict and retry count;
- batch claim size, lease recovery, and queue age;
- summary lag and summary failures;
- model action validation failures;
- handoff-to-resume continuity failures;
- outbound `delivery_unknown` count;
- conversation completion, abandonment, booking, sale, and recovery outcomes.

The owner dashboard should not expose raw internal memory. Operators may see customer-safe summaries and verified preferences according to role permissions.

## 12. Security, privacy, and isolation

- Every query includes `tenant_id`; thread/message lookups also include the exact relationship or thread ID.
- RLS is enabled on all new public-schema tables.
- Client roles receive only the least privilege required for owner/operator UI; route sessions and processing leases remain service-role-only.
- No authorization decision uses user-editable JWT metadata.
- Views exposed to client roles use security-invoker semantics where supported.
- Privileged functions revoke default `PUBLIC` execution and pin `search_path`.
- Raw external identifiers are never logged in full; observability uses redacted or keyed hashes.
- Prompts include only the current tenant-customer context.
- Customer memory is exportable, correctable, revocable, and deletable through existing data-rights workflows.
- A clinic or another sensitive vertical cannot enable sensitive long-term memory merely through tenant prompt instructions; it requires an explicit product policy and schema allowlist.

## 13. Rollout strategy

1. **Routing correction first:** make explicit code precedence and route sessions independently testable before changing AI context.
2. **Durable atomic ingestion:** introduce queue claiming and leases while preserving current reply behavior.
3. **Thread/state dual-write:** create threads and structured state alongside existing `flow_data`; compare outcomes without using the new state for replies.
4. **Shadow context assembly:** build the proposed context, record diagnostics, but keep the existing prompt active.
5. **Pilot read path:** enable the new assembler and reducer only for the `glo` tenant behind a feature flag.
6. **Memory facts:** enable verified fact writes only after isolation, export, deletion, and supersession tests pass.
7. **Handoff continuity:** switch operator views/resume to the canonical thread.
8. **Broader rollout:** expand tenant-by-tenant based on repeated-question rate, routing correctness, latency, cost, and handoff outcomes.

Every stage has a kill switch that returns to the preceding read path without deleting dual-written data. Schema changes are additive until the new path has completed a sustained production bake.

## 14. Acceptance tests

### Routing and isolation

- One phone contacts tenant A and tenant B through the shared number; histories and facts remain isolated.
- A tenant B routing code overrides an unexpired tenant A session.
- A message without a code continues the one unexpired active route.
- An expired or ambiguous route asks for the business code.
- Dedicated-number and Instagram routing are unaffected.
- An owner of tenant A can contact tenant B using B's explicit code.

### Ingestion and concurrency

- Ten rapid messages are claimed once, in order, with none overwritten or cleared.
- A new message arriving during a claim remains pending for the next batch.
- Duplicate and reordered provider webhooks do not duplicate effects.
- A worker/container restart after claiming resumes through lease expiry.
- Two workers cannot process the same queue rows concurrently.
- A stale state update cannot overwrite a newer confirmed field.

### Context continuity

- A customer supplies service, date, and name across separate messages; Booka asks only for missing information.
- A customer asks a side question and then returns to booking without restarting.
- A customer explicitly changes the date while retaining service and staff choices.
- A 20-turn conversation continues without repeating confirmed intake questions.
- A conversation resumed the next day within the active route retains unfinished state.
- A later new thread uses only verified long-term facts, not stale transaction state.

### Identity and memory

- The same phone produces distinct tenant-customer relationships per tenant.
- WhatsApp and Instagram identities do not merge by matching name.
- A verified cross-channel link resolves to one tenant customer.
- A contradicted preference supersedes the prior fact with provenance.
- Model-only inference cannot create an active long-term fact.
- Sensitive blocked categories are rejected.
- Export and deletion include identities, facts, threads, summaries, and messages.

### Handoff and recovery

- Human takeover suppresses AI while continuing ingestion.
- Operator replies appear in recent turns and the regenerated summary.
- AI resume uses operator-confirmed state and does not repeat intake.
- Grounding or model failure preserves state and safely retries/hands off.
- Outbound timeout produces `delivery_unknown`, not an automatic duplicate reply.

## 15. Implementation boundaries

### In scope

- shared-number route sessions and explicit-code precedence;
- tenant-scoped channel identities;
- first-class conversation threads;
- atomic queue claiming and state versioning;
- customer-specific context assembly;
- structured state reducer and missing-field resolver;
- rolling summaries and verified fact memory;
- human handoff/resume continuity;
- isolation, recovery, observability, and rollout controls.

### Out of scope

- arbitrary semantic/vector search over every historical transcript;
- a global customer identity shared across tenants;
- permanent storage of unrestricted model-generated notes;
- clinical record storage or medical decision support;
- changing Meta's 24-hour messaging policy controls;
- replacing Booka's existing customer commerce profile and merge system;
- deleting legacy state columns before the new path has completed production bake.

## 16. Implementation order for the plan

1. Characterization and isolation tests for current routing, batching, and context behavior.
2. Additive schema migration, RLS, grants, privileged function hardening, and rollback checks.
3. Explicit-code routing precedence and shared route-session service.
4. Atomic queue claim/lease path and removal of JSON batching from the source-of-truth path.
5. Tenant channel identity resolution and conversation/thread creation.
6. Versioned structured-state reducer and deterministic missing-field resolver.
7. Customer-specific recent-turn context assembler.
8. Rolling summary writer with stale-write prevention.
9. Verified customer fact store and policy allowlist.
10. Human handoff/operator/resume integration.
11. Metrics, alerts, feature flags, dual-write/shadow-read rollout.
12. Production pilot verification using the shared `glo` tenant before broader enablement.
