# Conversation continuity controlled rollout

## Scope

This runbook rolls tenant-safe conversation routing, canonical threads, bounded AI context, verified preferences, and handoff continuity to the controlled `glo` pilot.

- Pilot tenant: `7496ef23-098f-4eb1-a5e6-6060a27610e4` (`glo`)
- Production routing code: `GLOX00`
- Apply to staging first. Production requires a separately approved gate.
- Never paste Supabase credentials, Meta tokens, message text, phone numbers, or payment authorization codes into the evidence record.
- Instagram has no legacy processing path. Apply and verify the full schema before deploying this release anywhere an Instagram connection is receiving DMs.

## 1. Capture rollback identifiers

Before SQL or deployment:

1. Confirm a current Supabase backup or point-in-time recovery window in the target project's **Database → Backups** page.
2. Record the project/environment, backup/PITR timestamp in UTC, current application commit, immutable image tag and image ID.
3. Save the current `tenants.settings` value for the pilot with a read-only query. Store the result privately because it may contain business configuration.
4. Confirm the five continuity environment defaults are `false`, `false`, `false`, `off`, `false` respectively. Do not expose unrelated environment values.

Stop if a restorable database point or the current immutable image cannot be identified.

## 2. Apply the ordered Supabase release set

Use Supabase SQL Editor and run each complete file separately, in this order. Do not concatenate, omit, reorder, or manually edit the statements:

1. `db/releases/2026-09-28-conversation-continuity.sql`
2. `db/releases/2026-09-28-channel-identity-runtime-hardening.sql`
3. `db/releases/2026-09-28-conversation-ingest-replay-hardening.sql`
4. `db/releases/2026-09-29-conversation-effect-delivery-hardening.sql`
5. `db/releases/2026-09-29-verified-customer-memory.sql`
6. `db/releases/2026-09-29-handoff-thread-continuity.sql`

Expected named results include `conversation_continuity_schema_ready`, `channel_identity_runtime_ready`, and `conversation_ingest_replay_ready`. A duplicate-preflight exception, permission failure, missing relation/function, or partial execution is a stop condition.

Then run the complete contents of `scripts/sql/verify_conversation_continuity.sql`. Expected:

```text
conversation_continuity_schema_ready
```

From the release image, run:

```bash
npm run db:validate
```

Do not deploy until both gates pass.

## 3. Deploy with global defaults off

Deploy the reviewed immutable image with:

```dotenv
BOOKA_CONTINUITY_ROUTING_SESSIONS=false
BOOKA_CONTINUITY_DURABLE_BATCHING=false
BOOKA_CONTINUITY_THREAD_PROJECTION=false
BOOKA_CONTINUITY_CONTEXT_MODE=off
BOOKA_CONTINUITY_MEMORY_FACTS=false
```

Verify exact commit, `/api/health`, `/api/ready`, `npm run db:validate`, Meta pilot readiness, worker cron presence, and zero startup/schema/Redis/OAuth/provider errors. Readiness may describe continuity as advisory while every tenant flag is off; it must become a hard schema/RPC gate as soon as a pilot flag is live.

WhatsApp tenants remain on the established ingestion path while `durable_batching` is false. Instagram remains v2-only, which is why the schema gate precedes deployment.

## 4. Enable the pilot in stages

Every update below preserves unrelated tenant settings. Run one stage, complete its smoke gate, then continue. Replace no identifiers: this runbook is intentionally pinned to the controlled pilot tenant.

### Stage A — routing session and atomic batching

```sql
update public.tenants
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'conversation_continuity',
  coalesce(settings -> 'conversation_continuity', '{}'::jsonb) ||
  '{"routing_sessions":true,"durable_batching":true,"thread_projection":false,"context_mode":"off","memory_facts":false}'::jsonb
)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Run the routing-code, same-tenant follow-up, atomic-ingest, queue claim, replay and lease-recovery gates in the smoke handoff. An explicit valid routing code must override a cached route. Never test a tenant switch in production; use a fixture tenant in staging only.

### Stage B — compatibility projection

```sql
update public.tenants
set settings = jsonb_set(settings, '{conversation_continuity,thread_projection}', 'true'::jsonb, true)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Verify the canonical thread remains authoritative and the legacy conversation mirrors state/version without restoring `flow_data.pending_messages`.

### Stage C — context shadow

```sql
update public.tenants
set settings = jsonb_set(settings, '{conversation_continuity,context_mode}', '"shadow"'::jsonb, true)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Shadow assembly must not alter replies. Compare only sanitized tenant/thread/state outcomes and aggregate duration/token metrics. Any isolation failure, thread mismatch, or raw identifier in metric labels is a stop condition.

### Stage D — live context

```sql
update public.tenants
set settings = jsonb_set(settings, '{conversation_continuity,context_mode}', '"live"'::jsonb, true)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Run the two-turn missing-detail, later-resume, handoff/release, Instagram-if-connected, and completed-enquiry/new-enquiry gates.

### Stage E — verified memory last

```sql
update public.tenants
set settings = jsonb_set(settings, '{conversation_continuity,memory_facts}', 'true'::jsonb, true)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Verify one allowlisted explicit preference is source-backed and a sensitive statement creates no fact. Never infer consented contact data from bookings or model output.

## 5. Required observations

Monitor aggregate metrics without customer/tenant identifiers:

- routing needs-code and route changes;
- queue claims and recovered/retried leases;
- prevented duplicate effects;
- context isolation failures, assembly duration and token estimate;
- optimistic state conflicts;
- human handoffs.

Stop rollout for any cross-tenant lookup, mixed queue batch, duplicate booking/payment/send, stale-state overwrite, unexpected memory fact, failed export/purge coverage, or sustained worker retry.

## 6. Rollback

Flag disable is always first:

```sql
update public.tenants
set settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
  'conversation_continuity',
  coalesce(settings -> 'conversation_continuity', '{}'::jsonb) ||
  '{"routing_sessions":false,"durable_batching":false,"thread_projection":false,"context_mode":"off","memory_facts":false}'::jsonb
)
where id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
returning id, settings -> 'conversation_continuity' as conversation_continuity;
```

Then roll back to the recorded immutable image if application behavior remains unsafe. Schema rollback is last and is allowed only when all new tables are empty and the rollback preflight in `db/migrations/153_conversation_continuity_rollback.sql` passes. Never drop populated continuity tables to recover an application incident.

## 7. Go/no-go

GO requires all mandatory rows in `conversation-continuity-smoke-handoff.md`, zero cross-tenant or duplicate-effect evidence, healthy readiness with the live pilot flags, and a named human operator. Otherwise disable the pilot flags and record NO-GO with the exact failing gate.
