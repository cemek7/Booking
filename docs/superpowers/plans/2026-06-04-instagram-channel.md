# Instagram Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers DM a tenant's own Instagram account and have the Booka v2 agent reply, book, and land the thread in that tenant's inbox — without disturbing the working WhatsApp path.

**Architecture:** Reuse the v2 pipeline unchanged. Generalize the conversation identity from "phone" to "(channel, external_id)" via an **additive** schema change (WhatsApp constraints + `onConflict` stay intact; a partial unique index enforces the channel key). Each tenant connects their own IG professional account (no routing code); the IG webhook maps the recipient account → tenant directly.

**Tech Stack:** Next.js App Router, Supabase/Postgres, TypeScript, Jest (jsdom), Meta Instagram Messaging API ("Instagram API with Instagram Login").

**Spec:** `docs/superpowers/specs/2026-06-04-instagram-channel-design.md`

---

## Decomposition (4 phases, sequential)

This feature is too large for one plan. It ships as four plans, each producing working, testable software:

1. **Phase 1 — Channel-ready schema (THIS PLAN, fully detailed).** Additive migration on `whatsapp_conversations`. Zero code/behavior change to WhatsApp. Unblocks everything else.
2. **Phase 2 — IG transport & identity** (charter below). Generalize `resolveIncoming` + `conversationState` to be channel-aware (WhatsApp call sites unchanged via defaults); IG provider adapter; `/api/webhooks/instagram`; channel-based reply routing in the worker.
3. **Phase 3 — IG onboarding/connect** (charter below). Per-tenant OAuth (Instagram Login), token storage, webhook subscription, "Connect Instagram" UI, Meta app config.
4. **Phase 4 — Inbox + 24h guard + copy** (charter below). Channel badge + reply routing in `/chat`; 24-hour-window guard with WhatsApp handoff; marketing copy corrections.

Phases 2–4 are chartered (scope + files + key decisions), not yet step-by-step. Each gets expanded into a full no-placeholder plan when its predecessor is merged — Phase 2 in particular requires reading `pipeline.ts` and the WhatsApp worker in full before its code can be written without guesswork.

---

## Phase 1 — Channel-ready schema

**Why schema-only:** The DB change is the one irreversible, high-blast-radius step. Isolating it lets us land and verify it against the working WhatsApp path before any code depends on it. After this phase, WhatsApp behaves identically and the table can represent Instagram rows.

**Design note (supersedes spec §5 step 4):** Do **not** drop `UNIQUE (tenant_id, phone_number)`. `conversationState.ensureConversation` upserts with `onConflict: 'phone_number,tenant_id'`, which requires that exact constraint. We keep it and add a partial unique index for the general channel key. WhatsApp rows keep a populated `phone_number`; Instagram rows have `phone_number = NULL` (NULLs are distinct in the WA unique, so IG rows never collide there).

### Task 1: Additive migration on `whatsapp_conversations`

**Files:**
- Create: `db/migrations/078_instagram_channel.sql`
- Create: `db/migrations/078_instagram_channel_rollback.sql` (manual fallback per project migration rule)

- [ ] **Step 1: Write the forward migration**

Create `db/migrations/078_instagram_channel.sql`:

```sql
-- 078_instagram_channel.sql
-- Generalize whatsapp_conversations to support multiple channels (WhatsApp + Instagram).
-- ADDITIVE + WhatsApp-zero-touch: the existing UNIQUE(tenant_id, phone_number) and the
-- ensureConversation onConflict('phone_number,tenant_id') both stay valid.

BEGIN;

-- 1. Channel discriminator. Existing rows are WhatsApp.
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

-- 2. Per-channel external customer id (phone for WA, IGSID for IG).
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS external_id TEXT;

-- 3. Backfill existing WhatsApp rows.
UPDATE whatsapp_conversations
  SET external_id = phone_number
  WHERE external_id IS NULL AND phone_number IS NOT NULL;

-- 4. phone_number is no longer required (Instagram rows have none).
ALTER TABLE whatsapp_conversations
  ALTER COLUMN phone_number DROP NOT NULL;

-- 5. Constrain channel to known values.
ALTER TABLE whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_channel_check;
ALTER TABLE whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_channel_check
  CHECK (channel IN ('whatsapp', 'instagram'));

-- 6. Enforce uniqueness on the general channel key (covers both WA and IG).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conv_channel_external
  ON whatsapp_conversations (tenant_id, channel, external_id)
  WHERE external_id IS NOT NULL;

-- 7. Lookup index for channel-keyed reads.
CREATE INDEX IF NOT EXISTS idx_wa_conv_channel_external
  ON whatsapp_conversations (tenant_id, channel, external_id);

COMMIT;
```

- [ ] **Step 2: Write the rollback script**

Create `db/migrations/078_instagram_channel_rollback.sql`:

```sql
-- Rollback for 078_instagram_channel.sql
-- Safe ONLY before any Instagram rows exist (otherwise SET NOT NULL will fail).
BEGIN;
DROP INDEX IF EXISTS uq_wa_conv_channel_external;
DROP INDEX IF EXISTS idx_wa_conv_channel_external;
ALTER TABLE whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_channel_check;
-- Only re-add NOT NULL if there are no NULL phone_numbers (no IG rows):
ALTER TABLE whatsapp_conversations ALTER COLUMN phone_number SET NOT NULL;
ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS external_id;
ALTER TABLE whatsapp_conversations DROP COLUMN IF EXISTS channel;
COMMIT;
```

- [ ] **Step 3: Apply the migration**

Run: `psql "$DATABASE_URL" -f db/migrations/078_instagram_channel.sql`
Expected: `BEGIN ... ALTER TABLE ... UPDATE n ... CREATE INDEX ... COMMIT` with no errors.

- [ ] **Step 4: Verify columns, backfill, and nullability**

Run:
```bash
psql "$DATABASE_URL" -c "\d whatsapp_conversations"
psql "$DATABASE_URL" -c "SELECT count(*) AS rows, count(external_id) AS with_ext, count(*) FILTER (WHERE phone_number IS NULL) AS null_phone FROM whatsapp_conversations;"
```
Expected: `channel` column present (`not null default 'whatsapp'`), `external_id` present, `phone_number` now nullable. `with_ext` equals `rows` (every existing WA row backfilled); `null_phone = 0` (no IG rows yet).

- [ ] **Step 5: Verify the indexes/constraints exist**

Run:
```bash
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename='whatsapp_conversations';"
```
Expected: includes `uq_wa_conv_channel_external` and `idx_wa_conv_channel_external`, and the pre-existing `whatsapp_conversations` unique on `(tenant_id, phone_number)` is still listed.

- [ ] **Step 6: Smoke-test that the WhatsApp upsert path still works**

This proves the kept constraint + `onConflict` are intact. Run:
```bash
psql "$DATABASE_URL" <<'SQL'
-- Pick any existing tenant id:
\set t (SELECT id FROM tenants LIMIT 1)
-- Simulate the ensureConversation upsert twice; second must NOT create a duplicate.
INSERT INTO whatsapp_conversations (tenant_id, phone_number, external_id, channel, role)
VALUES ((SELECT id FROM tenants LIMIT 1), '+000PLAN_TEST', '+000PLAN_TEST', 'whatsapp', 'customer')
ON CONFLICT (phone_number, tenant_id) DO NOTHING;
INSERT INTO whatsapp_conversations (tenant_id, phone_number, external_id, channel, role)
VALUES ((SELECT id FROM tenants LIMIT 1), '+000PLAN_TEST', '+000PLAN_TEST', 'whatsapp', 'customer')
ON CONFLICT (phone_number, tenant_id) DO NOTHING;
SELECT count(*) AS should_be_1 FROM whatsapp_conversations WHERE phone_number='+000PLAN_TEST';
DELETE FROM whatsapp_conversations WHERE phone_number='+000PLAN_TEST';
SQL
```
Expected: `should_be_1 = 1` (the `onConflict('phone_number,tenant_id')` still resolves), then the cleanup `DELETE` runs.

- [ ] **Step 7: Confirm the app still builds and WhatsApp tests pass**

Run: `npx jest src/__tests__/lib/whatsapp -i` and `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit`
Expected: existing WhatsApp/v2 suites pass unchanged; 0 TS errors. (No code changed in this phase, so this is a regression guard only.)

- [ ] **Step 8: Commit**

```bash
git add db/migrations/078_instagram_channel.sql db/migrations/078_instagram_channel_rollback.sql
git commit -m "feat(db): channel-ready whatsapp_conversations (additive, WhatsApp untouched)"
```

---

## Phase 2 — IG transport & identity (charter)

**Produces:** an Instagram DM to a (manually configured) connected account flows through the v2 pipeline and the agent replies on Instagram. WhatsApp unchanged.

**Key decisions:**
- Generalize `conversationState` + `resolveIncoming` to be channel-aware **without changing WhatsApp call sites**: add an optional `channel`/`externalId` so existing `getConversation(phone, tenantId)` etc. keep working (default `channel='whatsapp'`, `externalId=phone`, query by `phone_number` as today); the IG path calls the same functions with `channel='instagram'` and queries by the new partial index. This avoids forking logic (DRY) while keeping the WA path byte-for-byte.
- IG webhook resolves tenant from the **recipient IG account id** (no routing code), then reuses `ensureConversation` + `whatsapp_message_queue` exactly like `webhooks/whatsapp/route.ts:197`.
- Worker selects the send adapter by the conversation's `channel`.

**Files (create/modify):**
- Create: `src/lib/whatsapp/providers/instagram.ts` — IG Send API adapter (`sendText`, `sendMedia`).
- Modify: `src/lib/whatsapp/providers/types.ts` + `index.ts` — minimal `ChannelClient { sendText, sendMedia }` that WA and IG both satisfy; keep WA-only methods (QR/pairing/template) on the WA subtype; route by channel.
- Create: `src/app/api/webhooks/instagram/route.ts` — GET verify (hub.challenge) + POST (signature verify, recipient→tenant, normalize, enqueue).
- Modify: `src/lib/whatsapp/v2/identityResolver.ts` — channel-aware `resolveIncoming(channel, externalId, messageText)` with WhatsApp default behavior preserved.
- Modify: `src/lib/whatsapp/v2/conversationState.ts` — channel-aware `getConversation/ensureConversation/updateConversation/resetConversation` (defaults preserve WhatsApp).
- Modify: the WhatsApp worker (reply send) — pick adapter by `channel`.
- Modify: callers that pass `phone` positionally (`webhooks/whatsapp/route.ts`, `webhooks/whatsapp/meta/route.ts`, `webhooks/whatsapp/[tenantId]/route.ts`, `v2/pipeline.ts`, `v2/flows/*`) — only where signatures change; prefer defaults so most are untouched.

**Pre-expansion reads required:** full `pipeline.ts`, the WhatsApp worker (`/api/worker/whatsapp`), `messageBatcher.ts`, and the exact IG Send API request/response shape from live Meta docs.

**Tests:** `identityResolver` (whatsapp + instagram resolution), `conversationState` (channel defaulting), IG webhook (signature valid/invalid, recipient→tenant, normalization), IG adapter (send success/failure). Use the queue-based Supabase mock pattern from `src/__tests__/lib/whatsapp/v2/actionValidator.test.ts`.

---

## Phase 3 — IG onboarding/connect (charter)

**Produces:** a tenant can connect their own Instagram professional account from settings/onboarding; Booka stores the token and subscribes the account to the webhook.

**Key decisions:**
- Use **Instagram API with Instagram Login** (no Facebook Page required per tenant).
- Store IG access token + IG account id per tenant. Reuse `whatsapp_provider_secrets` (add a `channel`/`provider='instagram'` discriminator) rather than a new table, to mirror the existing pattern.
- Required scopes: `instagram_business_basic`, `instagram_business_manage_messages` (confirm exact names + Graph API version against live Meta docs at build time).

**Files (create/modify):**
- Create: `src/app/api/auth/instagram/connect/route.ts` (OAuth start) + `callback/route.ts` (token exchange, store, subscribe webhook).
- Modify: `src/lib/whatsapp/providerSecrets.ts` — channel-aware get/upsert.
- Modify: onboarding/settings UI — "Connect Instagram" button + status (mirror the WhatsApp connect section, e.g. `src/components/settings/WhatsAppSyncSection.tsx`).
- Migration if `whatsapp_provider_secrets` needs a `channel` column.

**Meta config (one-time, manual):** add Instagram product to existing app, set webhook callback `/api/webhooks/instagram` + verify token, subscribe `messages`, set OAuth redirect URI, submit App Review (test with ≤25 role users before approval).

---

## Phase 4 — Inbox + 24h guard + copy (charter)

**Produces:** staff see WA/IG threads distinctly and reply on the right channel; the agent respects Instagram's 24-hour window; marketing claims become accurate.

**Key decisions:**
- `/chat` inbox: per-thread channel badge; reply composer routes through the thread's channel adapter.
- **24-hour-window guard:** track last inbound timestamp per IG conversation; allow free replies only within 24h; block proactive IG sends; route reminders/recovery to WhatsApp (or skip). This is the honesty guarantee — IG = capture, WhatsApp = lifecycle.
- Marketing copy: reframe IG as enquiry/capture (not follow-up) in `BookaLanding.tsx`, `page.tsx`, and metadata in `layout.tsx` + `booka/page.tsx`. Use the copywriting skill for final wording.

**Files (modify):** `src/components/chat/ChatThread.tsx`, `ChatSidebar.tsx`, `ChatComposer.tsx`; the worker/cron send paths (24h guard); the marketing files above.

**Tests:** 24h-guard unit tests (in-window allowed, out-of-window blocked + handoff), inbox channel-badge rendering, reply routing.

---

## Self-review (Phase 1)

- **Spec coverage:** Phase 1 implements spec §5 (data model) with the documented safety improvement over §5 step 4. Spec §6–§9 are covered by the Phase 2–4 charters.
- **Placeholder scan:** Phase 1 contains complete SQL and exact commands. Phases 2–4 are intentionally charters (declared as such), to be expanded before execution — not placeholders within an executable phase.
- **Consistency:** Column/index names (`channel`, `external_id`, `uq_wa_conv_channel_external`, `idx_wa_conv_channel_external`) are used identically across the migration, verification, and charters.
