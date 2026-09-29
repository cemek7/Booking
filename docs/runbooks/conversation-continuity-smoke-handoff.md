# Conversation continuity owner-led smoke handoff

## Safety and evidence rules

- Run staging first against tenant `glo` (`7496ef23-098f-4eb1-a5e6-6060a27610e4`). Production smoke requires separate approval and must not include the routing-switch or forced-lease tests.
- Use internal test customer accounts and low-value/non-deposit services unless a separate payment gate explicitly calls for a deposit.
- Record UTC timestamps and only truncated/hashed event, message, thread, booking and effect IDs. Never record message text, phone numbers, Instagram-scoped IDs, Meta secrets, Paystack authorization codes, or card details.
- Capture server-side evidence after each owner action. A visible reply alone is not proof of correct tenant/thread routing.

## Preflight

Record:

| Item | Evidence | Result |
|---|---|---|
| Environment and exact commit/image | pending | PENDING |
| Health/readiness/schema validation | pending | PENDING |
| Pilot continuity settings | pending | PENDING |
| Worker cron and recent error scan | pending | PENDING |
| WhatsApp callback/tenant mapping | pending | PENDING |
| Instagram connection | pending or `SKIPPED—not connected` | PENDING |
| Named human operator | pending | PENDING |

Do not proceed if readiness is not 200-ready after a pilot flag is live.

## Evidence queries

Use read-only queries with the pilot tenant predicate. Add narrow UTC bounds around the supplied send time. Do not paste query results containing message content into the handoff.

```sql
select id, channel, status, state_version, last_inbound_at, last_outbound_at, completed_at
from public.conversation_threads
where tenant_id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
  and created_at between '<utc-start>'::timestamptz and '<utc-end>'::timestamptz
order by created_at;

select id, status, retry_count, batch_id, lease_owner, lease_expires_at,
       conversation_id, conversation_thread_id, provider_timestamp, processed_at
from public.whatsapp_message_queue
where tenant_id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
  and created_at between '<utc-start>'::timestamptz and '<utc-end>'::timestamptz
order by created_at;

select id, conversation_thread_id, direction, provider_message_id,
       delivery_status, idempotency_key, timestamp
from public.messages
where tenant_id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
  and timestamp between '<utc-start>'::timestamptz and '<utc-end>'::timestamptz
order by timestamp;

select id, thread_id, effect_type, status, result_ref, created_at, updated_at
from public.conversation_effects
where tenant_id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
  and created_at between '<utc-start>'::timestamptz and '<utc-end>'::timestamptz
order by created_at;
```

## Owner-led sequence

### 1. First WhatsApp route and reply

1. Open the pilot's production/staging-specific WhatsApp share link.
2. Send one enquiry retaining `GLOX00` in the prefilled message. Record send UTC.
3. Confirm one inbound message, one queue row attached to one tenant/thread, and one Booka reply.
4. Confirm the route session is scoped to `whatsapp + gateway phone ID + external identity`, expires in the future, and points only to `glo`.

Acceptance: no needs-code loop, no second tenant, no duplicate outbound effect.

### 2. Missing detail without repeating the service

Reply with only a missing detail such as a date or time. Do not restate the requested service. Record UTC.

Acceptance: the same unfinished thread is used; confirmed service/intent remains; state version increases monotonically; Booka does not ask for the service again.

### 3. Resume later

After a pause, send a short continuation such as “afternoon works.”

Acceptance: same tenant/customer/thread; bounded recent turns plus structured state are used; Booka continues from the missing field rather than restarting.

### 4. Explicit route switch — staging only

Use an approved fixture tenant/routing code and the same internal test sender. Send the fixture code explicitly.

Acceptance: explicit valid code overrides the cached `glo` route; a subsequent message without a code stays with the fixture during its TTL; neither tenant can read the other's customer identity, history, memory, or effects. Restore the test sender to `GLOX00` before continuing.

### 5. Booking and webhook replay

Use an active service that does not require a deposit. Complete the booking once, then replay the same signed inbound webhook/event in the controlled harness.

Acceptance:

- exactly one reservation exists;
- exactly one `create_booking` effect exists for the idempotency key;
- no second outbound dispatch occurs;
- duplicate webhook ingestion returns/reuses the canonical event without a second queue delivery;
- the enquiry thread becomes `completed`.

### 6. Completed-enquiry boundary

After the non-deposit booking is confirmed, send a genuinely new enquiry.

Acceptance: a new active thread is created for the same tenant/channel identity; the completed thread remains immutable history; prior booking service/date is not silently copied into the new enquiry.

### 7. Human takeover and release

From Booka Chats, claim/take over the active test conversation. Send one operator reply, then release it and send a customer continuation.

Acceptance: thread status/human-handling window pauses AI; operator outbound uses the same canonical thread and durable outbound ledger; release returns the thread to active; AI resumes with the pre-handoff context and does not ask for already confirmed details.

### 8. Instagram continuity — only if connected

From a separate Instagram tester account, send a two-turn DM where turn two supplies only the missing detail.

Acceptance: exact tenant Instagram credential mapping; one Instagram-scoped identity; same Instagram thread across both turns; no WhatsApp identity merge without a verified link signal. If no tenant Instagram connection exists, record `SKIPPED—not connected`; do not invent credentials or change callbacks for this test.

### 9. Verified preference and sensitive-data exclusion

Send one explicit allowlisted preference (for example a usual service or preferred staff member), then a separate sensitive statement that is not on the allowlist.

```sql
select id, customer_id, namespace, fact_key, status, source_type,
       source_message_id, source_record_id, consent_basis, verified_at, expires_at
from public.customer_memory_facts
where tenant_id = '7496ef23-098f-4eb1-a5e6-6060a27610e4'::uuid
  and created_at between '<utc-start>'::timestamptz and '<utc-end>'::timestamptz
order by created_at;
```

Acceptance: exactly one active source-backed allowlisted fact; correction supersedes rather than duplicates; no fact is created from the sensitive statement or model inference.

### 10. Lease recovery — staging only

Pause the staging conversation worker before sending a test message. Identify only that test queue row. In Supabase SQL Editor, give that exact row an already-expired processing lease, then resume/invoke the worker. Do not use a broad update and do not perform this test in production.

Acceptance: the expired row is reclaimed once, processed once, and completed; retry/recovery metric increases; no duplicate reply/effect; no other conversation row shares its batch or lease.

### 11. Export and deletion coverage

Generate a tenant export in a disposable staging fixture and inspect the archive.

Acceptance: route sessions, channel identities, threads, verified facts, and redacted effect metadata are present; effect provider metadata is absent. Run purge-order verification only against the disposable fixture: effects/facts/messages/queue precede threads, identities/sessions precede customers.

## Evidence matrix

| Gate | Send/action UTC | Sanitized reference | Server-side evidence | Result |
|---|---|---|---|---|
| WhatsApp first route/reply | pending | pending | pending | PENDING |
| Missing-detail continuation | pending | pending | pending | PENDING |
| Later resume | pending | pending | pending | PENDING |
| Staging route switch | pending | pending | pending | PENDING |
| Booking exactly once | pending | pending | pending | PENDING |
| Webhook replay idempotency | pending | pending | pending | PENDING |
| Completed/new thread boundary | pending | pending | pending | PENDING |
| Human takeover/operator/release | pending | pending | pending | PENDING |
| Instagram two-turn context | pending | pending | pending | PENDING/SKIPPED |
| Preference retained | pending | pending | pending | PENDING |
| Sensitive statement excluded | pending | pending | pending | PENDING |
| Lease recovery/no duplicate effect | pending | pending | pending | PENDING |
| Export/purge coverage | pending | pending | pending | PENDING |

## Final decision

Status: **NO-GO until all mandatory gates pass**.

Any cross-tenant evidence, mixed batch, duplicate booking/payment/send, state conflict, lost confirmed detail, sensitive fact retention, or failed handoff continuity is release-blocking. Disable the pilot continuity flags before further customer traffic and record the precise failing gate.
