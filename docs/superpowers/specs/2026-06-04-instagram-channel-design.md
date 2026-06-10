# Instagram Channel for Booka v2 — Design Spec

**Date:** 2026-06-04
**Status:** Approved design, pending spec review → implementation plan
**Author:** Brainstormed with Claude Code

---

## 1. Problem & motivation

Booka's marketing advertises a "WhatsApp + Instagram" AI front desk, but **Instagram is not
implemented**. Today "Instagram" appears only as marketing copy plus one onboarding suggestion
(`ownerOnboarding.ts:437` — "share your link on Instagram"). There is no IG message ingestion,
no IG provider, no IG webhook. The agent operates on **WhatsApp only**.

This spec makes the claim true: customers can DM a salon's own Instagram account, the v2 agent
replies and books, and the thread lands in that tenant's chat inbox — **without disturbing the
working WhatsApp path.**

## 2. Why it's worth building

- **Salons / spas / beauty (sharpest ICP): HIGH value.** Instagram is the #1 discovery + enquiry
  channel for beauty in the Nigeria/Africa SMB market. Enquiries ("how much? any space Saturday?")
  arrive in IG DMs constantly.
- **Restaurants / hospitality: MEDIUM.** Real discovery + reservation enquiries.
- **Clinics / medical: LOW–MEDIUM.** Mostly WhatsApp/phone; only aesthetic clinics live on IG.

**Positioning rule (drives both code and copy):** Instagram = **enquiry → booking capture**.
WhatsApp = **lifecycle** (reminders, no-show recovery, rebooking). See §7 (24h window).

## 3. Decisions locked in

1. **Per-tenant own IG account, no routing code.** Each business connects its own Instagram
   professional account via OAuth. The webhook's recipient account maps directly to the tenant.
   (Rejected: a shared "Booka" IG account + routing code — more code, weaker brand, higher Meta
   flag risk.)
2. **Reuse the v2 pipeline unchanged.** Only transport (webhook in / send out) and the identity
   key differ. `slotEngine`, `actionValidator`, `customerBooking`, escalation are untouched.
3. **Data model: extend in place (Option A).** See §5.
4. **No cross-channel identity merge in v1.** A person on WhatsApp and Instagram = two separate
   threads. (Merging is a hard problem deferred to later.)

## 4. Scope

**In scope (v1):**
- IG webhook ingestion + signature verification + normalization into the existing pipeline.
- IG provider adapter (send text + basic image via IG Send API).
- Generalized identity resolution by `(channel, external_id)`.
- Per-tenant IG OAuth connect flow (onboarding + settings), token storage, webhook subscribe.
- Inbox channel badge (WA / IG) and reply routing back through the correct channel.
- 24-hour-window guard with WhatsApp handoff for out-of-window lifecycle messaging.
- Marketing copy corrections (§8).

**Out of scope (v1):**
- Comment-to-DM automation, story replies/mentions, ice-breakers/persistent menus.
- Cross-channel identity merge.
- IG media-rich flows beyond text + basic image.
- A full unified `conversations` table rebuild (Option C) — deferred cleanup.

## 5. Data model (Option A — extend in place)

Current `whatsapp_conversations` (migration `047`) keys a conversation by
`(tenant_id, phone_number)` with `phone_number NOT NULL` and `UNIQUE (tenant_id, phone_number)`.
Instagram users have **no phone** — they have an **IGSID**. So we generalize the customer
identifier:

Add columns:
```sql
channel      TEXT NOT NULL DEFAULT 'whatsapp'   -- 'whatsapp' | 'instagram'
external_id  TEXT                               -- per-channel customer id (phone for WA, IGSID for IG)
```

Migration steps (new file, e.g. `0NN_instagram_channel.sql`):
1. `ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp'` → existing rows auto-correct.
2. `ADD COLUMN external_id TEXT`; backfill `external_id = phone_number`.
3. `ALTER COLUMN phone_number DROP NOT NULL` (IG rows have none; WA rows keep it).
4. Drop `UNIQUE (tenant_id, phone_number)`; add `UNIQUE (tenant_id, channel, external_id)`.
5. Apply the same `channel` addition to the messages table (e.g. `whatsapp_messages`).

Resulting rows:

| tenant_id | channel | external_id | phone_number |
|---|---|---|---|
| glow-salon | whatsapp | +2348012345678 | +2348012345678 |
| glow-salon | instagram | 17841405793xxxx | *(null)* |

WhatsApp stays functionally untouched (defaults + backfill keep old rows and queries valid).

**Accepted tradeoff:** the table keeps the name `whatsapp_conversations` while holding IG rows —
a cosmetic naming wart, reversible later via Option C.

**Rejected alternatives:**
- **Option B (parallel `instagram_conversations` table):** duplicates schema/indexes/RLS and forks
  every code path; every future feature built twice.
- **Option C (unified `conversations` rebuild):** cleanest end state but touches and re-tests the
  entire working WhatsApp path at once. High risk, no near-term payoff. Deferred.

## 6. Architecture / data flow

```
IG DM ──► /api/webhooks/instagram ─┐
                                   ├─► normalize {tenant_id, channel, external_id, text}
WA msg ─► /api/webhooks/whatsapp ──┘                 │
                                                     ▼
                          SAME v2 pipeline (identityResolver*, slotEngine,
                          actionValidator, customerBooking, escalation)
                                                     │
                          provider selection by channel
                          ┌──────────────────────────┴──────────────────────────┐
                       WA adapter (to = phone)                 IG adapter (to = IGSID, IG Send API)
                                                     │
                                          tenant /chat inbox
                                        (WA badge / IG badge)
```

**Components & boundaries:**
- **`api/webhooks/instagram/route.ts`** — verifies the Meta signature, resolves the recipient IG
  account → tenant, normalizes the event, enqueues into the existing pipeline. Depends on: provider
  secrets, tenant lookup by IG account id.
- **IG provider adapter** (`src/lib/whatsapp/providers/instagram.ts`) — implements `sendText` /
  `sendMedia` against the IG Send API. The WhatsApp-only interface methods (QR, pairing, templates)
  are not part of the shared transport contract; generalize the interface to a minimal
  `ChannelClient { sendText, sendMedia }` that both WA and IG satisfy, keeping WA extras on the WA
  subtype.
- **`identityResolver`** — generalized to resolve by `(channel, external_id)` instead of phone. WA
  passes phone; IG passes IGSID. Owner/staff shortcut (`tenant_users.phone`) applies to WhatsApp
  only; on IG, inbound is always treated as a customer in v1.
- **Inbox (`/chat`)** — add a channel badge per thread; reply composer routes through the channel's
  adapter.

## 7. 24-hour window (honesty guardrail)

Instagram enforces a **24-hour messaging window**: the business may freely reply only within 24h of
the customer's last message (the human-agent tag extends this to 7 days; standard message tags are
limited and do not cover marketing/reminders).

**Implication:** Booka **cannot** send proactive reminders / no-show follow-ups / rebooking nudges
on Instagram the way WhatsApp templates allow.

**Behavior:**
- Inside 24h → agent replies normally.
- Outside 24h → no proactive IG send. Lifecycle messaging (reminders, recovery) is delivered via
  WhatsApp if the customer is reachable there; otherwise skipped. The agent should, during the IG
  conversation, capture WhatsApp/phone where appropriate to enable lifecycle messaging.

## 8. Marketing copy corrections (ride alongside the build)

Until IG ships, present-tense IG claims are untrue; after it ships, IG must not claim proactive
follow-up. Changes:
- `src/components/homepage/BookaLanding.tsx` — the "WhatsApp + Instagram" feature card currently
  implies IG follow-up ("keeps WhatsApp chats and Instagram DMs moving" + "follows up after
  no-shows"). Reframe IG as enquiry/capture; keep follow-up/recovery on WhatsApp.
- Channel-strategy section already says "Instagram fits best at the enquiry and lead-capture stage"
  — keep, it is accurate.
- `src/app/booka/page.tsx` + `src/app/layout.tsx` metadata — keep "WhatsApp + Instagram" only once
  IG is live; until then, soften to "WhatsApp (Instagram coming soon)" or WhatsApp-only.
- `src/app/page.tsx` featured card and hero — align to the same enquiry-vs-lifecycle framing.

(Exact final wording handled via the copywriting skill at implementation time.)

## 9. Meta setup guide

**One-time, Booka team (reuses the existing WhatsApp Meta app):**
1. Add the **Instagram** product. Use **"Instagram API with Instagram Login"** so tenants connect
   with just an IG professional account (avoids requiring a Facebook Page per tenant).
2. Configure webhook: callback `https://<domain>/api/webhooks/instagram`, verify token, subscribe to
   the `messages` field.
3. Request permissions: `instagram_business_basic` + `instagram_business_manage_messages` (exact
   scope names/Graph API version **to be confirmed against live Meta docs at build time** per the
   dependency-verification rule).
4. Set the OAuth redirect URI for the per-tenant connect flow.
5. Submit **App Review** (screencast: customer DMs a connected salon → agent replies). Business
   verification is likely already complete from WhatsApp.

**Per tenant (during onboarding, mirrors WhatsApp connect):**
1. Owner taps "Connect Instagram."
2. Meta OAuth → grants Booka access to the account's DMs.
3. Booka stores the token + IG account id, subscribes the account to the webhook.
4. Requirement on their side: IG must be a **Professional** account (free toggle, ~1 min).

## 10. Effort / timeline

**Engineering (~2.5–4 weeks focused):**

| Piece | Est. |
|---|---|
| Generalize identity + data model `(tenant_id, channel, external_id)` | 3–5 d |
| IG provider adapter + generalize provider interface | 2–3 d |
| IG webhook ingestion (verify, normalize → pipeline) | 2–3 d |
| IG OAuth connect flow + token storage + webhook subscribe | 3–4 d |
| Inbox channel badge + reply routing | 1–2 d |
| 24h-window guard + WhatsApp handoff | 1–2 d |
| Tests | 2–3 d |

**Meta App Review (calendar, parallel):** add IG product + config ≈ 1 d; business verification
likely done; App Review turnaround ~3 d–2 wk (may bounce once). Dev/testing possible against
role accounts before approval.

**Net: ~3–4 weeks to live**, gated by App Review + the identity refactor, not raw coding.

## 11. Testing strategy

- **Migration:** verify backfill (`external_id = phone_number`), nullable `phone_number`, new unique
  constraint; confirm existing WhatsApp queries unaffected.
- **identityResolver:** unit tests for `(whatsapp, phone)` and `(instagram, igsid)` resolution; WA
  owner/staff shortcut still works; IG inbound resolves as customer.
- **IG webhook:** signature verification (valid/invalid), recipient→tenant mapping, normalization
  shape matches pipeline input.
- **IG adapter:** `sendText`/`sendMedia` success + failure handling.
- **24h-window guard:** in-window send allowed; out-of-window proactive send blocked + WhatsApp
  handoff path.
- **Inbox:** mixed WA/IG threads render with correct badges; reply routes through correct channel.

## 12. Open items to confirm at build time

- Exact Meta permission scope names + Graph API version for the Instagram-Login path.
- IG Send API request/response shape and media constraints.
- Webhook payload field path for recipient IG account id (for tenant mapping).
- Whether the messages table is `whatsapp_messages` (confirm name before migration).
