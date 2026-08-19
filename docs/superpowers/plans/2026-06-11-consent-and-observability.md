# Consent Gating + Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a GDPR/NDPA-compliant cookie-consent gate, wire PostHog product analytics behind it, and wire Sentry error tracking with PII scrubbing — so the platform has observability without firing non-essential tracking before consent.

**Architecture:** Consent is **opt-out-by-default for everyone** (uniform strictest-standard approach — no geo-detection needed). A tiny pub/sub consent store (localStorage-backed) is the single source of truth. PostHog initializes with `opt_out_capturing_by_default: true` and only opts the user in when analytics consent is granted; a typed `capture()` helper no-ops without consent. Sentry is treated as essential reliability/security telemetry (not consent-gated) but runs with `sendDefaultPii: false` and only initializes when a DSN is present, so dev/test are unaffected. Session replay is PostHog-only and therefore consent-gated.

**Tech Stack:** Next.js 16 (App Router, server-component root layout), React 19, `posthog-js@1.386.6` + `posthog-js/react`, `@sentry/nextjs@10.57.0`, Jest 30 + ts-jest + jsdom + @testing-library/react.

**This is the first slice** of `docs/superpowers/specs/2026-06-11-launch-readiness-checklist-design.md`. It covers spec items **4.4 (consent gate), 5.3 (Sentry), 5.4 (PostHog), 5.5 (Linear — ops only)**. DSAR, AI disclosure, Meta opt-in, and the legal documents are separate plans.

**Key design decisions (locked):**
- Consent categories: `essential` (always on) and `analytics` (requires opt-in). No granular per-vendor toggles in v1 (YAGNI).
- Storage key: `boka_consent_v1`, value `{ analytics: boolean, decidedAt: ISOString }`.
- Sentry is NOT behind the consent banner (legitimate-interest reliability telemetry, PII-scrubbed). PostHog + replay ARE.
- When `NEXT_PUBLIC_POSTHOG_KEY` is absent, the provider is inert — so existing tests and local dev are unaffected.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/consent/consentStore.ts` | Source of truth for consent: read/write localStorage + pub/sub. Pure, SSR-safe. |
| `src/lib/analytics/events.ts` | Typed analytics event-name constants (the tracking plan). |
| `src/lib/analytics/track.ts` | `capture()` helper — no-ops unless analytics consent is granted. |
| `src/components/analytics/AnalyticsProvider.tsx` | Client provider: inits PostHog opted-out, syncs opt-in/out with consent store. |
| `src/components/consent/ConsentBanner.tsx` | Client UI: shown until a decision is made; writes consent. |
| `src/app/layout.tsx` (modify) | Mounts `AnalyticsProvider` + `ConsentBanner`. |
| `instrumentation.ts` (root, create) | Sentry server/edge bootstrap + `onRequestError`. |
| `instrumentation-client.ts` (root, create) | Sentry client init + router transition tracing. |
| `sentry.server.config.ts` / `sentry.edge.config.ts` (root, create) | Sentry init per runtime, PII-scrubbed. |
| `next.config.ts` (modify) | Wrap with `withSentryConfig`. |
| `env.example` (modify) | Add `NEXT_PUBLIC_POSTHOG_KEY/HOST`, `NEXT_PUBLIC_SENTRY_DSN`. |
| `docs/superpowers/plans/2026-06-11-linear-setup-checklist.md` (create) | Manual Linear workspace setup (ops, non-code). |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (deps added by npm)

- [ ] **Step 1: Install pinned versions**

Run:
```bash
npm install posthog-js@1.386.6 @sentry/nextjs@10.57.0
```
Expected: both added to `dependencies`; lockfile updates; no peer-dependency errors (Sentry declares Next `^16.0.0-0`).

- [ ] **Step 2: Verify the existing test suite still passes**

Run: `npx jest --silent 2>&1 | tail -20`
Expected: same pass count as before install (no regressions from the new deps).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(obs): add posthog-js and @sentry/nextjs deps"
```

---

## Task 2: Consent store (source of truth)

**Files:**
- Create: `src/lib/consent/consentStore.ts`
- Test: `src/lib/consent/consentStore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/consent/consentStore.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  getConsent,
  hasDecided,
  hasAnalyticsConsent,
  setConsent,
  onConsentChange,
} from '@/lib/consent/consentStore';

describe('consentStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null and undecided before any choice', () => {
    expect(getConsent()).toBeNull();
    expect(hasDecided()).toBe(false);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('persists an analytics-granted decision', () => {
    const state = setConsent(true);
    expect(state.analytics).toBe(true);
    expect(typeof state.decidedAt).toBe('string');
    expect(hasDecided()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(true);
    // survives a fresh read from storage
    expect(getConsent()?.analytics).toBe(true);
  });

  it('persists an analytics-rejected decision', () => {
    setConsent(false);
    expect(hasDecided()).toBe(true);
    expect(hasAnalyticsConsent()).toBe(false);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsub = onConsentChange(listener);
    setConsent(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    setConsent(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('treats corrupt storage as undecided', () => {
    window.localStorage.setItem('boka_consent_v1', 'not-json');
    expect(getConsent()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/consent/consentStore.test.ts`
Expected: FAIL — `Cannot find module '@/lib/consent/consentStore'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/consent/consentStore.ts
export interface ConsentState {
  analytics: boolean;
  decidedAt: string; // ISO 8601
}

const STORAGE_KEY = 'boka_consent_v1';
type Listener = (state: ConsentState | null) => void;
const listeners = new Set<Listener>();

export function getConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof parsed?.analytics !== 'boolean') return null;
    return { analytics: parsed.analytics, decidedAt: parsed.decidedAt ?? '' };
  } catch {
    return null;
  }
}

export function hasDecided(): boolean {
  return getConsent() !== null;
}

export function hasAnalyticsConsent(): boolean {
  return getConsent()?.analytics === true;
}

export function setConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { analytics, decidedAt: new Date().toISOString() };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  listeners.forEach((l) => l(state));
  return state;
}

export function onConsentChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/consent/consentStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/consent/consentStore.ts src/lib/consent/consentStore.test.ts
git commit -m "feat(consent): add localStorage-backed consent store"
```

---

## Task 3: Analytics event constants + consent-gated capture helper

**Files:**
- Create: `src/lib/analytics/events.ts`
- Create: `src/lib/analytics/track.ts`
- Test: `src/lib/analytics/track.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/analytics/track.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const captureMock = jest.fn();
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { capture: captureMock },
}));

import { capture } from '@/lib/analytics/track';
import { ANALYTICS_EVENTS } from '@/lib/analytics/events';
import { setConsent } from '@/lib/consent/consentStore';

describe('capture', () => {
  beforeEach(() => {
    window.localStorage.clear();
    captureMock.mockClear();
  });

  it('does NOT capture when analytics consent is absent', () => {
    capture(ANALYTICS_EVENTS.BOOKING_CREATED, { id: '1' });
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('does NOT capture when analytics consent is rejected', () => {
    setConsent(false);
    capture(ANALYTICS_EVENTS.BOOKING_CREATED);
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures when analytics consent is granted', () => {
    setConsent(true);
    capture(ANALYTICS_EVENTS.PAYMENT_SUCCEEDED, { amount: 100 });
    expect(captureMock).toHaveBeenCalledWith('payment_succeeded', { amount: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/analytics/track.test.ts`
Expected: FAIL — cannot find `@/lib/analytics/track` / `@/lib/analytics/events`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/analytics/events.ts
export const ANALYTICS_EVENTS = {
  SIGNUP_COMPLETED: 'signup_completed',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  BOOKING_CREATED: 'booking_created',
  PAYMENT_SUCCEEDED: 'payment_succeeded',
  PAYMENT_FAILED: 'payment_failed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  WALLET_TOPPED_UP: 'wallet_topped_up',
  AI_CONVERSATION_HANDLED: 'ai_conversation_handled',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];
```

```typescript
// src/lib/analytics/track.ts
import posthog from 'posthog-js';
import { hasAnalyticsConsent } from '@/lib/consent/consentStore';
import type { AnalyticsEvent } from './events';

/**
 * Capture a product-analytics event. No-ops on the server, and on the client
 * unless the user has explicitly granted analytics consent.
 */
export function capture(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  if (!hasAnalyticsConsent()) return;
  posthog.capture(event, properties);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/analytics/track.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/events.ts src/lib/analytics/track.ts src/lib/analytics/track.test.ts
git commit -m "feat(analytics): add typed events + consent-gated capture helper"
```

---

## Task 4: PostHog analytics provider (opted-out by default, consent-synced)

**Files:**
- Create: `src/components/analytics/AnalyticsProvider.tsx`
- Test: `src/components/analytics/AnalyticsProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/analytics/AnalyticsProvider.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const initMock = jest.fn();
const optInMock = jest.fn();
const optOutMock = jest.fn();
jest.mock('posthog-js', () => ({
  __esModule: true,
  default: { init: initMock, opt_in_capturing: optInMock, opt_out_capturing: optOutMock },
}));
jest.mock('posthog-js/react', () => ({
  __esModule: true,
  PostHogProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AnalyticsProvider from '@/components/analytics/AnalyticsProvider';

describe('AnalyticsProvider', () => {
  const original = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  beforeEach(() => {
    window.localStorage.clear();
    initMock.mockClear();
    optInMock.mockClear();
    optOutMock.mockClear();
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = original;
  });

  it('renders children', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('does NOT init PostHog when no key is configured', () => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(initMock).not.toHaveBeenCalled();
  });

  it('inits PostHog opted-out by default and opts out with no consent', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
    render(<AnalyticsProvider><span>hi</span></AnalyticsProvider>);
    expect(initMock).toHaveBeenCalledTimes(1);
    const [, options] = initMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.opt_out_capturing_by_default).toBe(true);
    expect(options.capture_pageview).toBe(false);
    expect(optOutMock).toHaveBeenCalled();
    expect(optInMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/analytics/AnalyticsProvider.test.tsx`
Expected: FAIL — cannot find `@/components/analytics/AnalyticsProvider`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/analytics/AnalyticsProvider.tsx
'use client';

import React, { useEffect } from 'react';
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { hasAnalyticsConsent, onConsentChange } from '@/lib/consent/consentStore';

export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return; // analytics disabled when unconfigured (dev/test)

    posthog.init(key, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
      opt_out_capturing_by_default: true,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
    });

    const sync = () => {
      if (hasAnalyticsConsent()) posthog.opt_in_capturing();
      else posthog.opt_out_capturing();
    };
    sync();
    return onConsentChange(sync);
  }, []);

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/analytics/AnalyticsProvider.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/AnalyticsProvider.tsx src/components/analytics/AnalyticsProvider.test.tsx
git commit -m "feat(analytics): add consent-synced PostHog provider"
```

---

## Task 5: Consent banner UI

**Files:**
- Create: `src/components/consent/ConsentBanner.tsx`
- Test: `src/components/consent/ConsentBanner.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/consent/ConsentBanner.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from '@jest/globals';
import ConsentBanner from '@/components/consent/ConsentBanner';
import { getConsent } from '@/lib/consent/consentStore';

describe('ConsentBanner', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the dialog when no decision has been made', () => {
    render(<ConsentBanner />);
    expect(screen.getByRole('dialog', { name: /cookie/i })).toBeInTheDocument();
  });

  it('records consent and hides on Accept all', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: /accept all/i }));
    expect(getConsent()?.analytics).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('records rejection and hides on Reject non-essential', () => {
    render(<ConsentBanner />);
    fireEvent.click(screen.getByRole('button', { name: /reject non-essential/i }));
    expect(getConsent()?.analytics).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays hidden when a decision already exists', () => {
    window.localStorage.setItem(
      'boka_consent_v1',
      JSON.stringify({ analytics: true, decidedAt: new Date().toISOString() }),
    );
    render(<ConsentBanner />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/consent/ConsentBanner.test.tsx`
Expected: FAIL — cannot find `@/components/consent/ConsentBanner`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/consent/ConsentBanner.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { getConsent, setConsent } from '@/lib/consent/consentStore';

export default function ConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(getConsent() === null);
  }, []);

  if (!visible) return null;

  const decide = (analytics: boolean) => {
    setConsent(analytics);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-50 m-4 rounded-lg border bg-white p-4 shadow-lg md:max-w-md md:left-auto"
    >
      <p className="text-sm text-gray-700">
        We use essential cookies to run Boka. With your consent we also use analytics
        cookies to improve the product. See our{' '}
        <a href="/cookies" className="underline">Cookie Policy</a>.
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => decide(false)}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Reject non-essential
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white"
        >
          Accept all
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/consent/ConsentBanner.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/consent/ConsentBanner.tsx src/components/consent/ConsentBanner.test.tsx
git commit -m "feat(consent): add cookie consent banner"
```

---

## Task 6: Mount provider + banner in the root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add imports**

In `src/app/layout.tsx`, add after the existing `ToastContainer` import (line 5):

```tsx
import AnalyticsProvider from "@/components/analytics/AnalyticsProvider";
import ConsentBanner from "@/components/consent/ConsentBanner";
```

- [ ] **Step 2: Wrap children and add the banner**

Replace the existing `<body>` block:

```tsx
      <body className="brand-theme antialiased">
        <AuthHashRedirect />
        <ToastContainer />
        {children}
      </body>
```

with:

```tsx
      <body className="brand-theme antialiased">
        <AnalyticsProvider>
          <AuthHashRedirect />
          <ToastContainer />
          {children}
          <ConsentBanner />
        </AnalyticsProvider>
      </body>
```

- [ ] **Step 3: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors referencing `layout.tsx`, `AnalyticsProvider`, or `ConsentBanner`. (Pre-existing unrelated errors elsewhere, if any, are out of scope.)

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(obs): mount analytics provider + consent banner in root layout"
```

---

## Task 7: Sentry configuration (PII-scrubbed, DSN-gated)

**Files:**
- Create: `instrumentation.ts`
- Create: `instrumentation-client.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Modify: `next.config.ts`

- [ ] **Step 1: Create the server runtime config**

```typescript
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    environment: process.env.NODE_ENV,
  });
}
```

- [ ] **Step 2: Create the edge runtime config**

```typescript
// sentry.edge.config.ts
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    environment: process.env.NODE_ENV,
  });
}
```

- [ ] **Step 3: Create the server/edge bootstrap**

```typescript
// instrumentation.ts
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
```

- [ ] **Step 4: Create the client config**

```typescript
// instrumentation-client.ts
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,
    environment: process.env.NODE_ENV,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

- [ ] **Step 5: Wrap `next.config.ts` with `withSentryConfig`**

In `next.config.ts`, add the import at the top (after line 2 `import path from "path";`):

```typescript
import { withSentryConfig } from "@sentry/nextjs";
```

Then replace the final line:

```typescript
export default nextConfig;
```

with:

```typescript
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  // Source maps are uploaded only when an auth token is present (CI/prod).
  // Local builds without SENTRY_AUTH_TOKEN skip upload gracefully.
});
```

- [ ] **Step 6: Typecheck**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors in the new Sentry files or `next.config.ts`.

- [ ] **Step 7: Commit**

```bash
git add instrumentation.ts instrumentation-client.ts sentry.server.config.ts sentry.edge.config.ts next.config.ts
git commit -m "feat(obs): wire Sentry (DSN-gated, PII-scrubbed) for server/edge/client"
```

---

## Task 8: Document env vars

**Files:**
- Modify: `env.example`

- [ ] **Step 1: Add the new variables**

Append to `env.example` (the `SENTRY_DSN` block already exists — add the client DSN + PostHog):

```bash
# Sentry browser DSN (required for client-side error capture)
NEXT_PUBLIC_SENTRY_DSN=

# PostHog (product analytics + session replay; consent-gated)
# Get from: https://posthog.com → Project Settings
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

- [ ] **Step 2: Commit**

```bash
git add env.example
git commit -m "docs(env): document PostHog + client Sentry env vars"
```

---

## Task 9: Linear setup checklist (ops, non-code)

**Files:**
- Create: `docs/superpowers/plans/2026-06-11-linear-setup-checklist.md`

- [ ] **Step 1: Write the checklist**

```markdown
# Linear Setup Checklist (manual, ops)

- [ ] Create Linear workspace / confirm team(s): Engineering, Ops.
- [ ] Connect GitHub integration; enable PR/branch auto-linking (matches branch names like `feat/instagram-channel`).
- [ ] Create projects: "Launch Readiness", "Incidents", "Compliance".
- [ ] Define severity labels: `sev1` (outage), `sev2` (degraded), `sev3` (minor), `bug`, `compliance`.
- [ ] Create a bug-intake issue template (steps to reproduce, expected, actual, env).
- [ ] Set triage workflow: new issues → Triage → Backlog/Todo → In Progress → Done.
- [ ] Import the P0/P1/P2 items from `docs/superpowers/specs/2026-06-11-launch-readiness-checklist-design.md` as issues under "Launch Readiness".
- [ ] (Optional) PostHog → Linear and Sentry → Linear integrations so issues can be created from events/errors.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-11-linear-setup-checklist.md
git commit -m "docs(ops): add Linear setup checklist"
```

---

## Task 10: Full suite verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx jest --silent 2>&1 | tail -25`
Expected: all previously-passing tests still pass + the new consent/analytics tests (Tasks 2–5) pass. No regressions.

- [ ] **Step 2: Typecheck once more**

Run: `NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors from any file created/modified in this plan.

---

## Self-Review (completed during authoring)

- **Spec coverage:** 4.4 consent gate → Tasks 2, 5, 6. 5.4 PostHog (consent-gated, replay-capable, EU host configurable) → Tasks 1, 3, 4. 5.3 Sentry (wired, PII-scrubbed) → Tasks 1, 7, 8. 5.5 Linear → Task 9. DSAR/AI-disclosure/Meta/legal docs are explicitly out of this slice.
- **Placeholder scan:** none — every code step contains full code; every command has expected output.
- **Type consistency:** `ConsentState`, `getConsent`, `hasDecided`, `hasAnalyticsConsent`, `setConsent`, `onConsentChange` defined in Task 2 and consumed unchanged in Tasks 3–5. `AnalyticsEvent`/`ANALYTICS_EVENTS` defined in Task 3 and consumed in its own test. Storage key `boka_consent_v1` identical across store + banner test.
- **Open follow-ups (next slices, not this plan):** SPA pageview capture hook, PostHog session-replay PII masking config, `/cookies` + `/privacy` pages (the banner links to `/cookies`), DSAR, AI disclosure, Meta opt-in.
```