# Deliverability & Reputation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop any single tenant on the shared Meta number from tanking its communal quality rating or 24h messaging limit, by gating every business-initiated send through a risk/quota governor + a 24h-window/template compliance gate, fed by Meta quality webhooks.

**Architecture:** A 3-stage path for business-initiated sends — `sendGovernor` (risk + unique-recipient quota) → `metaSendGate` (24h window → freeform/template/hold) → send + record stats. Meta quality/limit webhooks update a `whatsapp_number_quality` row that tightens allocations (YELLOW halves, RED holds cold sends). A nightly advisor alerts a superadmin to graduate high-volume tenants. Replies within the 24h window are untouched (only counted).

**Tech Stack:** Next.js 16, TypeScript, Supabase (admin client), Jest with the queue-based Supabase mock from the v2/offboarding tests.

**Source spec:** `docs/superpowers/specs/2026-06-22-deliverability-reputation-design.md`

---

## Collision discipline (read first)

Build in an **isolated worktree** (via `superpowers:using-git-worktrees`) off the current `feat/instagram-channel` tip. Hazards:
- Shared files touched: `src/lib/whatsapp/providers/meta.ts` (Task 6), `src/lib/whatsapp/v2/outboundBranding.ts` + `waitlist.ts` + `src/app/api/cron/nightly/route.ts` (Task 9/10), `src/app/api/webhooks/whatsapp/meta/route.ts` (Task 11). Each gets one minimal, additive touch; stage ONLY the named files, never `git add -A`.
- New code lives under `src/lib/whatsapp/v2/deliverability/` — collision-free.
- All PostgREST lookups from external values use `.eq()`/`.ilike()`, never `.or()` interpolation.

## Configuration (env defaults — build with these)

`META_SERVICE_WINDOW_HOURS=24`; `RISK_W_VOLUME=0.35 RISK_W_COLD=0.30 RISK_W_OPTOUT=0.20 RISK_W_FAILURE=0.15`; `OPT_OUT_DANGER=0.02`; `FAILURE_DANGER=0.05`; `QUARANTINE_THRESHOLD=0.8`; `QUARANTINE_HOURS=24`; `QUALITY_FACTOR_GREEN=1.0 QUALITY_FACTOR_YELLOW=0.5 QUALITY_FACTOR_RED=0.25`; `TENANT_WEIGHT_DEFAULT=0.05`; `GRADUATION_INITIATED_PER_DAY=500 GRADUATION_SUSTAINED_DAYS=3`. Shared number id = `WHATSAPP_PHONE_NUMBER_ID`.

## File structure

| File | Responsibility |
|------|----------------|
| `db/migrations/091_deliverability_reputation.sql` | `message_templates`, `tenant_messaging_stats`, `whatsapp_number_quality` |
| `src/lib/whatsapp/v2/deliverability/config.ts` | env-tunable constants |
| `src/lib/whatsapp/v2/deliverability/metaSendGate.ts` | pure `decideSend()` (window→freeform/template/hold) |
| `src/lib/whatsapp/v2/deliverability/templateRegistry.ts` | `resolveTemplate()` |
| `src/lib/whatsapp/v2/deliverability/numberQuality.ts` | `loadNumberQuality()`, `qualityFactor()` |
| `src/lib/whatsapp/v2/deliverability/riskScore.ts` | pure `computeRiskScore()` |
| `src/lib/whatsapp/v2/deliverability/sendGovernor.ts` | `evaluateSend()`, `recordSend()` |
| `src/lib/whatsapp/v2/deliverability/governedSend.ts` | `sendGovernedInitiated()` orchestration |
| `src/lib/whatsapp/v2/deliverability/metaQualityWebhook.ts` | `ingestQualityWebhook()` |
| `src/lib/whatsapp/v2/deliverability/graduationAdvisor.ts` | `runGraduationAdvisor()` |
| `src/lib/whatsapp/providers/meta.ts` | thread `language` through `sendTemplateMessage` |
| `outboundBranding.ts` / `waitlist.ts` / `cron/nightly/route.ts` | route initiated sends through `sendGovernedInitiated` |
| `webhooks/whatsapp/meta/route.ts` | dispatch quality fields to `ingestQualityWebhook` |

---

## Task 1: Schema — three tables

**Files:** Create `db/migrations/091_deliverability_reputation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 091_deliverability_reputation.sql
-- SAFE: CREATE TABLE IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS message_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID,                         -- NULL = platform/shared-number default
  message_type  TEXT NOT NULL,                -- 'rebooking_followup' | 'rebooking_nudge' | 'waitlist_slot'
  template_name TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'en_US',
  param_mapping JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ordered param descriptors for {{1}}..{{n}}
  status        TEXT NOT NULL DEFAULT 'pending',     -- 'approved'|'pending'|'rejected'|'paused'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_key
  ON message_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), message_type, language);

CREATE TABLE IF NOT EXISTS tenant_messaging_stats (
  tenant_id                UUID PRIMARY KEY,
  window_start             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_24h                 INT NOT NULL DEFAULT 0,
  initiated_24h            INT NOT NULL DEFAULT 0,
  initiated_recipients_24h INT NOT NULL DEFAULT 0,
  recipients_seen          JSONB NOT NULL DEFAULT '[]'::jsonb,
  cold_outbound_24h        INT NOT NULL DEFAULT 0,
  opt_outs_24h             INT NOT NULL DEFAULT 0,
  failures_24h             INT NOT NULL DEFAULT 0,
  risk_score               NUMERIC NOT NULL DEFAULT 0,
  quarantined_until        TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_number_quality (
  phone_number_id TEXT PRIMARY KEY,           -- shared = env WHATSAPP_PHONE_NUMBER_ID
  quality_rating  TEXT NOT NULL DEFAULT 'UNKNOWN',  -- GREEN|YELLOW|RED|UNKNOWN
  messaging_tier  TEXT,
  limit_per_24h   INT NOT NULL DEFAULT 1000,
  account_status  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Apply + idempotency check**

Run: `psql $DATABASE_URL -f db/migrations/091_deliverability_reputation.sql` (re-run once; all `IF NOT EXISTS`).

- [ ] **Step 3: Commit** — `git add db/migrations/091_deliverability_reputation.sql && git commit -m "feat(deliverability): message_templates + tenant_messaging_stats + number_quality"`

---

## Task 2: Config constants

**Files:** Create `src/lib/whatsapp/v2/deliverability/config.ts`; Test `src/__tests__/lib/whatsapp/v2/deliverability/config.test.ts`

- [ ] **Step 1: Failing test**
```typescript
import { CFG } from '@/lib/whatsapp/v2/deliverability/config';
describe('deliverability config', () => {
  it('exposes window + danger + quarantine defaults', () => {
    expect(CFG.windowMs()).toBe(24 * 60 * 60 * 1000);
    expect(CFG.optOutDanger()).toBeCloseTo(0.02);
    expect(CFG.failureDanger()).toBeCloseTo(0.05);
    expect(CFG.quarantineThreshold()).toBeCloseTo(0.8);
  });
  it('maps quality to allocation factor', () => {
    expect(CFG.qualityFactor('GREEN')).toBe(1.0);
    expect(CFG.qualityFactor('YELLOW')).toBe(0.5);
    expect(CFG.qualityFactor('RED')).toBe(0.25);
    expect(CFG.qualityFactor('UNKNOWN')).toBe(0.5);
  });
});
```
- [ ] **Step 2: Run → FAIL** (`npx jest .../deliverability/config.test.ts`)
- [ ] **Step 3: Implement**
```typescript
function num(env: string, def: number): number { const v = Number(process.env[env]); return Number.isFinite(v) ? v : def; }
export type Quality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
export const CFG = {
  windowMs: () => num('META_SERVICE_WINDOW_HOURS', 24) * 60 * 60 * 1000,
  optOutDanger: () => num('OPT_OUT_DANGER', 0.02),
  failureDanger: () => num('FAILURE_DANGER', 0.05),
  quarantineThreshold: () => num('QUARANTINE_THRESHOLD', 0.8),
  quarantineHours: () => num('QUARANTINE_HOURS', 24),
  tenantWeight: () => num('TENANT_WEIGHT_DEFAULT', 0.05),
  weights: () => ({ volume: num('RISK_W_VOLUME', 0.35), cold: num('RISK_W_COLD', 0.30), optOut: num('RISK_W_OPTOUT', 0.20), failure: num('RISK_W_FAILURE', 0.15) }),
  qualityFactor: (q: Quality): number => q === 'GREEN' ? num('QUALITY_FACTOR_GREEN', 1.0)
    : q === 'YELLOW' ? num('QUALITY_FACTOR_YELLOW', 0.5)
    : q === 'RED' ? num('QUALITY_FACTOR_RED', 0.25)
    : num('QUALITY_FACTOR_YELLOW', 0.5),  // UNKNOWN treated as YELLOW (cautious)
  graduationPerDay: () => num('GRADUATION_INITIATED_PER_DAY', 500),
  graduationDays: () => num('GRADUATION_SUSTAINED_DAYS', 3),
  sharedPhoneNumberId: () => process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
};
```
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): tunable config constants`)

---

## Task 3: Compliance gate — pure `decideSend`

**Files:** Create `src/lib/whatsapp/v2/deliverability/metaSendGate.ts`; Test alongside.

- [ ] **Step 1: Failing test**
```typescript
import { decideSend } from '@/lib/whatsapp/v2/deliverability/metaSendGate';
const now = Date.parse('2026-06-23T12:00:00Z');
const recent = '2026-06-23T11:30:00Z';   // 30 min ago (in window)
const old = '2026-06-21T12:00:00Z';       // 48h ago (out of window)
const tmpl = { name: 'rebooking_followup_v1', language: 'en_US' };

describe('decideSend', () => {
  it('holds initiated send to opted-out customer', () => {
    expect(decideSend({ initiated: true, lastInboundAt: recent, optedOutAt: recent, messageType: 'rebooking_followup', template: tmpl, now }).mode).toBe('hold');
  });
  it('replies are always freeform', () => {
    expect(decideSend({ initiated: false, lastInboundAt: old, optedOutAt: null, messageType: 'reply', template: null, now }).mode).toBe('freeform');
  });
  it('initiated within 24h window is freeform', () => {
    expect(decideSend({ initiated: true, lastInboundAt: recent, optedOutAt: null, messageType: 'rebooking_followup', template: tmpl, now }).mode).toBe('freeform');
  });
  it('initiated outside window with template -> template', () => {
    const d = decideSend({ initiated: true, lastInboundAt: old, optedOutAt: null, messageType: 'rebooking_followup', template: tmpl, now });
    expect(d.mode).toBe('template'); expect(d.templateName).toBe('rebooking_followup_v1');
  });
  it('initiated outside window with NO template -> hold', () => {
    expect(decideSend({ initiated: true, lastInboundAt: old, optedOutAt: null, messageType: 'rebooking_followup', template: null, now }).mode).toBe('hold');
  });
  it('no prior inbound at all + initiated -> hold without template', () => {
    expect(decideSend({ initiated: true, lastInboundAt: null, optedOutAt: null, messageType: 'rebooking_followup', template: null, now }).mode).toBe('hold');
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import { CFG } from './config';

export type SendMode = 'freeform' | 'template' | 'hold';
export interface GateTemplate { name: string; language: string; }
export interface GateInput {
  initiated: boolean;
  lastInboundAt: string | null;
  optedOutAt: string | null;
  messageType: string;
  template?: GateTemplate | null;
  now?: number;
}
export interface GateDecision { mode: SendMode; templateName?: string; language?: string; reason: string; }

function withinWindow(lastInboundAt: string | null, now: number): boolean {
  if (!lastInboundAt) return false;
  return now - Date.parse(lastInboundAt) < CFG.windowMs();
}

export function decideSend(input: GateInput): GateDecision {
  const now = input.now ?? Date.now();
  if (input.initiated && input.optedOutAt) return { mode: 'hold', reason: 'opted_out' };
  if (!input.initiated) return { mode: 'freeform', reason: 'reply' };
  if (withinWindow(input.lastInboundAt, now)) return { mode: 'freeform', reason: 'in_window' };
  if (input.template) return { mode: 'template', templateName: input.template.name, language: input.template.language, reason: 'template_out_of_window' };
  return { mode: 'hold', reason: 'no_template_outside_window' };
}
```
- [ ] **Step 4: Run → PASS (6 tests)** — [ ] **Step 5: Commit** (`feat(deliverability): pure Meta 24h-window send gate`)

---

## Task 4: Template registry — `resolveTemplate`

**Files:** Create `templateRegistry.ts`; Test alongside (queue-based supabase mock).

- [ ] **Step 1: Failing test**
```typescript
import { resolveTemplate } from '@/lib/whatsapp/v2/deliverability/templateRegistry';
// queue mock: responses[], pushDb, makeChain supporting .select().eq().eq().eq().maybeSingle()
describe('resolveTemplate', () => {
  beforeEach(() => { responses.length = 0; jest.clearAllMocks(); });
  it('returns tenant override when present + approved', async () => {
    pushDb({ template_name: 't_tenant', language: 'en_US', param_mapping: [], status: 'approved' });
    const r = await resolveTemplate(admin as any, 'ten_1', 'rebooking_followup', 'en_US');
    expect(r?.name).toBe('t_tenant');
  });
  it('falls back to platform default (tenant_id NULL) when no override', async () => {
    pushDb(null);                                            // tenant override miss
    pushDb({ template_name: 't_platform', language: 'en_US', param_mapping: [], status: 'approved' });
    const r = await resolveTemplate(admin as any, 'ten_1', 'rebooking_followup', 'en_US');
    expect(r?.name).toBe('t_platform');
  });
  it('returns null when only a non-approved template exists', async () => {
    pushDb({ template_name: 't', language: 'en_US', param_mapping: [], status: 'pending' });
    pushDb(null);
    const r = await resolveTemplate(admin as any, 'ten_1', 'rebooking_followup', 'en_US');
    expect(r).toBeNull();
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedTemplate { name: string; language: string; paramMapping: unknown[]; }

async function fetchOne(admin: SupabaseClient, tenantId: string | null, messageType: string, language: string) {
  let q = admin.from('message_templates').select('template_name, language, param_mapping, status').eq('message_type', messageType).eq('language', language);
  q = tenantId === null ? q.is('tenant_id', null) : q.eq('tenant_id', tenantId);
  const { data } = await q.maybeSingle();
  if (!data || data.status !== 'approved') return null;
  return { name: data.template_name as string, language: data.language as string, paramMapping: (data.param_mapping ?? []) as unknown[] };
}

/** Tenant override first, else platform default (tenant_id IS NULL). Only 'approved' templates. */
export async function resolveTemplate(admin: SupabaseClient, tenantId: string, messageType: string, language = 'en_US'): Promise<ResolvedTemplate | null> {
  return (await fetchOne(admin, tenantId, messageType, language)) ?? (await fetchOne(admin, null, messageType, language));
}
```
> The mock's `makeChain` must support `.is()` (returns chain) in addition to `.eq()`.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): approved-template registry resolver`)

---

## Task 5: Number quality — `loadNumberQuality` + `qualityFactor`

**Files:** Create `numberQuality.ts`; Test alongside.

- [ ] **Step 1: Failing test**
```typescript
import { loadNumberQuality } from '@/lib/whatsapp/v2/deliverability/numberQuality';
// env: WHATSAPP_PHONE_NUMBER_ID = 'SHARED_PNID'
describe('loadNumberQuality', () => {
  beforeEach(() => { responses.length = 0; process.env.WHATSAPP_PHONE_NUMBER_ID = 'SHARED_PNID'; jest.clearAllMocks(); });
  it('resolves the shared number id from env and returns its quality row', async () => {
    pushDb({ phone_number_id: 'SHARED_PNID', quality_rating: 'YELLOW', limit_per_24h: 1000 });
    const q = await loadNumberQuality(admin as any, 'ten_1');
    expect(q.phoneNumberId).toBe('SHARED_PNID'); expect(q.quality).toBe('YELLOW'); expect(q.limitPer24h).toBe(1000);
  });
  it('defaults to UNKNOWN + tier-250 limit when no row yet', async () => {
    pushDb(null);
    const q = await loadNumberQuality(admin as any, 'ten_1');
    expect(q.quality).toBe('UNKNOWN'); expect(q.limitPer24h).toBe(250);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { CFG, type Quality } from './config';

export interface NumberQuality { phoneNumberId: string; quality: Quality; limitPer24h: number; }

/**
 * Resolve which Meta number a tenant sends from, and its quality. v1: routing-code
 * tenants all use the shared env number; dedicated-number resolution is a documented
 * extension (read whatsapp_configurations.meta_phone_number_id when present).
 */
export async function loadNumberQuality(admin: SupabaseClient, _tenantId: string): Promise<NumberQuality> {
  const phoneNumberId = CFG.sharedPhoneNumberId();
  const { data } = await admin.from('whatsapp_number_quality').select('quality_rating, limit_per_24h').eq('phone_number_id', phoneNumberId).maybeSingle();
  return {
    phoneNumberId,
    quality: ((data?.quality_rating as Quality) ?? 'UNKNOWN'),
    limitPer24h: Number(data?.limit_per_24h ?? 250),
  };
}
```
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): number-quality loader (shared env number)`)

---

## Task 6: Thread `language` through the Meta template send

**Files:** Modify `src/lib/whatsapp/providers/meta.ts` (shared — stage only this file); Test `src/__tests__/lib/whatsapp/providers/meta-template-language.test.ts`

- [ ] **Step 1: Failing test** — mock `fetchWithTimeout`; call `adapter.sendTemplateMessage('234...', 'tpl', [{default:'X'}], 'en')`; assert the POST body `template.language.code === 'en'` (not hardcoded `en_US`).
- [ ] **Step 2: Run → FAIL** (signature has no language param / hardcoded en_US)
- [ ] **Step 3: Implement** — change the signature to `sendTemplateMessage(to, templateName, parameters?, language = 'en_US')` and set `language: { code: language }` in the payload. Keep the default `'en_US'` so existing callers are unaffected.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(whatsapp): thread template language through MetaAdapter.sendTemplateMessage`)

---

## Task 7: Risk score (pure) — `computeRiskScore`

**Files:** Create `riskScore.ts`; Test alongside.

- [ ] **Step 1: Failing test**
```typescript
import { computeRiskScore } from '@/lib/whatsapp/v2/deliverability/riskScore';
describe('computeRiskScore', () => {
  it('is ~0 for clean low-volume tenant', () => {
    const s = computeRiskScore({ initiatedRecipients: 1, sent: 5, initiated: 5, cold: 0, optOuts: 0, failures: 0 }, 100);
    expect(s).toBeLessThan(0.1);
  });
  it('a 2% opt-out rate alone pushes optOut component to its max weight', () => {
    const s = computeRiskScore({ initiatedRecipients: 10, sent: 100, initiated: 100, cold: 0, optOuts: 2, failures: 0 }, 1000);
    expect(s).toBeGreaterThanOrEqual(0.20 - 0.001); // optOut weight .20 fully applied
  });
  it('exhausted allocation + all-cold + high optout/fail approaches 1', () => {
    const s = computeRiskScore({ initiatedRecipients: 1000, sent: 1000, initiated: 1000, cold: 1000, optOuts: 50, failures: 100 }, 1000);
    expect(s).toBeGreaterThan(0.9);
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import { CFG } from './config';
export interface RiskStats { initiatedRecipients: number; sent: number; initiated: number; cold: number; optOuts: number; failures: number; }

export function computeRiskScore(s: RiskStats, allocation: number): number {
  const w = CFG.weights();
  const volume = Math.min(1, s.initiatedRecipients / Math.max(allocation, 1));
  const cold = s.cold / Math.max(s.initiated, 1);
  const optOut = Math.min(1, (s.optOuts / Math.max(s.sent, 1)) / CFG.optOutDanger());
  const failure = Math.min(1, (s.failures / Math.max(s.sent, 1)) / CFG.failureDanger());
  return Math.min(1, w.volume * volume + w.cold * cold + w.optOut * optOut + w.failure * failure);
}
```
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): pure risk-score blend`)

---

## Task 8: Send governor — `evaluateSend` + `recordSend`

**Files:** Create `sendGovernor.ts`; Test alongside (queue mock recording updates).

- [ ] **Step 1: Failing test**
```typescript
import { evaluateSend, recordSend, hashRecipient } from '@/lib/whatsapp/v2/deliverability/sendGovernor';
// stats row pushed via pushDb; updates[] captures .update/.upsert payloads
describe('evaluateSend', () => {
  beforeEach(() => { responses.length = 0; updates.length = 0; jest.clearAllMocks(); });
  it('blocks while quarantined', async () => {
    pushDb({ tenant_id: 't1', quarantined_until: new Date(Date.now()+3600e3).toISOString(), initiated_recipients_24h: 0, recipients_seen: [], window_start: new Date().toISOString() });
    const d = await evaluateSend(admin as any, 't1', { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 }, 'cust1');
    expect(d.allow).toBe(false); expect(d.reason).toBe('quarantined');
  });
  it('allows a repeat recipient even at allocation (no new recipient cost)', async () => {
    // recipients_seen must hold the REAL hash of 'cust1' — import hashRecipient from the module.
    pushDb({ tenant_id: 't1', quarantined_until: null, initiated_recipients_24h: 50, recipients_seen: [hashRecipient('cust1')], risk_score: 0, window_start: new Date().toISOString(), sent_24h:0, initiated_24h:0, cold_outbound_24h:0, opt_outs_24h:0, failures_24h:0 });
    // allocation = 1000 * GREEN(1.0) * weight(0.05) = 50; recipient already seen -> allowed
    const d = await evaluateSend(admin as any, 't1', { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 }, 'cust1');
    expect(d.allow).toBe(true);
  });
  it('blocks a NEW recipient once allocation is hit', async () => {
    pushDb({ tenant_id: 't1', quarantined_until: null, initiated_recipients_24h: 50, recipients_seen: [hashRecipient('other')], risk_score: 0, window_start: new Date().toISOString(), sent_24h:0, initiated_24h:0, cold_outbound_24h:0, opt_outs_24h:0, failures_24h:0 });
    const d = await evaluateSend(admin as any, 't1', { phoneNumberId: 'P', quality: 'GREEN', limitPer24h: 1000 }, 'cust1');
    expect(d.allow).toBe(false); expect(d.reason).toBe('allocation_exhausted');
  });
});
```
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { CFG, type Quality } from './config';
import { computeRiskScore } from './riskScore';

export interface NumberQualityLite { phoneNumberId: string; quality: Quality; limitPer24h: number; }
export interface GovDecision { allow: boolean; reason: string; }
export interface StatsRow {
  tenant_id: string; window_start: string; sent_24h: number; initiated_24h: number;
  initiated_recipients_24h: number; recipients_seen: string[]; cold_outbound_24h: number;
  opt_outs_24h: number; failures_24h: number; risk_score: number; quarantined_until: string | null;
}

export const hashRecipient = (recipient: string) => 'h:' + createHash('sha256').update(recipient).digest('hex').slice(0, 16);
const windowExpired = (start: string, now: number) => now - Date.parse(start) >= CFG.windowMs();

async function loadOrInit(admin: SupabaseClient, tenantId: string): Promise<StatsRow> {
  const { data } = await admin.from('tenant_messaging_stats').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (data) return data as StatsRow;
  return { tenant_id: tenantId, window_start: new Date().toISOString(), sent_24h: 0, initiated_24h: 0, initiated_recipients_24h: 0, recipients_seen: [], cold_outbound_24h: 0, opt_outs_24h: 0, failures_24h: 0, risk_score: 0, quarantined_until: null };
}

export function allocationFor(q: NumberQualityLite): number {
  return Math.max(1, Math.floor(q.limitPer24h * CFG.qualityFactor(q.quality) * CFG.tenantWeight()));
}

/** Decide whether tenant may make a business-INITIATED send to `recipient`. Never blocks replies (caller skips this for replies). */
export async function evaluateSend(admin: SupabaseClient, tenantId: string, q: NumberQualityLite, recipient: string): Promise<GovDecision> {
  const now = Date.now();
  let row = await loadOrInit(admin, tenantId);
  if (windowExpired(row.window_start, now)) row = { ...row, window_start: new Date(now).toISOString(), sent_24h: 0, initiated_24h: 0, initiated_recipients_24h: 0, recipients_seen: [], cold_outbound_24h: 0, opt_outs_24h: 0, failures_24h: 0 };

  if (row.quarantined_until && Date.parse(row.quarantined_until) > now) return { allow: false, reason: 'quarantined' };

  const allocation = allocationFor(q);
  const alreadySeen = (row.recipients_seen ?? []).includes(hashRecipient(recipient));
  if (!alreadySeen && row.initiated_recipients_24h >= allocation) return { allow: false, reason: 'allocation_exhausted' };

  const risk = computeRiskScore({ initiatedRecipients: row.initiated_recipients_24h, sent: row.sent_24h, initiated: row.initiated_24h, cold: row.cold_outbound_24h, optOuts: row.opt_outs_24h, failures: row.failures_24h }, allocation);
  if (risk >= CFG.quarantineThreshold()) {
    const until = new Date(now + CFG.quarantineHours() * 3600e3).toISOString();
    await admin.from('tenant_messaging_stats').upsert({ tenant_id: tenantId, risk_score: risk, quarantined_until: until, updated_at: new Date(now).toISOString() });
    return { allow: false, reason: 'risk_quarantine' };
  }
  return { allow: true, reason: 'ok' };
}

/** Record a completed send. Bumps recipient count only for a NEW recipient this window. */
export async function recordSend(admin: SupabaseClient, tenantId: string, ev: { recipient: string; initiated: boolean; cold: boolean; failed: boolean }): Promise<void> {
  const now = Date.now();
  let row = await loadOrInit(admin, tenantId);
  if (windowExpired(row.window_start, now)) row = { ...row, window_start: new Date(now).toISOString(), sent_24h: 0, initiated_24h: 0, initiated_recipients_24h: 0, recipients_seen: [], cold_outbound_24h: 0, opt_outs_24h: 0, failures_24h: 0 };
  const seen = new Set(row.recipients_seen ?? []);
  const h = hashRecipient(ev.recipient);
  const isNew = ev.initiated && !seen.has(h);
  if (isNew && seen.size < 5000) seen.add(h);
  await admin.from('tenant_messaging_stats').upsert({
    tenant_id: tenantId,
    window_start: row.window_start,
    sent_24h: row.sent_24h + 1,
    initiated_24h: row.initiated_24h + (ev.initiated ? 1 : 0),
    initiated_recipients_24h: row.initiated_recipients_24h + (isNew ? 1 : 0),
    recipients_seen: [...seen],
    cold_outbound_24h: row.cold_outbound_24h + (ev.cold ? 1 : 0),
    failures_24h: row.failures_24h + (ev.failed ? 1 : 0),
    updated_at: new Date(now).toISOString(),
  });
}
```
> Mock `makeChain` must support `.upsert()` (resolves `{error:null}`) and `.maybeSingle()`.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): send governor (recipient quota + risk quarantine)`)

---

## Task 9: Orchestration — `sendGovernedInitiated`

**Files:** Create `governedSend.ts`; Test alongside (mock governor/gate/registry/numberQuality + a send fn).

- [ ] **Step 1: Failing test** — mock the four deps; assert:
  - governor `allow:false` → returns `{ sent:false, reason }`, send fn NOT called.
  - gate `hold` → `{ sent:false }`, send NOT called, but `recordSend` NOT called either (nothing sent).
  - gate `freeform` → calls `sendFreeform()`, then `recordSend({initiated:true,cold:false})`, returns `{sent:true, mode:'freeform'}`.
  - gate `template` → calls `sendTemplate(name, params)`, then `recordSend({initiated:true, cold:true})`, returns `{sent:true, mode:'template'}`.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement**
```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { decideSend } from './metaSendGate';
import { resolveTemplate } from './templateRegistry';
import { loadNumberQuality } from './numberQuality';
import { evaluateSend, recordSend } from './sendGovernor';
import { CFG } from './config';

export interface GovernedSendParams {
  tenantId: string;
  recipient: string;                       // customer phone
  messageType: string;                     // 'rebooking_followup' | ...
  lastInboundAt: string | null;
  optedOutAt: string | null;
  language?: string;
  buildFreeform: () => string;             // the existing free-form copy
  sendFreeform: (text: string) => Promise<boolean>;  // returns success
  sendTemplate: (name: string, language: string, paramMapping: unknown[]) => Promise<boolean>;
}
export interface GovernedSendResult { sent: boolean; mode?: 'freeform' | 'template'; reason: string; }

export async function sendGovernedInitiated(admin: SupabaseClient, p: GovernedSendParams): Promise<GovernedSendResult> {
  const now = Date.now();
  const q = await loadNumberQuality(admin, p.tenantId);

  // RED: hold COLD initiated sends (no inbound in window); in-window still allowed by the gate below.
  const inWindow = p.lastInboundAt ? (now - Date.parse(p.lastInboundAt) < CFG.windowMs()) : false;
  if (q.quality === 'RED' && !inWindow) return { sent: false, reason: 'red_quality_cold_hold' };

  const gov = await evaluateSend(admin, p.tenantId, q, p.recipient);
  if (!gov.allow) return { sent: false, reason: gov.reason };

  const tmpl = await resolveTemplate(admin, p.tenantId, p.messageType, p.language ?? 'en_US');
  const decision = decideSend({ initiated: true, lastInboundAt: p.lastInboundAt, optedOutAt: p.optedOutAt, messageType: p.messageType, template: tmpl ? { name: tmpl.name, language: tmpl.language } : null });

  if (decision.mode === 'hold') return { sent: false, reason: decision.reason };

  const cold = !inWindow; // template sends are to out-of-window (cold) recipients
  let ok: boolean;
  if (decision.mode === 'template') ok = await p.sendTemplate(tmpl!.name, tmpl!.language, tmpl!.paramMapping);
  else ok = await p.sendFreeform(p.buildFreeform());

  await recordSend(admin, p.tenantId, { recipient: p.recipient, initiated: true, cold, failed: !ok });
  return { sent: ok, mode: decision.mode === 'template' ? 'template' : 'freeform', reason: ok ? 'sent' : 'send_failed' };
}
```
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): governed initiated-send orchestration`)

---

## Task 10: Integrate at the 3 initiated send sites

**Files (shared — stage individually):** `src/lib/whatsapp/v2/waitlist.ts`, `src/app/api/cron/nightly/route.ts`. (Replies/`outboundBranding` reply path unchanged.)
**Test:** extend `src/__tests__/api/cron/nightly/rebooking.test.ts` + `waitlist` test by mocking `governedSend`.

- [ ] **Step 1:** Read each site. Today they call `brandCustomerText(tenantId, phone, message, { initiated: true })` then `client.sendTextMessage`. Replace each with a `sendGovernedInitiated(...)` call whose `sendFreeform` runs the existing brand+send, and `sendTemplate` calls `client.sendTemplateMessage`. `messageType`: waitlist→`'waitlist_slot'`, follow-up→`'rebooking_followup'`, nudge→`'rebooking_nudge'`. Provide `lastInboundAt`/`optedOutAt` from the conversation (load if not already in scope).
- [ ] **Step 2:** Write failing tests: mock `sendGovernedInitiated` to assert each site calls it with the right `messageType` + recipient, and that a `{sent:false}` result skips the send (no double-send).
- [ ] **Step 3:** Implement the three replacements. Keep `buildFreeform` = the existing copy builder so in-window sends are byte-identical to today.
- [ ] **Step 4:** Run the affected suites → PASS.
- [ ] **Step 5: Commit** (`feat(deliverability): route waitlist + rebooking sends through the governor`)

---

## Task 11: Meta quality webhook ingestion

**Files:** Create `metaQualityWebhook.ts` + test; Modify `src/app/api/webhooks/whatsapp/meta/route.ts` (shared — stage only it).

- [ ] **Step 1: Failing test** for `ingestQualityWebhook(admin, change)`:
  - `phone_number_quality_update` → upserts `whatsapp_number_quality` with the new `quality_rating`.
  - `messaging_limit_update`/tier change → upserts `messaging_tier` + `limit_per_24h`.
  - `message_template_status_update` → updates `message_templates.status` by `template_name`+`language`.
  - unknown field → no-op (returns false).
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement `ingestQualityWebhook`** (upsert by `phone_number_id`; map Meta tier strings → `limit_per_24h` via a lookup `{TIER_250:250, TIER_1K:1000, TIER_10K:10000, TIER_100K:100000, TIER_UNLIMITED:1000000}`). Then in the Meta webhook route loop, BEFORE `if (change.field !== 'messages') continue;`, add: `if (['phone_number_quality_update','messaging_limits','account_update','message_template_status_update'].includes(change.field ?? '')) { await ingestQualityWebhook(admin, change); continue; }`. Verify exact field names against the current Graph API version during implementation; adjust the set + payload parsing accordingly.
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): ingest Meta quality/limit/template webhooks`)

---

## Task 12: Graduation advisor + nightly wiring

**Files:** Create `graduationAdvisor.ts` + test; Modify `src/app/api/cron/nightly/route.ts` (shared — stage only it).

- [ ] **Step 1: Failing test** for `runGraduationAdvisor(admin)`: a tenant with `initiated_recipients_24h ≥ GRADUATION_INITIATED_PER_DAY` → emits a superadmin alert (mock `telegramAlert`) and returns the count of advised tenants; below threshold → no alert.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** `runGraduationAdvisor` (query `tenant_messaging_stats` where `initiated_recipients_24h >= CFG.graduationPerDay()`; for each, `sendTelegramAlert(...)` recommending a dedicated number; insert a `notifications` row `type:'graduation_recommended'`). Wire a `// Task: deliverability graduation sweep` block into the nightly GET that `await runGraduationAdvisor(supabaseAdmin)` and folds the count into `results`. (Sustained-N-days check: v1 alerts on a single day over threshold; note the multi-day refinement as a follow-up.)
- [ ] **Step 4: Run → PASS** — [ ] **Step 5: Commit** (`feat(deliverability): nightly graduation advisor + alert`)

---

## Task 13: Full-suite + verification checkpoint

- [ ] **Step 1:** `NODE_OPTIONS="--max-old-space-size=4096" npx jest src/__tests__/lib/whatsapp/v2/deliverability/ src/__tests__/lib/whatsapp/providers/meta-template-language.test.ts src/__tests__/api/cron/nightly/` → all green.
- [ ] **Step 2:** `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit` → no NEW errors in deliverability files.
- [ ] **Step 3:** Live-schema check: confirm `message_templates`/`tenant_messaging_stats`/`whatsapp_number_quality` exist (migration 091 run) and the Meta webhook field names match the deployed Graph API version.
- [ ] **Step 4:** Seed the initial **approved** platform templates (`rebooking_followup`, `rebooking_nudge`, `waitlist_slot`) in Meta Business Manager + insert their `message_templates` rows (runbook note — until then, out-of-window initiated sends correctly **hold**, which is the safe default).

---

## Final: land the branch

Per `superpowers:finishing-a-development-branch` — once Tasks 1–13 are green, coordinate a clean FF of `feat/instagram-channel` to this branch during a parallel-session pause (the same protocol used for off-boarding). Shared-file touches (`meta.ts`, `waitlist.ts`, `cron/nightly/route.ts`, `meta/route.ts`) may need a quick rebase auto-merge.

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| Unit 1 compliance gate | 3 |
| Unit 2 template registry | 1, 4 |
| Unit 3 governor (stats, risk, quota, quarantine) | 1, 7, 8 |
| Unit 4 quality webhooks + qualityFactor | 1, 2, 5, 11 |
| Unit 5 graduation advisor | 12 |
| Integration at chokepoint | 9, 10 |
| Provider template language | 6 |
| Config | 2 |
| Verification / seeding | 13 |

**Deferred (documented, not silent):** true sliding-window counter (v1 = fixed window); multi-day sustained graduation check (v1 = single-day threshold); dedicated-number quality resolution in `loadNumberQuality` (v1 = shared env number); explicit opt-in capture (lives with booking-form opt-in work).
