# WhatsApp Brand Identity & Assistant Disclosure — Design Spec

**Date:** 2026-06-08
**Status:** Approved design, ready for implementation plan
**Scope:** Spec 1 of the "WhatsApp Trust" program (see appendix for the full roadmap)
**Addresses:** Landmine #1 (tenant identity drift), Landmine #7 (assistant identity / "who am I talking to?"), plus minimal opt-out (subset of Landmine #2) required to honor the footer.

---

## 1. Problem

Boka's v2 WhatsApp replies go out as **anonymous text**. A returning customer who gets a reminder months later cannot tell who is messaging them — the classic "Time for your next haircut?" → "Who is this?" failure. Two specific risks:

- **Identity drift (#1):** when a tenant renames (e.g. "Chris Barbershop" → "Chris Grooming Lounge"), customers who knew the old name no longer recognize the sender.
- **Assistant disclosure (#7):** customers assume they're texting a human ("can I come late, my son is sick") and lose trust when replies feel robotic — or, worse, are misled about talking to a person.

Booka must stay **invisible infrastructure**: the tenant owns the customer relationship; Booka never appears in customer-facing text.

### Current state (verified against code)

- Identity is the bare `tenants.name`. No `display_name`, `brand_emoji`, or `previous_names`.
- No customer-facing identity framing exists anywhere.
- The AI self-framing line `"You are a booking assistant for ${tenant.name}"` (`pipeline.ts:433`) is **internal prompt only** — never surfaced to the customer.
- Outbound chokepoints: `sendReplyAndPersistOutbound` (`pipeline.ts:512`, main path), `waitlist.ts:111`, and the cron rebooking sender (`api/cron/nightly/route.ts` Tasks 2/3).
- Architecture is already **hybrid**: shared Booka number (`/api/webhooks/whatsapp`, routing codes via `identityResolver.ts`) AND dedicated per-tenant numbers (`/api/webhooks/whatsapp/[tenantId]`, WAHA/Meta via the `connect` route).

---

## 2. Design decisions (locked)

| Decision | Choice |
|---|---|
| Identity treatment | **Brand-forward header + one-time bot-disclosure footer.** Booka invisible. |
| Header frequency | **Session-open** (gap > 30 min) **+ all business-initiated** messages. Suppressed mid-conversation. Footer rides with the header. |
| Number-type behavior | **Uniform.** Header is harmless on dedicated numbers (reinforces the profile name); avoids a second code path. |
| Identity drift | **Per-customer staleness.** "(formerly X)" shown only to customers whose last interaction predates the rename. |
| Brand source | **New owner-editable `display_name` + `brand_emoji`**, separate from the account `name`. `display_name` falls back to `name`; emoji vertical-defaulted, optional. |
| Opt-out | **Minimal STOP/START.** Honors the footer promise; blocks initiated sends only. |

### Rendered example

```
Chris Grooming Lounge ✂️
(formerly Chris Barbershop)
Hi John, time for your next cut?
— automated assistant · reply STOP to opt out
```

- Line 1 — header: `display_name` + `brand_emoji`. Shown on session-open + initiated only.
- Line 2 — "formerly": only if this customer's `last_inbound_at` predates the latest rename.
- Body — AI-generated, unchanged.
- Footer — bot disclosure + opt-out. Rides with the header (→ "once per session" for free).

---

## 3. Data model — migration `070_tenant_brand_identity.sql`

```sql
-- SAFE: ADD COLUMN only. No renames, drops, or retypes.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS display_name   TEXT,                       -- customer-facing; falls back to name
  ADD COLUMN IF NOT EXISTS brand_emoji    TEXT,                       -- optional
  ADD COLUMN IF NOT EXISTS previous_names JSONB DEFAULT '[]'::jsonb,  -- [{ name, renamed_at }]
  ADD COLUMN IF NOT EXISTS renamed_at     TIMESTAMPTZ;                -- timestamp of latest rename

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ,               -- powers session-gap + drift checks
  ADD COLUMN IF NOT EXISTS opted_out_at    TIMESTAMPTZ;               -- minimal STOP flag (NULL = subscribed)

-- Backfill (idempotent)
UPDATE whatsapp_conversations
   SET last_inbound_at = updated_at
 WHERE last_inbound_at IS NULL;
```

**Pre-flight check (per migration rules):** confirm `whatsapp_conversations` and `tenants` exist before running; both are referenced in current code (`identityResolver.ts`), so they do. Provide a manual SQL fallback identical to the above for production.

`last_inbound_at` does double duty:
1. **Session-gap** (header rule): `now − last_inbound_at > 30 min`.
2. **Drift staleness**: `last_inbound_at < renamed_at`.

Both read the value **captured at handler entry, before** it is updated for the current inbound message.

---

## 4. Core unit — `src/lib/whatsapp/v2/brandIdentity.ts`

One purpose: turn `(tenant, conversation, context)` into a branded outbound string. Pure and unit-testable in isolation.

```ts
export type BrandContext = {
  displayName: string;       // tenant.display_name ?? tenant.name
  emoji: string | null;      // tenant.brand_emoji
  previousName: string | null; // set only when customer predates latest rename
  stampHeader: boolean;      // header + footer applied this message?
};

export type ResolveOpts = {
  initiated: boolean;        // business-initiated (reminder/nudge/waitlist) vs reply-to-inbound
  now: Date;
  sessionGapMs?: number;     // default 30 * 60 * 1000
};

// Decides what identity treatment this message gets.
export function resolveBrandContext(
  tenant: TenantBrandFields,
  conv: ConversationBrandFields,
  opts: ResolveOpts
): BrandContext;

// Composes header + (formerly) + body + footer. Idempotent.
export function applyBrandIdentity(reply: string, ctx: BrandContext): string;
```

**`resolveBrandContext` rules:**
- `displayName = tenant.display_name ?? tenant.name`
- `emoji = tenant.brand_emoji ?? null`
- `stampHeader = opts.initiated || (now − conv.last_inbound_at > sessionGap)`. If `last_inbound_at` is null (first ever contact), treat as session-open → `true`.
- `previousName`: the `name` of the most-recent `previous_names` entry, **only if** `tenant.renamed_at` is set **and** `conv.last_inbound_at < tenant.renamed_at`. Otherwise null.

**`applyBrandIdentity` rules:**
- If `!ctx.stampHeader` → return `reply` unchanged.
- Else compose:
  - Header: `*{displayName}*` + (emoji ? ` {emoji}` : ``)
  - Optional `(formerly {previousName})` line when `previousName` set.
  - Blank line, then `reply`.
  - Footer line: `— automated assistant · reply STOP to opt out`.
- **Idempotent:** if `reply` already begins with the composed header, return as-is (guard against double-stamping / retries).

The header is applied to the **final** outbound text, after AI generation and after slot/quick-reply parsing — it never interferes with parsing.

---

## 5. Minimal opt-out — `src/lib/whatsapp/v2/optOut.ts`

Required because the footer promises "reply STOP to opt out." Scoped to the minimum that makes the promise honest; full reputation/deliverability is Spec 4.

```ts
export function detectOptOutKeyword(text: string): 'stop' | 'start' | null;
//  STOP | UNSUBSCRIBE | STOPP            → 'stop'   (case-insensitive, trimmed, exact-word)
//  START | RESUME | UNSTOP               → 'start'
//  else                                  → null

export function isOptedOut(conv: ConversationOptOutFields): boolean; // opted_out_at != null
```

**Inbound handling** (early in the pipeline, before AI):
- `'stop'` → set `opted_out_at = now()`; send one-time confirmation: `"You're unsubscribed from reminders. Reply START to resume."`; stop further processing.
- `'start'` → clear `opted_out_at`; send `"You're resubscribed. 👍"`; stop further processing.

**Outbound suppression:**
- `initiated === true` sends (reminders, nudges, waitlist) check `isOptedOut(conv)` and **skip** if opted out.
- Reply-to-inbound (`initiated === false`) is **never** suppressed — the customer chose to message; we always answer. STOP blocks *us reaching out*, not *them reaching us*.

---

## 6. Wiring — the three outbound paths

A single internal seam composes brand + checks opt-out, so each call site changes minimally. Suggested shape: extend the existing send helper(s) to accept `{ initiated }` and run `resolveBrandContext` → (opt-out gate if initiated) → `applyBrandIdentity` → send.

| Path | File | `initiated` |
|---|---|---|
| Main reply | `pipeline.ts:512` `sendReplyAndPersistOutbound` | `false` (header still fires on session-open) |
| Waitlist notify | `waitlist.ts:111` | `true` |
| Rebooking follow-up / nudge | `api/cron/nightly/route.ts` Tasks 2/3 | `true` |

`last_inbound_at` update: on each **inbound** message, after `resolveBrandContext` has read the prior value, update `whatsapp_conversations.last_inbound_at = now()`. The read-before-write ordering is essential for both the session-gap and drift checks to be correct.

---

## 7. Owner configuration & rename handling

- **Onboarding** (`ownerOnboarding.ts`): capture `display_name` (prefilled with `name`) and `brand_emoji` (auto-suggested from `vertical`: ✂️ barber, 💇 salon, 💆 spa, 🦷 dental; owner can override or clear).
- **Rename helper** `renameTenantBrand(tenantId, newDisplayName)`:
  - Read current `display_name` (or `name` if unset).
  - Push `{ name: <current>, renamed_at: now() }` onto `previous_names`.
  - Set `display_name = newDisplayName`, `renamed_at = now()`.
  - Wired into the existing tenant-settings update path (`api/admin/tenant/[id]/settings`).

---

## 8. Edge cases

- `display_name` unset → use `name`.
- `brand_emoji` unset → omit cleanly (no trailing space, no broken glyph).
- `previous_names` empty / `renamed_at` null → never show "formerly".
- Multiple renames → newest `previous_names` entry is the "formerly" label; staleness still compares against `renamed_at` (latest).
- Retry / duplicate send → `applyBrandIdentity` idempotency guard prevents double headers.
- Dedicated vs shared number → identical behavior; header simply reinforces the profile name.
- Opted-out customer sends a normal booking message → still answered (inbound), header/footer rules unchanged.
- First-ever contact (`last_inbound_at` null) → treated as session-open (header shown).

---

## 9. Testing

**Unit — `brandIdentity.test.ts`:**
- `resolveBrandContext`: session-open vs mid-conversation; `initiated` true/false; drift stale vs fresh customer; missing emoji; missing `display_name`; null `last_inbound_at`; multiple renames.
- `applyBrandIdentity`: full composition; emoji omitted; "formerly" present/absent; idempotency on re-apply; `stampHeader=false` passthrough.

**Unit — `optOut.test.ts`:**
- `detectOptOutKeyword`: STOP/UNSUBSCRIBE/START/RESUME variants, case/whitespace, non-keyword passthrough (e.g. "stop by at 5" must NOT match — exact-word only).
- `isOptedOut`: flag set/unset.

**Integration:**
- Outbound chokepoint stamps header on session-open, suppresses mid-conversation.
- `initiated` send skipped when opted out; inbound reply still sent when opted out.
- `last_inbound_at` read-before-write ordering produces correct session-gap + drift results.

---

## 10. Out of scope (YAGNI)

- Dedicated-number provisioning (already exists).
- `legal_name`, `brand_tagline` columns.
- Full reputation / spam scoring / throttling (Spec 4).
- Pricing tiers, marketplace features.

---

## Appendix — WhatsApp Trust program roadmap

This spec is #1 of a decomposed program. Each sibling gets its own spec → plan → build cycle. Verified status as of 2026-06-08:

| Spec | Covers | State | Notes |
|---|---|---|---|
| **1. Identity & Branding** *(this doc)* | #1, #7, minimal #2 | designing → build | — |
| **2. Tenant Lifecycle & Exit** | #6 + `terminated` half of #10 | **real gap** | `tenants` has only `v2_enabled`; no status/grace/ghost-conv/export. "Solve before launch." |
| **3. Returning-Customer Context Recall** | #12 + #4 multi-tenant disambiguation | partial | `last_visit`/`total_bookings` + "Welcome back" exist; no last-service/preferred-staff recall. Builds on Spec 1. |
| **4. Deliverability & Reputation** | #2 + full STOP/opt-out | **real gap** | No reputation/spam tracking. Extends Spec 1's minimal opt-out. |
| **5. Per-Tenant Wallet & Cost Caps** | #11 | partial | Strong LLM infra (`llmQuota`, `llmUsageTracker`, `llmAlertService`); quota is by model tier, not per-tenant budget. |
| **— Marketplace-avoidance guardrail** | #8 | principle doc | One page; "don't build find-salons-near-me." No code. |

**Already solved (no spec):** #9 (AI proposes / backend validates — `actionValidator.ts`), #5 (re-engagement cadence — `rebooking_interval_days` + cron nudges).
