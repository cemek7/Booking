# DSAR + AI Disclosure + Meta Opt-in Implementation Plan

**Goal:** Implement P0 compliance engineering: (A) DSAR data **export** and **erasure** for an end-customer, (B) AI-interaction **disclosure** + human handoff, (C) **Meta opt-in** proof capture.

**Decisions baked in (resolved 2026-06-15/16):**
- **Erasure = anonymize-and-keep for financial records, hard-delete for the rest.** Transactions/bookings keep their rows with PII stripped/anonymized (tax/accounting retention); messages, reviews, leads, media, feedback, escalations are hard-deleted.
- **DSAR trigger = tenant-mediated (dashboard/API, auth owner/manager) + email intake** run by staff/admin. No customer self-serve (customers are phone-only, no login).
- **AI disclosure = once per customer (first inbound), tracked in `whatsapp_conversations.flow_data`; "talk to a human" routes to `escalation_queue`** (the `escalate` action already exists).

**Safety:** DSAR erasure is destructive — `eraseCustomerData` defaults to `dryRun: true` (returns the plan without mutating). A real erase requires `dryRun: false`. The registry is the explicit, reviewable source of truth so no table is silently missed.

---

## Architecture / file structure

| File | Responsibility |
|---|---|
| `src/lib/dsar/registry.ts` | `CUSTOMER_PII_TABLES: PiiTable[]` — explicit map: table, link column (`customer_id` \| `customer_phone`), PII columns, `onErase: 'anonymize' \| 'delete'`. **Owner-reviewable.** |
| `src/lib/dsar/export.ts` | `exportCustomerData(admin, { tenantId, customerId })` → JSON bundle (customer row + each registry table's rows). Read-only. |
| `src/lib/dsar/erase.ts` | `eraseCustomerData(admin, { tenantId, customerId, dryRun })` → per registry: anonymize (UPDATE) or delete (DELETE). Returns a per-table report. Destructive only when `dryRun:false`. |
| `src/lib/dsar/anonymize.ts` | `redactedValue(column)` helpers — deterministic redaction (e.g. name→`"[erased]"`, phone→`"[erased]"`). |
| `src/app/api/tenants/[tenantId]/customers/[customerId]/dsar/route.ts` | `GET` = export; `POST {action:'erase', confirm:true}` = erase. Auth: roles `owner`,`manager`; tenant-scoped via existing `createHttpHandler`. |
| `src/lib/whatsapp/v2/aiDisclosure.ts` | `ensureDisclosure(conv)` → returns disclosure text if not yet sent (checks `flow_data.ai_disclosure_sent_at`), and marks it sent. |
| `src/lib/whatsapp/v2/pipeline.ts` (edit) | On first inbound per conversation, prepend/send disclosure; ensure `escalate` action writes to `escalation_queue`. |
| `src/lib/whatsapp/v2/optInProof.ts` | `recordOptIn(admin, { tenantId, phone, source, channel })` → stores opt-in proof (timestamp, source) for Meta compliance. Storage: `whatsapp_conversations.flow_data.opt_in` or a new `opt_in_log` table (see Task C). |

**Registry seed (verify each against migrations before finalizing):**
`customers` (anchor), `reservations` (link `customer_id`, anonymize), `transactions` (link `customer_id`/`customer_phone`, anonymize), `messages` (delete), `reviews` (delete), `service_ratings`/`staff_ratings` (delete or anonymize), `customer_feedback` (delete), `leads` (link `phone`, delete), `whatsapp_media` (delete), `escalation_queue` (link `customer_phone`, delete), `customer_analytics` (delete), `whatsapp_conversations` (link `phone_number`, delete).

---

## Tasks

### Task A1 — PII registry
- Create `src/lib/dsar/registry.ts` with the `PiiTable` type and seed list above. Each entry reviewed against the actual migration columns. No test (pure data) beyond a shape assertion.

### Task A2 — Anonymize helpers (TDD)
- `src/lib/dsar/anonymize.ts`: `redactValue(kind)` returning stable redaction tokens; test covers name/phone/email/text.

### Task A3 — Export (TDD, mocked admin client)
- `exportCustomerData` iterates the registry, runs `admin.from(table).select('*').eq(link, value)`, assembles `{ customer, tables: { [table]: rows } }`. Test with a mocked Supabase admin client (chainable `.from().select().eq()` returning fixtures). Assert all registry tables queried with correct link/value.

### Task A4 — Erase (TDD, mocked admin client, dryRun default)
- `eraseCustomerData` builds a plan from the registry; when `dryRun:false`, runs UPDATE (anonymize cols) or DELETE per entry. Returns `{ dryRun, actions: [{table, op, count}] }`. Tests: (1) dryRun makes no `.update/.delete` calls; (2) real run anonymizes financial tables and deletes the rest; (3) anchor `customers` row anonymized last.

### Task A5 — DSAR API route
- `GET` → export JSON (filename `dsar-export-<customerId>.json`). `POST` `{action:'erase', confirm:true}` → `eraseCustomerData(..., {dryRun:false})`; without `confirm:true`, returns the dryRun plan. Auth owner/manager, tenant-scoped. Log to `audit_logs`/`security_audit_log`.

### Task B1 — AI disclosure helper (TDD)
- `ensureDisclosure(conv)`: if `flow_data.ai_disclosure_sent_at` unset → return `{ text, flowDataPatch }`; else `null`. Test both branches.

### Task B2 — Wire disclosure into pipeline (careful edit + test)
- In `processMessageV2`, after identity/conversation load and before/with the first reply, if `ensureDisclosure` returns text, send it (or prepend) and persist the `flow_data` patch via `updateConversation`. Add a focused test around the new branch (mock send + conversationState).

### Task B3 — Human handoff
- Verify the `escalate` action inserts into `escalation_queue` (tenant_id, customer_phone, session_id, reason, conversation_snapshot). If missing, add it. Add detection for explicit "talk to a human" phrasing → `escalate`. Test the insert.

### Task C — Meta opt-in proof
- `recordOptIn` stores opt-in evidence at the point consent is captured (booking form submit and/or first inbound where the customer initiates). Decide storage: prefer a dedicated `opt_in_log` table (clean migration `ALTER`/`CREATE TABLE` — NOT `IF NOT EXISTS` for column adds). Flag for owner: confirm where opt-in is actually captured today before finalizing.

---

## Build order & safety gates
1. A1→A5 (DSAR) first — isolated, safe, fully mockable. Erase stays `dryRun` until owner runs it against real data.
2. B1→B3 (disclosure/handoff) — touches `processMessageV2`; minimal edit + test; review before deploy.
3. C (opt-in) — needs confirmation of current capture points; may need a migration.

## Self-review
- Registry is the single source of truth; export + erase both derive from it → consistent.
- Destructive path guarded by `dryRun` default + `confirm:true` on the route.
- Disclosure flag persisted in existing `whatsapp_conversations.flow_data` → no migration.
- Open items flagged: registry column verification, opt-in capture point, escalate-insert existence.
