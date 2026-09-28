# Booka Conversation Continuity and Tenant-Safe Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task by task. Use `test-driven-development` for each behavior change and `verification-before-completion` before claiming a gate is complete.

**Goal:** Make Booka retain an unfinished enquiry, verified customer preferences, and human-handoff context without ever mixing customers or tenants on the shared WhatsApp number or Instagram.

**Architecture:** Route each inbound event to a tenant before identity or memory lookup, map the tenant/channel/external identity to a canonical customer, persist one canonical conversation thread with structured state, and process settled queue rows through a leased atomic claim. Assemble prompts only from the resolved tenant, identity, customer, and thread. Keep the existing `whatsapp_conversations` row as a compatibility projection while the new thread model rolls out behind tenant-scoped flags.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Supabase/PostgreSQL with RLS and hardened `SECURITY DEFINER` RPCs, Jest, Meta WhatsApp Cloud API, Instagram Messaging API, OpenTelemetry.

**Spec:** `docs/superpowers/specs/2026-09-28-conversation-continuity-tenant-safe-memory-design.md`

## Global constraints

- Preserve the existing production shared gateway, Meta callbacks, metering, and controlled-pilot configuration.
- An explicit valid routing code always wins over a cached shared-number route.
- Never query conversation history by channel/external ID without a tenant predicate after routing.
- Never merge WhatsApp and Instagram identities without a verified link signal.
- Confirmed structured state can only be replaced by a newer explicit customer correction or a successful authoritative operation.
- Queue rows and `messages` are canonical; `flow_data.pending_messages` must stop being a source of truth.
- Do not silently fall back to non-locking queue claims when the claim RPC is missing.
- Do not blindly resend after an ambiguous provider timeout; record `delivery_unknown` for reconciliation.
- New tables require RLS, service-role-only write paths, pinned `search_path`, explicit grants/revokes, export coverage, and deletion coverage.
- Database rollout is expand/migrate/contract. The first release remains backward-compatible and can be disabled per tenant.
- Do not apply SQL, change VPS configuration, or deploy production while implementing local tasks. Stop at the documented operator gates.
- Preserve the unrelated untracked file `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md`.

---

### Task 1: Establish a clean behavioral baseline

**Files:** None.

**Step 1: Confirm the branch and preserve unrelated work**

```bash
git status --short
git branch --show-current
git log -3 --oneline
```

Expected: the design commit `00f4b0e` is present and `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md` remains unrelated and untracked.

**Step 2: Run the existing conversation suite before changing behavior**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/messageBatcher.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts \
  src/__tests__/app/api/chats/messages.route.test.ts
```

Expected: PASS. If any baseline test fails, stop and diagnose it before implementing this plan; do not normalize an unrelated failure into the feature work.

**Step 3: Record the two known unsafe paths for the review log**

```bash
rg -n "Existing conversation|ROUTING_CODE_PATTERN" src/lib/whatsapp/v2/identityResolver.ts
rg -n "read-modify-write|pending_messages|non-locking fallback" \
  src/lib/whatsapp/v2/messageBatcher.ts src/app/api/worker/whatsapp/route.ts
```

Expected: routing currently consults an existing global conversation before the code, and runtime batching still uses JSON plus a non-locking worker fallback. Do not commit anything in this baseline task.

---

### Task 2: Add the tenant-safe continuity schema and deployment artifact

**Files:**

- Create: `db/migrations/153_conversation_continuity.sql`
- Create: `db/migrations/153_conversation_continuity_rollback.sql`
- Create: `db/releases/2026-09-28-conversation-continuity.sql`
- Create: `scripts/sql/verify_conversation_continuity.sql`
- Modify: `scripts/validate-schema.js`
- Modify: `src/__tests__/scripts/validateSchemaManifest.test.ts`
- Create: `src/__tests__/scripts/conversationContinuityMigration.test.ts`

**Step 1: Extend the schema-manifest test first**

Require these tables and critical columns:

```ts
expect(REQUIRED_SCHEMA.shared_channel_route_sessions).toEqual(expect.arrayContaining([
  'tenant_id', 'channel', 'gateway_scope', 'external_id', 'source', 'expires_at',
]));
expect(REQUIRED_SCHEMA.customer_channel_identities).toEqual(expect.arrayContaining([
  'tenant_id', 'customer_id', 'channel', 'external_id', 'verification_state',
]));
expect(REQUIRED_SCHEMA.conversation_threads).toEqual(expect.arrayContaining([
  'tenant_id', 'customer_id', 'channel_identity_id', 'status', 'structured_state',
  'rolling_summary', 'state_version', 'human_handling_until',
]));
expect(REQUIRED_SCHEMA.customer_memory_facts).toEqual(expect.arrayContaining([
  'tenant_id', 'customer_id', 'namespace', 'fact_key', 'fact_value', 'status',
  'source_type', 'source_message_id', 'source_record_id', 'consent_basis',
  'verified_at', 'expires_at', 'superseded_by',
]));
expect(REQUIRED_SCHEMA.conversation_effects).toEqual(expect.arrayContaining([
  'tenant_id', 'thread_id', 'idempotency_key', 'effect_type', 'status',
]));
```

Also require `whatsapp_conversations.customer_id`, `active_thread_id`, and `state_version`; `messages.conversation_thread_id`, `provider_message_id`, `delivery_status`, and `idempotency_key`; and the queue lease/thread columns.

**Step 2: Write migration structure tests**

Read the SQL as text and assert it contains:

- RLS enablement for all five new tables.
- tenant isolation policies for authenticated owner/manager reads where needed.
- service-role policies for server paths.
- a unique identity index on `(tenant_id, channel, external_id)`.
- a unique active route-session index on `(channel, gateway_scope, external_id)`.
- a unique effect key on `(tenant_id, idempotency_key)`.
- `claim_whatsapp_conversation_batch(uuid,timestamptz,integer)`.
- `ingest_conversation_message(text,text,jsonb,uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,jsonb,jsonb)` atomically persists the webhook event, raw inbound message, and queue row.
- `update_conversation_thread_state(uuid,uuid,bigint,jsonb)` performs a tenant-scoped optimistic state update and returns the new version.
- `update_conversation_thread_summary(uuid,uuid,timestamptz,text,timestamptz)` prevents an older summary job from overwriting a newer summary.
- the replacement `merge_customers_tx(uuid,uuid,uuid)` updates channel identities, threads, and memory facts before marking the losing customer merged.
- `SET search_path = public, pg_temp`.
- revoke from `PUBLIC`, `anon`, and `authenticated`, then grant to `service_role`.
- no destructive drop in the forward migration.

**Step 3: Implement migration 153 as an expand-only migration**

Create:

```sql
CREATE TABLE public.shared_channel_route_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  gateway_scope text NOT NULL,
  external_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('routing_code','dedicated_number','instagram_recipient','operator')),
  expires_at timestamptz NOT NULL,
  last_routed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, gateway_scope, external_id)
);

CREATE TABLE public.customer_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  external_id text NOT NULL,
  verification_state text NOT NULL DEFAULT 'channel_verified'
    CHECK (verification_state IN ('unverified','channel_verified','cross_channel_verified')),
  verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, external_id)
);

CREATE TABLE public.conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  channel_identity_id uuid REFERENCES public.customer_channel_identities(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','instagram')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','completed','abandoned','handed_off','closed')),
  structured_state jsonb NOT NULL DEFAULT '{"confirmed":{},"proposed":{},"missing":[]}'::jsonb,
  rolling_summary text,
  summary_through_message_at timestamptz,
  state_version bigint NOT NULL DEFAULT 0,
  human_handling_until timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.customer_memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  namespace text NOT NULL DEFAULT 'preference',
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','superseded','revoked','expired')),
  source_type text NOT NULL CHECK (source_type IN ('explicit_message','operator')),
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source_record_id uuid,
  confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  consent_basis text,
  verified_at timestamptz,
  expires_at timestamptz,
  superseded_by uuid REFERENCES public.customer_memory_facts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  effect_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','succeeded','failed','delivery_unknown')),
  result_ref text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
```

Then add compatibility columns:

```sql
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state_version bigint NOT NULL DEFAULT 0;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.whatsapp_message_queue
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS conversation_thread_id uuid REFERENCES public.conversation_threads(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_id uuid;
```

Add partial indexes for active threads, unsuperseded facts, due queue rows, expired leases, and message ordering. Add a uniqueness guard for inbound queue delivery `(tenant_id, channel, message_id)` after checking duplicates in a guarded `DO` block.

Replace the existing `merge_customers_tx` definition from migration 133 in the same forward migration. Preserve all existing table updates and add tenant-guarded updates for `customer_channel_identities`, `conversation_threads`, and `customer_memory_facts`. Resolve duplicate active facts deterministically by superseding the loser's older fact before reassignment. Add migration tests proving the merge function mentions every new customer-owned table.

**Step 4: Add a conversation-scoped leased claim RPC**

Implement:

```sql
public.claim_whatsapp_conversation_batch(
  p_worker_id uuid,
  p_settle_before timestamptz,
  p_lease_seconds integer DEFAULT 120
) RETURNS SETOF public.whatsapp_message_queue
```

The function must:

1. recover rows whose processing lease expired;
2. select one due conversation key with `FOR UPDATE SKIP LOCKED`;
3. claim every settled row for that exact `(tenant_id, channel, from_number, conversation_thread_id)` key;
4. assign one `batch_id`, `lease_owner`, and `lease_expires_at`;
5. return rows ordered by `COALESCE(provider_timestamp, created_at), created_at, id`;
6. pin `search_path` and expose execution only to `service_role`.

Use a transaction-scoped advisory lock derived from the complete conversation key so two workers cannot claim different rows for the same conversation concurrently.

Add a second hardened RPC:

```sql
public.ingest_conversation_message(
  p_webhook_provider text,
  p_webhook_external_id text,
  p_webhook_payload jsonb,
  p_message_id uuid,
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_thread_id uuid,
  p_channel text,
  p_from_number text,
  p_to_number text,
  p_content text,
  p_message_type text,
  p_provider_message_id text,
  p_provider_timestamp timestamptz,
  p_raw jsonb,
  p_media_info jsonb
) RETURNS uuid
```

It must validate that the conversation and thread belong to `p_tenant_id`, insert `webhook_events`, `messages`, and the queue row in one transaction, and return the queue ID. A conflict on `(provider, external_id)` or the provider/message uniqueness key returns the existing queue ID so webhook replay is successful and side-effect free. Do not set `webhook_events.processed_at` unless all three writes succeed. Pin `search_path`, revoke public/anon/authenticated execution, and grant only `service_role`.

Add two smaller optimistic-update RPCs:

```sql
public.update_conversation_thread_state(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_expected_version bigint,
  p_structured_state jsonb
) RETURNS bigint

public.update_conversation_thread_summary(
  p_tenant_id uuid,
  p_thread_id uuid,
  p_expected_updated_at timestamptz,
  p_summary text,
  p_summary_through timestamptz
) RETURNS boolean
```

The state RPC updates only when `state_version = p_expected_version`, increments exactly once, and raises a recognizable conflict when no row matches. The summary RPC updates only when the same tenant/thread still has the expected `updated_at` and the new `p_summary_through` is later than the stored watermark. Apply the same hardened grants and pinned `search_path`.

**Step 5: Add safe RLS and rollback**

Authenticated users may only read rows for tenants where their `tenant_users` membership is owner or manager. Only `service_role` may mutate route sessions, identities, effects, or memory facts. The rollback must refuse to run if any new table contains rows unless the operator passes an explicit session setting; it must drop compatibility columns last.

**Step 6: Build the SQL-editor release file**

The release artifact must contain the forward migration exactly once inside `BEGIN/COMMIT`, followed by a verification block that raises on missing objects, unsafe grants, an unpinned function `search_path`, missing RLS, or absent constraints. Do not include prose outside SQL comments, preventing the earlier Supabase Editor syntax failure.

**Step 7: Run tests**

```bash
npm test -- --runInBand \
  src/__tests__/scripts/validateSchemaManifest.test.ts \
  src/__tests__/scripts/conversationContinuityMigration.test.ts
```

Expected: PASS.

**Step 8: Commit**

```bash
git add db/migrations/153_conversation_continuity.sql \
  db/migrations/153_conversation_continuity_rollback.sql \
  db/releases/2026-09-28-conversation-continuity.sql \
  scripts/sql/verify_conversation_continuity.sql \
  scripts/validate-schema.js \
  src/__tests__/scripts/validateSchemaManifest.test.ts \
  src/__tests__/scripts/conversationContinuityMigration.test.ts
git commit -m "feat(db): add tenant-safe conversation continuity schema"
```

---

### Task 3: Resolve shared-gateway routes before conversation identity

**Files:**

- Create: `src/lib/whatsapp/v2/routeSession.ts`
- Modify: `src/lib/whatsapp/v2/identityResolver.ts`
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/identityResolver.sharedGateway.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/routeSession.test.ts`
- Create: `src/__tests__/api/webhooks/whatsapp/meta/route.test.ts`

**Step 1: Define the route-session API**

Before implementation, add the failing precedence, expiration, and ambiguity cases to `identityResolver.sharedGateway.test.ts` and `routeSession.test.ts`. In particular, build a mock where the sender has a stale tenant A conversation while the new message contains tenant B's valid `BETY42` code; assert tenant B wins and the stripped message is `I need braids`. Run those two files and confirm they fail because no route-session service exists yet.

```ts
export type RouteDecision =
  | { status: 'routed'; tenantId: string; source: 'routing_code' | 'session' | 'dedicated_number'; strippedMessage: string }
  | { status: 'needs_code'; strippedMessage: string };

export async function resolveWhatsAppRoute(input: {
  externalId: string;
  gatewayPhoneNumberId: string;
  messageText: string;
  dedicatedTenantId?: string | null;
  now?: Date;
}): Promise<RouteDecision>;
```

Resolution order must be:

1. parse and validate an explicit routing code against an active `v2_enabled` tenant;
2. route a dedicated phone directly;
3. use only an unexpired route session for the exact shared gateway scope and sender;
4. otherwise return `needs_code`.

A valid explicit code upserts a 24-hour route session. An invalid-looking code must not extend the previous session.

**Step 2: Narrow `resolveIncoming`**

Change it to accept a required routed tenant:

```ts
export async function resolveIncoming(
  channel: ConvChannel,
  externalId: string,
  messageText: string,
  routedTenantId: string
): Promise<ResolvedIdentity>;
```

Every conversation and staff lookup must include `.eq('tenant_id', routedTenantId)`. Remove global “latest conversation” routing and routing-code parsing from this identity function.

**Step 3: Update the Meta webhook**

Resolve the route before persisting tenant-scoped `messages`, chats, conversations, or queue rows. When `needs_code`, send the existing neutral routing-code prompt through the platform gateway without creating tenant memory. Do not log the raw message.

**Step 4: Make tests pass**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/identityResolver.sharedGateway.test.ts \
  src/__tests__/lib/whatsapp/v2/routeSession.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts
```

Expected: PASS, including explicit-code precedence, expiration, ambiguity, tenant filters, and no tenant write before routing.

**Step 5: Commit**

```bash
git add src/lib/whatsapp/v2/routeSession.ts \
  src/lib/whatsapp/v2/identityResolver.ts \
  src/app/api/webhooks/whatsapp/meta/route.ts \
  src/__tests__/lib/whatsapp/v2/identityResolver.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/identityResolver.sharedGateway.test.ts \
  src/__tests__/lib/whatsapp/v2/routeSession.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts
git commit -m "fix(whatsapp): route shared gateway before identity lookup"
```

---

### Task 4: Map tenant-scoped channel identities to canonical customers

**Files:**

- Create: `src/lib/customers/channelIdentity.ts`
- Modify: `src/lib/whatsapp/v2/conversationState.ts`
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts`
- Modify: `src/app/api/webhooks/instagram/route.ts`
- Create: `src/__tests__/lib/customers/channelIdentity.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts`
- Modify: `src/__tests__/api/webhooks/instagram/route.test.ts`

**Step 1: Write failing identity tests**

Cover:

- same WhatsApp number under two tenants produces two identity rows and never crosses customer IDs;
- repeated inbound under one tenant reuses the same identity/customer;
- Instagram sender mapping is tenant-scoped;
- WhatsApp and Instagram identities remain separate without an explicit verified link;
- normalization is only applied where the channel identifier is a phone number.

**Step 2: Implement the service**

```ts
export interface ChannelIdentityResolution {
  identityId: string;
  customerId: string;
  created: boolean;
}

export async function ensureCustomerChannelIdentity(input: {
  tenantId: string;
  channel: 'whatsapp' | 'instagram';
  externalId: string;
  displayName?: string | null;
}): Promise<ChannelIdentityResolution>;
```

Use the unique `(tenant_id, channel, external_id)` key. For WhatsApp, reuse a same-tenant customer with the exact normalized number or create one. For Instagram, create a customer only when the tenant-scoped identity is absent. Handle unique-race retries by fetching the winning row.

**Step 3: Extend conversation compatibility state**

Add `customer_id`, `active_thread_id`, and `state_version` to `ConvState`. Make `ensureConversation` accept the resolved `customerId`; never overwrite a non-null customer with another value.

**Step 4: Wire both webhook paths**

WhatsApp: route -> identity -> customer/channel identity -> conversation.

Instagram: recipient/account mapping -> tenant -> customer/channel identity -> conversation. Do not call global identity lookup to choose a tenant.

**Step 5: Run tests**

```bash
npm test -- --runInBand \
  src/__tests__/lib/customers/channelIdentity.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/lib/customers/channelIdentity.ts \
  src/lib/whatsapp/v2/conversationState.ts \
  src/app/api/webhooks/whatsapp/meta/route.ts \
  src/app/api/webhooks/instagram/route.ts \
  src/__tests__/lib/customers/channelIdentity.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts
git commit -m "feat(customers): add tenant-scoped channel identities"
```

---

### Task 5: Introduce canonical conversation threads and versioned structured state

**Files:**

- Create: `src/lib/whatsapp/v2/conversationThread.ts`
- Create: `src/lib/whatsapp/v2/structuredState.ts`
- Modify: `src/lib/whatsapp/v2/conversationState.ts`
- Create: `src/__tests__/lib/whatsapp/v2/conversationThread.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/structuredState.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts`

**Step 1: Define structured state**

```ts
export type VerifiedValue<T = unknown> = {
  value: T;
  source: 'customer_explicit' | 'transaction' | 'operator';
  sourceId: string;
  observedAt: string;
};

export type ConversationStructuredState = {
  intent?: string;
  confirmed: Record<string, VerifiedValue>;
  proposed: Record<string, unknown>;
  missing: string[];
  nextAction?: string;
};
```

Validate database JSON with a narrow parser; malformed state returns a safe empty value and emits a sanitized metric.

**Step 2: Test thread lifecycle**

Assert:

- an existing active thread is reused for the exact tenant/identity;
- a completed thread is not reopened by an unrelated new enquiry;
- an unfinished thread resumes;
- the compatibility conversation points at `active_thread_id`;
- a stale `expectedVersion` update fails instead of overwriting newer state.

**Step 3: Implement thread operations**

```ts
export async function ensureActiveThread(input: {
  tenantId: string;
  customerId: string;
  channelIdentityId: string;
  channel: ConvChannel;
  conversationId: string;
}): Promise<ConversationThread>;

export async function updateThreadState(input: {
  tenantId: string;
  threadId: string;
  expectedVersion: number;
  state: ConversationStructuredState;
}): Promise<{ stateVersion: number }>;

export async function transitionThread(input: {
  tenantId: string;
  threadId: string;
  from: ThreadStatus[];
  to: ThreadStatus;
}): Promise<void>;
```

All updates include both tenant and thread IDs. Call `update_conversation_thread_state`; never emulate `state_version + 1` through a client-side read-modify-write.

**Step 4: Dual-write compatibility projection**

For the expand phase, project the canonical thread's current flow and booking state into `whatsapp_conversations.flow_data`, but never read `pending_messages` from it. Add a comment with the future contract-removal gate.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/conversationThread.test.ts \
  src/__tests__/lib/whatsapp/v2/structuredState.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts
git add src/lib/whatsapp/v2/conversationThread.ts \
  src/lib/whatsapp/v2/structuredState.ts \
  src/lib/whatsapp/v2/conversationState.ts \
  src/__tests__/lib/whatsapp/v2/conversationThread.test.ts \
  src/__tests__/lib/whatsapp/v2/structuredState.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationState.channel.test.ts
git commit -m "feat(conversations): add canonical versioned threads"
```

Expected: tests PASS and no existing v2 caller loses compatibility.

---

### Task 6: Replace JSON batching with atomic leased queue batches

**Files:**

- Create: `src/lib/whatsapp/v2/queueBatch.ts`
- Modify: `src/lib/whatsapp/v2/messageBatcher.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/app/api/worker/whatsapp/route.ts`
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts`
- Modify: `src/app/api/webhooks/instagram/route.ts`
- Modify: `src/__tests__/app/api/worker/whatsapp/route.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/queueBatch.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/messageBatcher.channel.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts`

**Step 1: Define the canonical batch contract**

First create the worker and queue-batch tests for concurrent claims, settle windows, lease expiry, replay, and missing-RPC failure. Run them before adding runtime code and confirm they fail on the old per-row claim/JSON batching behavior.

```ts
export interface ClaimedConversationBatch {
  batchId: string;
  workerId: string;
  tenantId: string;
  channel: ConvChannel;
  externalId: string;
  conversationId: string;
  threadId: string;
  rows: QueueRow[];
  combinedText: string;
  correlationKey: string;
}

export async function claimNextConversationBatch(input: {
  workerId: string;
  settleBefore: Date;
  leaseSeconds: number;
}): Promise<ClaimedConversationBatch | null>;
```

Build `combinedText` only from RPC-returned rows, ordered by provider timestamp and stable tie-breakers. `correlationKey` is deterministic from sorted queue IDs.

**Step 2: Persist complete queue linkage in webhooks**

Both webhook paths call `ingest_conversation_message` after routing and identity/thread resolution, passing the webhook provider/external event key, `conversation_id`, `conversation_thread_id`, and provider timestamp. The RPC—not independent Supabase calls—must persist `webhook_events`, the raw inbound `messages` row, and the queue row atomically. Treat its existing-row replay result as success. Remove `appendPendingMessage` calls and the old early `handleIdempotency`/standalone `persistMessage` sequence from v2 paths; legacy paths may retain their current flow until migrated.

**Step 3: Change the pipeline entry point**

Replace:

```ts
processMessageV2(externalId, tenantId, content, messageId, channel)
```

with:

```ts
processConversationBatch(batch: ClaimedConversationBatch): Promise<BatchProcessResult>
```

The pipeline must not independently claim or clear any message. It receives one exact tenant/thread batch and returns the queue disposition plus outbound/effect correlation.

**Step 4: Make the worker lease-aware and fail closed**

Generate one UUID worker ID per invocation. Loop on `claimNextConversationBatch` until the execution budget or batch cap is reached. On success, mark only rows matching `batch_id` and `lease_owner` complete. On retry, clear lease fields and schedule backoff. On execution-budget exit, release only the current worker's unprocessed batch. Delete the non-locking fallback.

**Step 5: Retire JSON batching safely**

Keep `messageBatcher.ts` as a compatibility shim for one release that throws in production and warns in tests if called. Remove its imports from all runtime paths. Replace its old unit suite with an assertion that canonical callers use queue batching.

**Step 6: Test concurrency and replay**

Cover:

- two workers never receive the same conversation rows;
- rapid-fire messages settle into one ordered batch;
- a new message arriving after claim is processed in the next batch;
- expired leases are reclaimable;
- active leases are not reclaimable;
- RPC absence fails closed;
- webhook replay does not duplicate a queue row;
- a forced queue insert failure rolls back the paired `webhook_events` and `messages` inserts, allowing Meta's replay to try again;
- worker retry does not duplicate a completed effect.

**Step 7: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/queueBatch.test.ts \
  src/__tests__/lib/whatsapp/v2/messageBatcher.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/app/api/worker/whatsapp/route.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts
git add src/lib/whatsapp/v2/queueBatch.ts \
  src/lib/whatsapp/v2/messageBatcher.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/app/api/worker/whatsapp/route.ts \
  src/app/api/webhooks/whatsapp/meta/route.ts \
  src/app/api/webhooks/instagram/route.ts \
  src/__tests__/lib/whatsapp/v2/queueBatch.test.ts \
  src/__tests__/lib/whatsapp/v2/messageBatcher.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/app/api/worker/whatsapp/route.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts
git commit -m "fix(conversations): atomically batch inbound messages"
```

Expected: PASS.

---

### Task 7: Make business effects and outbound replies idempotent

**Files:**

- Create: `src/lib/whatsapp/v2/conversationEffects.ts`
- Create: `src/lib/whatsapp/v2/outboundDelivery.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/lib/whatsapp/v2/flows/customerBooking.ts`
- Modify: `src/lib/whatsapp/providers/types.ts`
- Create: `src/__tests__/lib/whatsapp/v2/conversationEffects.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/outboundDelivery.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts`

**Step 1: Test effect replay before implementation**

Use one correlation key twice and assert:

- a booking is created once;
- a payment-link intent is created once;
- the previous successful result is returned on replay;
- failed effects may retry;
- `delivery_unknown` does not send again automatically.

**Step 2: Implement effect reservation**

```ts
export async function runIdempotentEffect<T>(input: {
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
  effectType: string;
  execute: () => Promise<{ value: T; resultRef?: string }>;
}): Promise<{ replayed: boolean; value: T }>;
```

Insert `started` first under the unique key. On conflict, return a succeeded result or a safe in-progress response; never execute twice.

**Step 3: Persist outbound intent before provider call**

Create the outbound `messages` row with `delivery_status='pending'` and a deterministic idempotency key. Update to `sent` with provider message ID only after an acknowledged success. A network timeout after request dispatch becomes `delivery_unknown`; a definite provider rejection becomes `failed` and may follow the configured retry policy.

Do not claim Meta accepts Booka's idempotency key unless its API explicitly does. Booka's database guard is the source of duplicate prevention.

**Step 4: Wrap all irreversible pipeline actions**

Booking creation, cancellation, rescheduling, retail payment-link creation, and outbound reply each get keys derived from `batch.correlationKey`, action name, and stable action parameters.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/conversationEffects.test.ts \
  src/__tests__/lib/whatsapp/v2/outboundDelivery.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts
git add src/lib/whatsapp/v2/conversationEffects.ts \
  src/lib/whatsapp/v2/outboundDelivery.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/lib/whatsapp/v2/flows/customerBooking.ts \
  src/lib/whatsapp/providers/types.ts \
  src/__tests__/lib/whatsapp/v2/conversationEffects.test.ts \
  src/__tests__/lib/whatsapp/v2/outboundDelivery.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts
git commit -m "feat(conversations): make replies and actions idempotent"
```

Expected: PASS.

---

### Task 8: Add deterministic state reduction and missing-field recovery

**Files:**

- Create: `src/lib/whatsapp/v2/stateReducer.ts`
- Create: `src/lib/whatsapp/v2/missingFields.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/lib/whatsapp/v2/flows/customerBooking.ts`
- Modify: `src/lib/ai/context-builder.ts`
- Create: `src/__tests__/lib/whatsapp/v2/stateReducer.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/missingFields.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts`

**Step 1: Write reducer tests**

Test these rules:

- model omission never deletes a confirmed service, date, staff member, or contact detail;
- an explicit correction supersedes the old value with source evidence;
- a successful reservation writes authoritative booking ID, slot, and status;
- a failed action leaves proposed values unconfirmed;
- the next question is the highest-priority missing field only;
- “video call” remains in confirmed intent while the assistant asks for availability/date details.

**Step 2: Implement pure reduction**

```ts
export function reduceConversationState(input: {
  previous: ConversationStructuredState;
  extracted: ProposedStatePatch;
  sourceMessageId: string;
  operationResult?: AuthoritativeOperationResult;
  observedAt: string;
}): ConversationStructuredState;
```

Use allowlisted field names. Reject unknown paths. Keep `confirmed`, `proposed`, `missing`, and `nextAction` separate.

**Step 3: Implement missing-field policy**

```ts
export function requiredFieldsForIntent(intent: string): string[];
export function nextMissingField(state: ConversationStructuredState): string | null;
```

Requirements must be cross-vertical by default. Beauty-specific aliases and examples belong in grounding/tone data, not in the reducer.

**Step 4: Update AI contract**

Extend the model JSON response with a bounded `state_patch` object. The backend validates and reduces it. Never assign the model object directly to stored state.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/stateReducer.test.ts \
  src/__tests__/lib/whatsapp/v2/missingFields.test.ts \
  src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts
git add src/lib/whatsapp/v2/stateReducer.ts \
  src/lib/whatsapp/v2/missingFields.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/lib/whatsapp/v2/flows/customerBooking.ts \
  src/lib/ai/context-builder.ts \
  src/__tests__/lib/whatsapp/v2/stateReducer.test.ts \
  src/__tests__/lib/whatsapp/v2/missingFields.test.ts \
  src/__tests__/lib/whatsapp/v2/flows/customerBooking.test.ts
git commit -m "feat(conversations): preserve confirmed enquiry state"
```

Expected: PASS.

---

### Task 9: Assemble bounded, thread-safe AI context and rolling summaries

**Files:**

- Create: `src/lib/ai/conversation-context.ts`
- Create: `src/lib/whatsapp/v2/conversationSummary.ts`
- Modify: `src/lib/ai/context-builder.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/lib/enhancedJobManager.ts`
- Create: `src/__tests__/lib/ai/conversation-context.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/conversationSummary.test.ts`
- Modify: `src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts`
- Create: `src/__tests__/lib/enhancedJobManager.test.ts`

**Step 1: Test strict context isolation**

Seed messages for:

- the same phone under two tenants;
- two customers in one tenant;
- two threads for one customer;
- WhatsApp and Instagram identities that are not verified as linked.

Assert the assembler returns only the exact thread's last 12 turns, canonical structured state, its rolling summary, and same-tenant verified memory facts. It must never call the existing “latest chat for tenant” pattern.

**Step 2: Implement the assembler**

```ts
export interface ConversationContext {
  threadId: string;
  structuredState: ConversationStructuredState;
  rollingSummary: string | null;
  recentTurns: Array<{ direction: 'inbound' | 'outbound'; content: string; at: string }>;
  verifiedFacts: MemoryFact[];
}

export async function assembleConversationContext(input: {
  tenantId: string;
  threadId: string;
  customerId: string;
  recentTurnLimit?: number;
}): Promise<ConversationContext>;
```

Every query includes tenant plus its relationship key. Select explicit columns and bound every list.

**Step 3: Update prompt formatting**

Add four clearly delimited blocks: confirmed state, rolling summary, recent turns, verified facts. Tell the model that structured state outranks summary and raw turns, and verified transaction facts outrank inferred preferences. Escape or quote customer text as data so it cannot become system instruction.

**Step 4: Implement asynchronous summaries through the existing jobs queue**

Register `summarize_conversation_thread` in `EnhancedJobManager`. Schedule it only after the thread grows past the configured turn/token threshold and no equivalent pending job exists. The handler:

1. reloads the exact tenant/thread;
2. summarizes only messages after `summary_through_message_at`;
3. preserves unresolved requests, confirmed values, rejected options, promised follow-ups, and handoff reason;
4. updates through `update_conversation_thread_summary` with the loaded `updated_at` guard and message watermark;
5. never blocks the customer reply if it fails.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/ai/conversation-context.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationSummary.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/lib/enhancedJobManager.test.ts
git add src/lib/ai/conversation-context.ts \
  src/lib/whatsapp/v2/conversationSummary.ts \
  src/lib/ai/context-builder.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/lib/enhancedJobManager.ts \
  src/__tests__/lib/ai/conversation-context.test.ts \
  src/__tests__/lib/whatsapp/v2/conversationSummary.test.ts \
  src/__tests__/lib/whatsapp/v2/pipeline.channel.test.ts \
  src/__tests__/lib/enhancedJobManager.test.ts
git commit -m "feat(ai): ground replies in exact conversation history"
```

Expected: PASS.

---

### Task 10: Persist only verified long-term customer facts

**Files:**

- Create: `src/lib/customers/memoryFacts.ts`
- Modify: `src/lib/ai/conversation-context.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Modify: `src/lib/customers/profile.ts`
- Create: `src/__tests__/lib/customers/memoryFacts.test.ts`
- Modify: `src/__tests__/lib/ai/conversation-context.test.ts`
- Create: `src/__tests__/lib/customers/profile.test.ts`

**Step 1: Define a conservative allowlist**

```ts
export const MEMORY_FACT_KEYS = [
  'preferred_service',
  'preferred_staff',
  'preferred_time_window',
  'consented_contact_name',
  'consented_email',
] as const;
```

Explicitly block health details, diagnoses, payment-card data, government IDs, authentication secrets, free-form sensitive notes, and inferred protected characteristics. Do not duplicate deterministic aggregates already produced by `src/lib/customers/profile.ts` or relationship views.

**Step 2: Write policy tests**

Assert:

- a completed reservation updates deterministic customer profile/history but does not manufacture a stated preference;
- an explicit “I prefer knotless braids with Amaka” may record `preferred_service` and `preferred_staff` with the source message;
- an explicit “call me Ada” can verify a contact name with its source message;
- casual model inference cannot persist a fact;
- a correction supersedes rather than mutates the previous fact;
- expired and superseded facts are excluded;
- tenant A cannot read tenant B facts for the same phone.

**Step 3: Implement source-backed writes**

```ts
export async function recordVerifiedMemoryFact(input: {
  tenantId: string;
  customerId: string;
  key: MemoryFactKey;
  value: unknown;
  sourceType: 'explicit_message' | 'operator';
  sourceMessageId?: string;
  sourceRecordId?: string;
  consentBasis?: string;
  verifiedAt: string;
}): Promise<MemoryFact>;
```

Validate source existence and same-tenant ownership before insertion. Supersede the previous active value in one transaction. Do not let the LLM call this function directly.

**Step 4: Write facts only from trusted events**

Hook validated explicit-correction parsing and operator verification. Keep completed reservation/retail outcomes in the existing deterministic profile/history path: one purchase is evidence of history, not proof of preference. Use memory facts only for explicitly stated durable preferences and consented details.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/customers/memoryFacts.test.ts \
  src/__tests__/lib/ai/conversation-context.test.ts \
  src/__tests__/lib/customers/profile.test.ts
git add src/lib/customers/memoryFacts.ts \
  src/lib/ai/conversation-context.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/lib/customers/profile.ts \
  src/__tests__/lib/customers/memoryFacts.test.ts \
  src/__tests__/lib/ai/conversation-context.test.ts \
  src/__tests__/lib/customers/profile.test.ts
git commit -m "feat(customers): retain verified preferences safely"
```

Expected: PASS.

---

### Task 11: Preserve canonical context through human handoff and resume

**Files:**

- Modify: `src/lib/whatsapp/v2/humanHandoff.ts`
- Modify: `src/lib/whatsapp/v2/humanTakeover.ts`
- Modify: `src/app/api/chats/[id]/messages/route.ts`
- Modify: `src/app/api/chats/[id]/release/route.ts`
- Modify: `src/app/api/escalation/[id]/route.ts`
- Modify: `src/lib/whatsapp/v2/pipeline.ts`
- Create: `src/__tests__/lib/whatsapp/v2/handoffContinuity.test.ts`
- Modify: `src/__tests__/app/api/chats/messages.route.test.ts`
- Create: `src/__tests__/app/api/chats/release.route.test.ts`

**Step 1: Test handoff behavior**

Assert:

- escalation records the exact `conversation_thread_id` and a snapshot generated from canonical state;
- AI stops replying while `human_handling_until` is active;
- owner messages attach to the same thread;
- releasing human control keeps state and summary intact;
- AI's next reply includes operator messages and does not re-ask confirmed details;
- owner access is membership-checked for the same tenant.

**Step 2: Store the handoff on the thread**

Move the authoritative human-control window to `conversation_threads.human_handling_until`; keep `flow_data.human_handling_until` as a compatibility projection during rollout.

**Step 3: Attach operator messages to canonical history**

When an owner sends from the chat UI, write `messages.conversation_thread_id`, the tenant ID, and an outbound delivery record. Apply the same idempotent send path as Task 7.

**Step 4: Resume without resetting**

Release clears the handoff window only. It must not reset the active thread or structured state. If the operator explicitly closes the enquiry, transition to `closed` and require a new thread for the next unrelated enquiry.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2/handoffContinuity.test.ts \
  src/__tests__/app/api/chats/messages.route.test.ts \
  src/__tests__/app/api/chats/release.route.test.ts
git add src/lib/whatsapp/v2/humanHandoff.ts \
  src/lib/whatsapp/v2/humanTakeover.ts \
  src/app/api/chats/[id]/messages/route.ts \
  src/app/api/chats/[id]/release/route.ts \
  src/app/api/escalation/[id]/route.ts \
  src/lib/whatsapp/v2/pipeline.ts \
  src/__tests__/lib/whatsapp/v2/handoffContinuity.test.ts \
  src/__tests__/app/api/chats/messages.route.test.ts \
  src/__tests__/app/api/chats/release.route.test.ts
git commit -m "feat(handoff): preserve thread context across takeover"
```

Expected: PASS.

---

### Task 12: Add tenant deletion, export, metrics, and rollout controls

**Files:**

- Modify: `src/lib/offboarding/purgeWorker.ts`
- Modify: `src/lib/offboarding/exporter.ts`
- Modify: `src/lib/envValidation.ts`
- Modify: `src/app/api/ready/route.ts`
- Create: `src/lib/whatsapp/v2/continuityFlags.ts`
- Create: `src/lib/whatsapp/v2/continuityMetrics.ts`
- Modify: `src/lib/whatsapp/v2/routeSession.ts`
- Modify: `src/lib/whatsapp/v2/queueBatch.ts`
- Modify: `src/lib/ai/conversation-context.ts`
- Modify: `src/__tests__/lib/offboarding/purgeWorker.test.ts`
- Modify: `src/__tests__/lib/offboarding/exporter.test.ts`
- Create: `src/__tests__/lib/whatsapp/v2/continuityFlags.test.ts`
- Create: `src/__tests__/api/ready/route.test.ts`
- Modify: `.env.example`

**Step 1: Add failing purge/export tests**

Require children-first purge order:

```text
conversation_effects
customer_memory_facts
messages / whatsapp_message_queue
conversation_threads
customer_channel_identities
shared_channel_route_sessions
whatsapp_conversations
customers
```

Require all four customer-facing continuity tables in the tenant export. Effects may be exported as operational audit metadata without raw provider secrets.

**Step 2: Add rollout flags**

Use tenant-first flags with safe global defaults:

```ts
export interface ContinuityFlags {
  routingSessions: boolean;
  durableBatching: boolean;
  threadProjection: boolean;
  contextMode: 'off' | 'shadow' | 'live';
  memoryFacts: boolean;
}

export function getContinuityFlags(tenant: TenantLike): ContinuityFlags;
```

Read tenant settings first and environment defaults second. Add documented variables:

```dotenv
BOOKA_CONTINUITY_ROUTING_SESSIONS=false
BOOKA_CONTINUITY_DURABLE_BATCHING=false
BOOKA_CONTINUITY_THREAD_PROJECTION=false
BOOKA_CONTINUITY_CONTEXT_MODE=off
BOOKA_CONTINUITY_MEMORY_FACTS=false
```

Do not place secrets in these flags.

**Step 3: Instrument safety metrics**

Record counters/histograms without raw message text or identifiers:

- `conversation_route_needs_code_total`
- `conversation_route_changed_total`
- `conversation_queue_claim_total`
- `conversation_queue_lease_recovery_total`
- `conversation_duplicate_effect_prevented_total`
- `conversation_context_isolation_failure_total`
- `conversation_state_conflict_total`
- `conversation_handoff_total`
- context assembly duration and token estimate

Use hashed/truncated correlation IDs only in logs.

**Step 4: Extend readiness**

When any continuity flag is live, readiness must verify the new tables and claim RPC. In `shadow` or `off`, report a warning rather than falsely declaring a live feature ready.

**Step 5: Run tests and commit**

```bash
npm test -- --runInBand \
  src/__tests__/lib/offboarding/purgeWorker.test.ts \
  src/__tests__/lib/offboarding/exporter.test.ts \
  src/__tests__/lib/whatsapp/v2/continuityFlags.test.ts \
  src/__tests__/api/ready/route.test.ts
git add src/lib/offboarding/purgeWorker.ts \
  src/lib/offboarding/exporter.ts \
  src/lib/envValidation.ts \
  src/app/api/ready/route.ts \
  src/lib/whatsapp/v2/continuityFlags.ts \
  src/lib/whatsapp/v2/continuityMetrics.ts \
  src/lib/whatsapp/v2/routeSession.ts \
  src/lib/whatsapp/v2/queueBatch.ts \
  src/lib/ai/conversation-context.ts \
  src/__tests__/lib/offboarding/purgeWorker.test.ts \
  src/__tests__/lib/offboarding/exporter.test.ts \
  src/__tests__/lib/whatsapp/v2/continuityFlags.test.ts \
  src/__tests__/api/ready/route.test.ts \
  .env.example
git commit -m "feat(conversations): add safe continuity rollout controls"
```

Expected: PASS.

---

### Task 13: Validate the complete feature locally and prepare the controlled pilot handoff

**Files:**

- Create: `docs/runbooks/conversation-continuity-rollout.md`
- Create: `docs/runbooks/conversation-continuity-smoke-handoff.md`
- Modify: `docs/superpowers/specs/2026-09-28-conversation-continuity-tenant-safe-memory-design.md` only if implementation decisions changed; otherwise leave it untouched

**Step 1: Run focused feature tests**

```bash
npm test -- --runInBand \
  src/__tests__/lib/whatsapp/v2 \
  src/__tests__/lib/ai/conversation-context.test.ts \
  src/__tests__/lib/customers/channelIdentity.test.ts \
  src/__tests__/lib/customers/memoryFacts.test.ts \
  src/__tests__/app/api/worker/whatsapp/route.test.ts \
  src/__tests__/app/api/chats/messages.route.test.ts \
  src/__tests__/app/api/chats/release.route.test.ts \
  src/__tests__/api/webhooks/whatsapp/meta/route.test.ts \
  src/__tests__/api/webhooks/instagram/route.test.ts \
  src/__tests__/lib/offboarding/purgeWorker.test.ts \
  src/__tests__/lib/offboarding/exporter.test.ts \
  src/__tests__/scripts/validateSchemaManifest.test.ts \
  src/__tests__/scripts/conversationContinuityMigration.test.ts
```

Expected: PASS.

**Step 2: Run repository gates**

```bash
npm run typecheck:ci
npx eslint \
  src/lib/whatsapp/v2 \
  src/lib/ai/conversation-context.ts \
  src/lib/ai/context-builder.ts \
  src/lib/customers/channelIdentity.ts \
  src/lib/customers/memoryFacts.ts \
  src/app/api/worker/whatsapp/route.ts \
  src/app/api/webhooks/whatsapp/meta/route.ts \
  src/app/api/webhooks/instagram/route.ts
git diff --check
```

Expected: all commands PASS. If the repository has unrelated baseline failures, capture the exact command and prove changed files are clean; do not hide them with `|| true`.

**Step 3: Self-review the security invariants**

Search for unsafe lookups and old batching:

```bash
rg -n "pending_messages|claimBatch|appendPendingMessage" src --glob '!src/lib/whatsapp/v2/messageBatcher.ts'
rg -n "eq\('external_id'|eq\('phone_number'|eq\('from_number'" src/lib/whatsapp/v2 src/lib/ai src/lib/customers
rg -n "claim_whatsapp_queue_messages|non-locking fallback" src db
```

Expected:

- no runtime use of JSON pending messages;
- every identity/history lookup is preceded by or paired with tenant scoping;
- the old row-level claim RPC is unused by the new worker;
- no non-locking fallback remains.

**Step 4: Write the rollout runbook**

Document exact gates:

1. generate a Supabase backup and capture rollback identifiers;
2. run `db/releases/2026-09-28-conversation-continuity.sql` in Supabase SQL Editor;
3. run `scripts/sql/verify_conversation_continuity.sql` and `npm run db:validate`;
4. deploy with all continuity flags off;
5. enable routing sessions and durable batching only for pilot tenant `7496ef23-098f-4eb1-a5e6-6060a27610e4` (`glo`);
6. verify one shared-number routing-code switch and one same-tenant follow-up;
7. enable thread projection;
8. run context in shadow and compare chosen tenant/thread/state without affecting replies;
9. enable live context for `glo` only;
10. enable verified memory facts last;
11. keep Instagram isolated unless the tenant connection is present;
12. define rollback as flag disable first, image rollback second, schema rollback only if tables remain empty.

**Step 5: Write the owner-led smoke handoff**

The smoke script must capture UTC timestamps and sanitized IDs for:

- first WhatsApp message with `GLOX00`;
- a second message providing a missing detail without repeating the service;
- a later message that resumes the unfinished enquiry;
- a deliberate routing-code switch test using a non-pilot fixture tenant in staging only;
- booking creation exactly once under webhook replay;
- human takeover, operator reply, release, and AI resume without re-asking;
- Instagram two-turn context if connected;
- an explicit preference that becomes a fact and a sensitive statement that does not;
- queue lease recovery and no duplicate outbound effect;
- one completed-enquiry/new-enquiry boundary.

Do not include customer PII or Meta secrets in the handoff.

**Step 6: Review the complete diff**

```bash
git status --short
git diff --stat 00f4b0e..HEAD
git log --oneline --decorate -15
```

Confirm the unrelated smoke-test handoff file was neither staged nor modified.

**Step 7: Commit documentation**

```bash
git add docs/runbooks/conversation-continuity-rollout.md \
  docs/runbooks/conversation-continuity-smoke-handoff.md
git commit -m "docs(conversations): add continuity rollout and smoke gates"
```

---

## Final review gate before any merge or deployment

Run:

```bash
git status --short
git diff --check
npm run typecheck:ci
npm test -- --runInBand src/__tests__/lib/whatsapp/v2 src/__tests__/lib/ai/conversation-context.test.ts src/__tests__/lib/customers/channelIdentity.test.ts src/__tests__/lib/customers/memoryFacts.test.ts
```

Then perform an independent code review using `requesting-code-review`, specifically asking the reviewer to look for:

- cross-tenant history or identity reads;
- route-session precedence mistakes;
- lost-message or double-claim races;
- duplicate booking/payment/send side effects;
- stale state overwrites;
- prompt-injection through stored summaries or customer text;
- sensitive fact retention;
- incomplete offboarding/export coverage;
- migrations that cannot be safely applied through Supabase SQL Editor.

Do not merge until all release-blocking findings are resolved and the full gate is rerun.
