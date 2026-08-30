# Meta Pilot Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Booka's existing WhatsApp and Instagram integrations ready for a supervised, Booka-managed beauty-business pilot and clearly report what remains blocked on Meta approval.

**Architecture:** Keep the current channel routes and encrypted tenant-secret storage. Centralize the WhatsApp Graph API version at `v25.0`, pass that server-controlled version to Embedded Signup, add a read-only environment readiness checker, and document the exact Meta Dashboard and live-test sequence.

**Tech Stack:** Next.js 16, TypeScript, React, Jest, Node.js ESM scripts, Meta Graph API, WhatsApp Cloud API, Instagram API with Instagram Login.

**Spec:** `docs/superpowers/specs/2026-08-30-meta-pilot-readiness-design.md`

## Global Constraints

- The controlled pilot uses only Meta assets Booka owns or manages.
- Public tenant self-onboarding remains gated on Meta Advanced Access and Embedded Signup approval.
- Default both Meta channel transports to Graph API `v25.0`.
- Never print, commit, or return app secrets, access tokens, webhook tokens, or OAuth state secrets.
- Do not mutate live Meta settings, subscribe WABAs, register phone numbers, or connect Instagram accounts from the readiness checker.
- Preserve the existing webhook signature verification and encrypted provider-secret storage.

---

### Task 1: Centralize WhatsApp Graph API v25.0

**Files:**
- Create: `src/lib/whatsapp/metaApiConfig.ts`
- Modify: `src/app/api/tenants/[tenantId]/whatsapp/meta/embedded-signup/route.ts`
- Modify: `src/components/settings/MetaWhatsAppConnectSection.tsx`
- Modify: `src/lib/healthChecks.ts`
- Modify: `src/app/api/health/route.ts`
- Modify: `src/lib/whatsapp/evolutionClient.ts`
- Modify: `src/lib/whatsapp/product-service.ts`
- Modify: `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts`
- Modify: `src/app/api/cron/nightly/route.ts`
- Modify: `src/app/api/webhooks/whatsapp/meta/route.ts`
- Modify: `src/__tests__/api/tenants/meta-embedded-signup.test.ts`
- Modify: `src/__tests__/lib/whatsapp/metaConnectionValidation.test.ts`
- Modify: `.env.example`
- Modify: `env.example`
- Modify: `deployment/env/.env.staging.example`
- Modify: `deployment/env/.env.production.example`
- Modify: `docs/vps-launch-runbook.md`

**Interfaces:**
- Produces: `DEFAULT_WHATSAPP_GRAPH_API_VERSION = 'v25.0'`.
- Produces: `getWhatsAppGraphApiVersion(env?: NodeJS.ProcessEnv): string`.
- Produces: authenticated Embedded Signup response field `embeddedSignup.apiVersion: string`.
- Consumes: `WHATSAPP_API_VERSION`, falling back to the centralized constant.

- [x] **Step 1: Write failing unit and route tests**

Test the consumer-visible contract: with the environment version unset, the authenticated Embedded Signup GET response includes `apiVersion: 'v25.0'` without exposing any secret.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
npx jest src/__tests__/api/tenants/meta-embedded-signup.test.ts --runInBand
```

Expected: failure because the config helper and `apiVersion` response do not exist.

- [x] **Step 3: Implement the shared version resolver**

Create a side-effect-free helper that trims the environment value and otherwise returns `v25.0`. Replace every production `v18.0` WhatsApp fallback with the helper or centralized constant. Return `apiVersion` beside the public Embedded Signup app/config IDs, and initialize the browser SDK with that returned value.

- [x] **Step 4: Update environment templates and operator documentation**

Set `WHATSAPP_API_VERSION=v25.0` explicitly in both staging and production examples. Keep secret values blank and describe the variable as server-controlled.

- [x] **Step 5: Run focused verification**

Run the Jest command from Step 2, then:

```bash
rg -n "v18\.0" src .env.example env.example deployment/env docs/vps-launch-runbook.md
```

Expected: tests pass; no production fallback remains.

- [x] **Step 6: Commit**

```bash
git add src .env.example env.example deployment/env docs/vps-launch-runbook.md
git commit -m "fix(meta): standardize WhatsApp Graph API version"
```

---

### Task 2: Add the read-only Meta pilot-readiness checker

**Files:**
- Create: `scripts/check-meta-pilot-readiness.mjs`
- Create: `scripts/check-meta-pilot-readiness.test.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `env.example`
- Modify: `deployment/env/.env.staging.example`
- Modify: `deployment/env/.env.production.example`

**Interfaces:**
- Produces: `buildMetaPilotReadiness(env): MetaPilotReadinessResult` as a JSON-safe object.
- Produces: CLI command `npm run meta:pilot:check`.
- Reports per channel: `status`, `missing`, `apiVersion`, `webhookUrl`, and public callback URLs only.
- Reports WhatsApp `publicOnboardingConfigured` separately from `controlled_pilot_ready`.

- [x] **Step 1: Write failing Node tests**

Cover three configurations: empty environment returns `not_ready`; managed pilot variables return `controlled_pilot_ready` for both channels; adding `META_EMBEDDED_SIGNUP_CONFIG_ID` makes WhatsApp `publicOnboardingConfigured` true. Recursively assert that no configured secret or access-token value appears in `JSON.stringify(result)`.

- [x] **Step 2: Run the checker test and confirm it fails**

Run:

```bash
node --test scripts/check-meta-pilot-readiness.test.mjs
```

Expected: module-not-found failure because the checker does not exist.

- [x] **Step 3: Implement deterministic readiness evaluation**

Require HTTPS `APP_URL`; derive `/api/webhooks/whatsapp/meta`, `/api/webhooks/instagram`, and `/api/auth/instagram/callback`. For WhatsApp require `META_APP_ID`, `META_APP_SECRET` or `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_ACCESS_TOKEN`. For Instagram require `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`, `INSTAGRAM_OAUTH_STATE_SECRET`, and an exact HTTPS `INSTAGRAM_OAUTH_REDIRECT_URI`. Return missing variable names, never their values.

- [x] **Step 4: Add the operator command and align templates**

Add `"meta:pilot:check": "node scripts/check-meta-pilot-readiness.mjs"`. Ensure all four environment examples contain the same canonical variable names, `WHATSAPP_API_VERSION=v25.0`, and the correct staging/production callback comments.

- [x] **Step 5: Run focused verification**

Run:

```bash
node --test scripts/check-meta-pilot-readiness.test.mjs
npm run meta:pilot:check
```

Expected: tests pass; the local command may report missing configuration but exits successfully and prints no secrets.

- [x] **Step 6: Commit**

```bash
git add scripts/check-meta-pilot-readiness.mjs scripts/check-meta-pilot-readiness.test.mjs package.json .env.example env.example deployment/env
git commit -m "feat(meta): add pilot readiness checker"
```

---

### Task 3: Create the Meta Dashboard and live-pilot runbook

**Files:**
- Create: `docs/runbooks/meta-controlled-pilot.md`
- Modify: `docs/instagram-meta-setup-guide.md`

**Interfaces:**
- Consumes: `npm run meta:pilot:check` from Task 2.
- Produces: one operator checklist for staging dashboard configuration, webhook handshakes, managed-account connections, end-to-end revenue flow, and App Review evidence.

- [x] **Step 1: Write the runbook acceptance checklist**

Include exact staging URLs, exact WhatsApp and Instagram permission names, Development-mode tester boundaries, WABA subscription/phone checks, WhatsApp approved-template restrictions, Instagram customer-initiated 24-hour messaging constraints, and the explicit prohibition on public tenant onboarding before Advanced Access.

- [x] **Step 2: Add the end-to-end pilot test matrix**

Require evidence for inbound enquiry, AI answer, recommendation, alternative offer, booking, deposit/payment link, abandoned-enquiry follow-up where the channel permits it, reminder/template send, cancellation/no-show recovery, repeat booking, direct/influenced/recovered attribution, owner report, human handoff, invalid-signature rejection, and duplicate-webhook idempotency.

- [x] **Step 3: Add Meta App Review evidence capture**

List the screencasts, test credentials, reviewer instructions, permission-to-feature mapping, privacy-policy/data-deletion URLs, and webhook proof needed for `business_management`, `whatsapp_business_management`, `whatsapp_business_messaging`, `instagram_business_basic`, and `instagram_business_manage_messages`.

- [x] **Step 4: Verify documentation consistency**

Run:

```bash
rg -n "staging\.app\.techclave\.cloud|v25\.0|controlled_pilot_ready|instagram_business_manage_messages|whatsapp_business_messaging" docs/runbooks/meta-controlled-pilot.md docs/instagram-meta-setup-guide.md
git diff --check
```

Expected: every required launch term is present and no whitespace errors are reported.

- [x] **Step 5: Commit**

```bash
git add docs/runbooks/meta-controlled-pilot.md docs/instagram-meta-setup-guide.md
git commit -m "docs(meta): add controlled pilot runbook"
```

---

### Task 4: Integration verification and handoff

**Files:**
- Verify all files changed in Tasks 1-3.

**Interfaces:**
- Consumes: centralized API version, readiness checker, and pilot runbook.
- Produces: a tested branch ready to merge into staging; live Meta mutations remain operator actions.

- [x] **Step 1: Run the focused Meta suites**

```bash
npx jest src/__tests__/api/tenants/meta-embedded-signup.test.ts src/__tests__/api/webhooks/instagram/route.test.ts src/__tests__/api/webhooks/meta-status-settlement.test.ts src/__tests__/api/webhooks/meta-status-idempotency.test.ts --runInBand
node --test scripts/check-meta-pilot-readiness.test.mjs
```

- [x] **Step 2: Run changed-file lint and CI typecheck**

```bash
npx eslint src/lib/whatsapp/metaApiConfig.ts src/app/api/tenants/[tenantId]/whatsapp/meta/embedded-signup/route.ts src/components/settings/MetaWhatsAppConnectSection.tsx scripts/check-meta-pilot-readiness.mjs
npm run typecheck:ci
```

- [x] **Step 3: Run repository verification**

```bash
npm test -- --runInBand
git diff --check
git status --short
```

- [x] **Step 4: Record the remaining external actions**

Report the exact environment variables still missing without values, the Meta Dashboard handshakes still requiring the operator, and the boundary between controlled pilot readiness and public onboarding approval.

- [x] **Step 5: Commit any verification-only corrections**

```bash
git add -u
git commit -m "test(meta): close pilot readiness verification"
```
