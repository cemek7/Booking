# Deliverability & Reputation — Design Spec

**Date:** 2026-06-22
**Status:** Approved (design) — pending implementation plan
**Scope:** Spec 4 of the "WhatsApp Trust" program (Spec 1 Identity & Branding ✅, Spec 2 Tenant Off-boarding ✅).
**Addresses:** Landmine #2 (shared-number reputation) + full opt-out/compliance.

## Problem

Boka routes many tenants through a **single shared Meta WhatsApp Business number** (via routing codes). On the Meta WhatsApp Cloud API, two critical resources are **communal to that number**, not per-tenant:

1. **Quality rating** (green / yellow / red) — driven by user blocks and "report spam". A red rating throttles then disables the number.
2. **Messaging limit** (tiered unique-recipient cap per rolling 24h: 250 / 1K / 10K / 100K / unlimited).

So one tenant's spammy or non-compliant sending can **throttle or ban the number for every tenant on it.** Two concrete, present-day risks:

- **Active policy violation:** `waitlist.ts` and the cron rebooking follow-up/nudge sends (`api/cron/nightly/route.ts`) send **free-form business-initiated messages**. On Meta, a business-initiated message **outside the 24-hour customer-service window** MUST be a pre-approved **template**; free-form there is a policy violation that drives blocks/reports → quality drop → ban.
- **No reputation defense:** there is no per-tenant send accounting, no risk scoring, no quarantine, and we do not ingest Meta's quality/limit webhooks, so a degrading number is invisible until it is disabled.

### Current state (verified against code)

- Meta provider already supports `sendTemplateMessage` (`providers/meta.ts:100`). ✅
- The 24h-window signal `last_inbound_at` and `opted_out_at` already exist on `whatsapp_conversations` (added in Spec 1). ✅
- Spec 1 built minimal STOP/START (`optOut.ts`: `detectOptOutKeyword`, `isOptedOut`). ✅
- `whatsapp_connection_metrics` tracks `messages_sent_today`, `uptime_percentage`, `error_count_24h` (per connection, not per-tenant-on-shared-number).
- **Gaps:** no template-vs-window routing, no per-tenant messaging stats / risk score, no quota allocation, no quarantine, no Meta quality/limit webhook ingestion, no graduation advisor.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Primary risk | **Shared-number ban risk** — protect the communal quality rating + 24h limit. |
| Shared-number role | **Hybrid** — tenants coexist on the shared number with per-tenant quotas, AND high-volume/high-risk tenants graduate to dedicated numbers. |
| Risk signals | **All four:** send volume/velocity, cold-outbound ratio, opt-out rate, delivery-failure rate. |
| Enforcement | **Auto throttle + auto quarantine on the shared number; migration is human-approved** (auto-provisioning a number is itself a ban/verification/cost risk). |
| Compliance rule | **Never free-form outside the 24h window.** Outside the window, business-initiated sends require an approved template or are **held** (skipped), never downgraded to free-form. |

## Architecture

Every **business-initiated** send (waitlist slot-opened, rebooking follow-up, rebooking nudge, and any `brandCustomerText({ initiated: true })`) passes a 3-stage gate. **Replies** (`initiated: false`) within the 24h window are always allowed and only counted.

```
business-initiated send
   │
   ├─ 1. Governor (risk + quota)   → allow | throttle(defer) | quarantine(skip)
   ├─ 2. Compliance gate (window)  → freeform | template | hold
   └─ 3. Send + record stats (sent / cold_outbound / failure)
```

### Unit 1 — Compliance gate: `metaSendGate.ts`

Pure decision function (no I/O), unit-testable in isolation.

```ts
type SendMode = 'freeform' | 'template' | 'hold';
interface GateInput {
  initiated: boolean;
  lastInboundAt: string | null;   // from whatsapp_conversations
  optedOutAt: string | null;
  messageType: MessageType;       // 'reply' | 'rebooking_followup' | 'rebooking_nudge' | 'waitlist_slot' | ...
  template?: { name: string; language: string } | null; // resolved by caller from the registry
  now?: number;
}
interface GateDecision { mode: SendMode; templateName?: string; language?: string; reason: string; }

function decideSend(input: GateInput): GateDecision;
```

Rules (in order):
1. `initiated && optedOutAt` → **hold** (`reason: 'opted_out'`).
2. `!initiated` (reply) → **freeform** (Meta allows free-form within the 24h service window; replies are inside it by definition).
3. `initiated && withinWindow(lastInboundAt, 24h)` → **freeform**.
4. `initiated && !withinWindow` → if `template` provided → **template**; else → **hold** (`reason: 'no_template_outside_window'`).

`WINDOW_MS = 24*60*60*1000` (env-tunable `META_SERVICE_WINDOW_HOURS`, default 24).

> **Two correctness notes:**
> - **Consent model:** the gate uses `last_inbound_at` (the customer messaged/booked this tenant) as
>   *implicit* opt-in and `opted_out_at` (STOP) as the override. Capturing *explicit* opt-in checkboxes is
>   out of scope here (it lives with the booking-form opt-in work); for v1, "previously transacted with this
>   tenant" is the opt-in basis, plus a valid template outside the window.
> - **Per-tenant window ⊆ Meta's per-number window (safe by construction):** our `last_inbound_at` is keyed
>   per `(customer, tenant)`, while Meta's 24h window is per `(number, customer)`. On the shared number a
>   customer who messaged tenant A also opens Meta's window for the number — but our gate still treats a
>   send from tenant B (whom they never messaged) as *outside* window → template required. So our rule is
>   always **stricter-or-equal** to Meta's, which is the correct direction and also prevents the
>   cross-tenant "who is this?" leak.

### Unit 2 — Template registry: `message_templates` table + `templateRegistry.ts`

Maps an internal `message_type` to the WABA's approved template. Platform-level (the shared number's WABA approves templates once); a `tenant_id IS NULL` row is the platform default, with optional per-tenant overrides for graduated tenants on their own WABA.

```
message_templates
  id            UUID PK
  tenant_id     UUID NULL          -- NULL = platform/shared-number default
  message_type  TEXT               -- 'rebooking_followup' | 'rebooking_nudge' | 'waitlist_slot' | ...
  template_name TEXT
  language      TEXT DEFAULT 'en'
  param_mapping JSONB              -- ordered list describing how to fill template {{1}},{{2}} from context
  status        TEXT               -- 'approved' | 'pending' | 'rejected' | 'paused' (synced from webhook)
  created_at / updated_at TIMESTAMPTZ
  UNIQUE (COALESCE(tenant_id,'00000000-…'), message_type, language)
```

`resolveTemplate(admin, tenantId, messageType, language)` → returns an `approved` template (tenant override first, else platform default), or `null`. The gate treats `null` as "hold outside window".

> **Provider interface (verified):** `MetaAdapter.sendTemplateMessage(to, templateName, parameters?: Array<{default: string}>)` currently **hardcodes `language: { code: 'en_US' }`**. So `param_mapping` must produce an **ordered `Array<{default: string}>`** for the body `{{1}}..{{n}}`, and the plan must either (a) thread `language` through `sendTemplateMessage` (small provider change) or (b) constrain v1 to `en_US` and store `language='en_US'` in the registry. Lean: thread `language` through — it's a one-line provider change and avoids a hidden constraint.

### Unit 3 — Send governor: `tenant_messaging_stats` + `sendGovernor.ts`

Per-tenant fixed-window 24h accounting and risk decision.

```
tenant_messaging_stats
  tenant_id        UUID PK
  window_start     TIMESTAMPTZ        -- start of the current 24h accounting window (see note)
  sent_24h         INT DEFAULT 0       -- total messages (velocity)
  initiated_24h    INT DEFAULT 0       -- business-initiated messages (velocity)
  initiated_recipients_24h INT DEFAULT 0  -- UNIQUE business-initiated recipients (the limit unit)
  recipients_seen  JSONB DEFAULT '[]'  -- distinct recipient hashes this window, to dedupe the count
  cold_outbound_24h INT DEFAULT 0      -- initiated template sends to non-engaged (out-of-window) recipients
  opt_outs_24h     INT DEFAULT 0
  failures_24h     INT DEFAULT 0
  risk_score       NUMERIC DEFAULT 0   -- 0..1
  quarantined_until TIMESTAMPTZ NULL
  updated_at       TIMESTAMPTZ
```

> **Window note (honest about the approximation):** Meta enforces a *true rolling* 24h. v1 uses a
> **fixed window** that resets when `now - window_start ≥ 24h` (simpler, no per-event log). This can permit
> a ~2× burst across a reset boundary; we mitigate by setting `tenantWeight` conservatively (well under the
> per-number tier). A true sliding-window counter is a documented v2 upgrade. `recipients_seen` is bounded
> (hashed phone, capped) and cleared on window reset.

`risk_score` = weighted blend (weights env-tunable), each component **explicitly scaled to 0..1** so that
small-but-dangerous rates register (a raw 2% opt-out rate must read as "high", not 0.02):
- `volumeScore` = `min(1, initiated_recipients_24h / tenantAllocation)`  ← unique recipients, the limit unit
- `coldScore` = `cold_outbound_24h / max(initiated_24h, 1)` (already 0..1)
- `optOutScore` = `min(1, optOutRate / OPT_OUT_DANGER)` where `optOutRate = opt_outs_24h / max(sent_24h,1)`, `OPT_OUT_DANGER = 0.02` (2% ⇒ 1.0)
- `failureScore` = `min(1, failureRate / FAILURE_DANGER)` where `failureRate = failures_24h / max(sent_24h,1)`, `FAILURE_DANGER = 0.05` (5% ⇒ 1.0)

`evaluateSend(admin, tenantId, numberQuality)` → `{ allow, throttleDelayMs?, quarantine?, reason }`:
- If `quarantined_until > now` → `allow:false, reason:'quarantined'` (initiated only; replies bypass the governor).
- Compute `tenantAllocation` = `numberLimitPer24h × qualityFactor × tenantWeight` (see Unit 4), where `numberLimitPer24h` is Meta's **unique-recipient** tier limit. A send is allowed against allocation when the recipient is **already counted this window** (`recipients_seen` contains it — a follow-up message to someone you've already initiated to, costs no new recipient) OR `initiated_recipients_24h < tenantAllocation`. Otherwise → `allow:false, reason:'allocation_exhausted'`. **Overflow handling (no queue):** the cron rebooking/nudge sends already self-retry on their next nightly run (throttled by their existing `metadata` sent-at keys), so a skipped night is naturally re-attempted. The real-time **waitlist** notification is best-effort — overflow is **dropped with a logged skip** (acceptable: a waitlist ping is non-critical and the customer can still book). No new retry queue is introduced.
- If `risk_score ≥ QUARANTINE_THRESHOLD` → set `quarantined_until = now + QUARANTINE_HOURS`, `allow:false, reason:'risk_quarantine'`.
- Else `allow:true` (with an optional small `throttleDelayMs` pacing when near allocation).

Counters are incremented after each send via `recordSend(admin, tenantId, {kind, recipient, cold, failed})`: it bumps `sent_24h`/`initiated_24h`, and bumps `initiated_recipients_24h` **only when `recipient` is new** to `recipients_seen` this window. The fixed window resets (`recipients_seen → []`, counters → 0) when `now - window_start ≥ 24h`.

### Unit 4 — Meta quality/limit webhooks: `whatsapp_number_quality` + `metaQualityWebhook.ts`

New webhook field handlers (mounted in the existing Meta webhook route) for:
- `phone_number_quality_update` → `quality_rating` (GREEN/YELLOW/RED)
- `messaging_limit_update` / tier changes → `messaging_tier`, `limit_per_24h`
- `account_update` (e.g. account_review/restriction) → `account_status`
- `message_template_status_update` → updates `message_templates.status`

```
whatsapp_number_quality
  phone_number_id  TEXT PK          -- the Meta phone_number_id; for the SHARED number this is
                                    -- process.env.WHATSAPP_PHONE_NUMBER_ID (the default/platform Meta
                                    -- number is env-configured via providerSelection, NOT a
                                    -- whatsapp_configurations row). Dedicated tenants key on their
                                    -- own whatsapp_configurations.meta_phone_number_id.
  quality_rating   TEXT             -- 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  messaging_tier   TEXT             -- 'TIER_250' | 'TIER_1K' | 'TIER_10K' | 'TIER_100K' | 'TIER_UNLIMITED'
  limit_per_24h    INT
  account_status   TEXT NULL
  updated_at       TIMESTAMPTZ
```

> **Shared-number model (verified):** the shared number is the platform Meta number from
> `WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN` env (`providerSelection.buildDefaultWhatsAppProviderConfig`).
> Inbound is attributed to a tenant by **routing code** (`identityResolver.resolveIncoming`) at
> `/api/webhooks/whatsapp`. Per-tenant routing-code tenants all share this one number's quality + limit —
> which is exactly why the communal-reputation risk exists. Dedicated tenants have their own
> `whatsapp_configurations` row + number (isolated reputation).

**Quality response** (two distinct levers, so RED doesn't accidentally block safe in-window traffic):
- `qualityFactor` scales the **allocation** only: GREEN → 1.0, YELLOW → 0.5 (halve, pre-emptive), RED → 0.25.
- A separate **cold-send hold** keys off RED: when `quality_rating = 'RED'`, the governor holds **cold** initiated sends (no inbound in window) regardless of allocation, and auto-quarantines the top-risk tenants — while **in-window replies and already-engaged (within-24h) conversations keep flowing**. Free-form replies are never blocked by quality.

This is the early-warning that converts a yellow rating into corrective throttling **before** it goes red/banned, without choking the legitimate in-window traffic that actually rebuilds quality.

### Unit 5 — Graduation advisor: `graduationAdvisor.ts` (nightly)

Threshold check in the nightly cron: a tenant with sustained `initiated_24h ≥ GRADUATION_INITIATED_PER_DAY` over `GRADUATION_SUSTAINED_DAYS`, or repeatedly hitting allocation/quarantine, → emit a **superadmin alert** (`telegramAlert`) + record a `graduation_recommended` row (reuse `notifications` or a small table). Migration to a dedicated number remains the existing human-approved connect flow — **no auto-provisioning.**

### Integration at the chokepoint

The business-initiated send path is centralized. Today `brandCustomerText({ initiated: true })` is the seam (Spec 1) used by `waitlist.ts` and the cron rebooking sends. Spec 4 inserts the gate **inside that initiated path** (or a thin `sendGovernedInitiated()` wrapper around it):

```
sendGovernedInitiated(admin, tenantId, conv, messageType, buildFreeform, ctx):
  numberQuality ← loadNumberQuality()
  gov ← sendGovernor.evaluateSend(tenantId, numberQuality)
  if !gov.allow: record skip(reason); return null            // throttled/quarantined/allocation
  tmpl ← templateRegistry.resolveTemplate(tenantId, messageType)
  decision ← metaSendGate.decideSend({ initiated:true, lastInboundAt, optedOutAt, messageType, template: tmpl })
  switch decision.mode:
    'hold'     → record skip(reason); return null
    'freeform' → text ← buildFreeform(); send free-form; recordSend(kind:initiated, cold)
    'template' → send template(decision.templateName, params from param_mapping); recordSend(kind:initiated, cold)
```

Replies (`initiated:false`) keep their current path; we only add `recordSend(kind:reply)` for accounting. Evolution/WAHA tenants (non-Meta) **bypass** the Meta gate (window/template rules are Meta-specific) but still get governor accounting + opt-out enforcement.

## Configuration (defaults; confirm in plan)

- `META_SERVICE_WINDOW_HOURS` = 24
- `RISK_WEIGHTS` = volume .35 / cold .30 / optOut .20 / failure .15
- `OPT_OUT_DANGER` = 0.02 (2% opt-out ⇒ score 1.0), `FAILURE_DANGER` = 0.05 (5% failure ⇒ 1.0)
- `QUARANTINE_THRESHOLD` = 0.8, `QUARANTINE_HOURS` = 24
- `QUALITY_FACTOR` = GREEN 1.0 / YELLOW 0.5 / RED 0.0-for-cold
- `TENANT_WEIGHT` = equal share by default (active tenants on the number); plan may make it plan-tier-weighted
- `GRADUATION_INITIATED_PER_DAY` = 500, `GRADUATION_SUSTAINED_DAYS` = 3

## Error handling & testing

- **Fail-safe direction:** unlike the off-boarding gate (fail-open), the compliance gate **fails closed for cold initiated sends** — if window/template state can't be resolved, **hold** rather than risk a violation. Governor/accounting failures fail-open (don't block legitimate replies).
- **Idempotency:** `recordSend` increments are safe to retry; webhook ingestion is upsert-by-`phone_number_id` / template key.
- **Tests:** gate decision matrix (opted-out / reply / in-window / out-of-window×template-present/absent); risk-score math; allocation + quarantine transitions; qualityFactor tightening (yellow halves, red holds cold); webhook upserts (quality/limit/template-status); graduation threshold; non-Meta bypass. Reuse the queue-based Supabase mock from the v2/offboarding tests.

## Open items for the plan

- Exact Meta webhook payload shapes for each field (verify against current Graph API version) and where to mount them in the existing Meta webhook route.
- Whether `tenant_messaging_stats` 24h buckets are rolling-reset in `recordSend` or swept by the nightly cron (lean: reset-on-write + nightly safety sweep).
- Param-mapping format for templates (ordered positional `{{1}}..{{n}}` from a named context).
- Shared-number `phone_number_id` source is **env `WHATSAPP_PHONE_NUMBER_ID`** (verified); the plan must read it from there for the shared path and from `whatsapp_configurations.meta_phone_number_id` only for dedicated tenants.
- Seed/registration path for the initial approved templates (rebooking_followup, rebooking_nudge, waitlist_slot).

## Non-goals

- Auto-provisioning / auto-migration of dedicated numbers (human-approved only).
- Template **authoring/submission** UI to Meta (templates are created in Meta Business Manager; we only map + track status).
- Per-message Meta conversation-category billing optimization.
- Reputation modeling for Evolution/WAHA beyond accounting + opt-out (no quality API there).
