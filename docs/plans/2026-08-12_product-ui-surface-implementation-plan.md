# Booka Product UI Surface Implementation Plan

Date: 2026-08-12  
Companion audit: `docs/plans/2026-08-12_product-ui-surface-audit.md`  
Release branch: `staging`

## Objective

Turn Booka's existing product capability into a coherent owner experience. Every
control must state what it governs, show its current state, and be enforced by
the live backend before it is presented as active.

This plan deliberately does not add a generic “settings redesign” first. It
ships vertical slices that make the live WhatsApp/Instagram AI front desk
testable, understandable, and safe, then consolidates the surrounding UI.

## Delivery principles

1. Build on the current canonical routes; do not replace working pages merely
   to improve navigation.
2. Each owner control ships with API validation, tenant scoping, runtime
   enforcement, error state, and a focused regression test.
3. Make state observable in the UI. Do not require owners to inspect logs.
4. Preserve existing deep links and redirects while the Settings layout is
   consolidated.
5. Use feature flags only for incomplete or provider-dependent functionality;
   labels must say “coming soon” or “not configured”, never imply activation.
6. All migrations remain additive, plaintext, reviewable, and run by the user.

## Phase 0 — Release and configuration baseline

### Scope

- Deploy the green staging image for `3479998`.
- Configure the staging v2 provider policy as Cloudflare first, OpenRouter
  second, with Google disabled:

  ```env
  WHATSAPP_V2_AI_PROVIDER=auto
  WHATSAPP_V2_DISABLE_GOOGLE=true
  CLOUDFLARE_ACCOUNT_ID=...
  CLOUDFLARE_AI_API_TOKEN=...
  CLOUDFLARE_AI_DEFAULT_MODEL=@cf/meta/llama-3.1-8b-instruct
  ```

- Run a customer-initiated Meta test-number message through the staged tenant.

### Acceptance criteria

- The staging health endpoint returns 200.
- Log/report shows Cloudflare as the first attempted provider; OpenRouter is
  used only when Cloudflare fails.
- The tenant’s enabled agent replies once, or the UI/log reports the exact
  redacted reason it did not.
- No credential, WABA, phone ID, or access token is shown in any UI/log report.

## Phase 1 — Channels and Automation Status (P0)

### Owner surface

Add a canonical **Settings → Channels** control centre, starting from:

- `src/components/settings/MetaWhatsAppConnectSection.tsx`
- `src/components/settings/InstagramConnectSection.tsx`
- `src/components/settings/WhatsAppSyncSection.tsx`
- `src/components/settings/SettingsWorkspace.tsx`

Each channel card shows:

- connection state and identified account/number (redacted/public ID only);
- AI reply state: enabled, paused, human handling, spend-capped, unavailable;
- last inbound, last successful outbound, last failure category and time;
- Meta 24-hour window/template guidance where applicable;
- reconnect/disconnect and a safe owner test action;
- a direct link to affected Chats.

### Backend work

- Add a tenant-scoped, authenticated channel-health endpoint that aggregates
  `whatsapp_configurations`, connection state, queue counts, recent
  conversation/message timestamps, and redacted failure categories.
- Never return provider tokens, raw webhook payloads, customer message bodies,
  or internal-only Meta events.
- Define a shared automation-status resolver so WhatsApp and Instagram use the
  same vocabulary.
- Enforce the existing Instagram `useDmReplies` preference in the Instagram
  pipeline before the UI declares it active.

### Tests

- owner can read only its tenant’s health;
- superadmin can read an explicitly selected tenant;
- secrets/raw content never appear in response;
- UI renders connected, paused, unavailable, and error states;
- Instagram pause prevents outbound AI reply.

### Acceptance criteria

An owner can answer “is this channel connected, is AI replying, and why not?”
without VPS access.

## Phase 2 — Messaging policy and safe outbound controls (P0)

### Owner surface

Split the current dense WhatsApp card into:

1. **Customer replies** — AI enable/disable, human takeover explanation.
2. **Owner notifications** — booking, cancellation, daily and weekly alerts.
3. **Proactive messages and cost** — template consent, current spend, monthly
   cap, and a plain-language charge explanation.

### Backend work

- Centralise outbound policy evaluation before a send.
- Enforce `templateMessagingEnabled`, `paidTemplateConsent`, and the tenant
  Meta spend cap for business-initiated templates.
- Enforce owner alert preferences at each alert call site.
- Provide a decision result (`allowed`, `blocked_by_consent`, `blocked_by_cap`,
  `outside_service_window`, etc.) for the channel-health UI and audit log.
- Do not treat service-window replies as template sends or artificially avoid
  Meta charges; display honest eligibility and consent requirements.

### Tests

- proactive send is blocked without consent;
- proactive send is blocked at cap;
- customer-initiated service-window reply remains eligible;
- disabled alert preference prevents only that notification;
- tenant A policy cannot affect tenant B.

### Acceptance criteria

Every displayed messaging switch has observable, server-side effect.

## Phase 3 — Inbox clarity and human handoff (P0/P1)

### Owner/staff surface

Extend:

- `src/components/chat/ChatsPanel.tsx`
- `src/components/chat/ChatContextPanel.tsx`
- `src/components/chat/EscalationBanner.tsx`

Add:

- real average first-response metric, or remove the placeholder until it is
  available;
- conversation ownership state: AI, assigned human, handoff expiry, paused;
- filters for needs-human, reply-failed, AI-paused, and channel;
- a visible, safe “resume AI” action after human takeover expires/releases;
- explanation for why the composer/outbound action is unavailable.

### Backend work

- Query aggregate response metrics with tenant scope.
- Reuse the automation-status resolver from Phase 1.
- Ensure assignment/release/resume actions are role checked and audited.

### Acceptance criteria

Staff can triage unanswered conversations and understand the next action from
the inbox alone.

## Phase 4 — Canonical Settings IA (P1)

### Target information architecture

```text
Business | Bookings | Team | AI & Knowledge | Channels |
Storefront | Payments | Security | Data
```

### Migration path

- Use `SettingsWorkspace` as the navigation shell.
- Move the unique sections of `TenantSettingsClient`, `CapabilitiesCard`,
  `PublicLinksCard`, and `CalendarSettings` into the appropriate tabs.
- Retain `/settings/*` redirect compatibility and existing query-tab links.
- Do not delete the old component until all its fields appear in a tested
  canonical tab and persistence remains unchanged.

### Acceptance criteria

An owner sees each setting exactly once and can find it through a clear label.

## Phase 5 — Storefront and launch experience (P1)

### Owner surface

Add **Settings → Storefront**:

- draft/live preview;
- hero copy, public description, primary CTA, visible sections;
- featured services/products, FAQ/reviews/staff visibility, active promotion;
- share links and basic conversion metrics;
- public booking availability and deposit preview.

Add a dashboard **Launch checklist**:

```text
Services → Business hours → Channel → AI replies → Storefront → Test booking
```

### Backend work

- Use existing storefront config types and public-storefront renderer.
- Add server-validated config patches; restrict block identifiers to known
  renderer blocks.
- Expose only tenant-safe conversion summaries.

### Acceptance criteria

Post-onboarding owners can revise their customer-facing page without support or
another onboarding run.

## Phase 6 — Customer 360 and campaign creation (P2)

### Customer 360

Add a shared customer view reachable from Customers, Chats, Leads, Orders, and
Bookings. It combines customer identity, consent, conversations, bookings,
purchases, lead stage, payment history, notes, and next task.

### Campaign composer

Keep `/dashboard/ops` for execution/retry. Add a separate owner campaign
composer with audience, purpose, channel/template eligibility, cost consent,
scheduling, preview, and result summary.

### Acceptance criteria

Owners create campaigns deliberately and staff stop moving between unrelated
pages to understand one customer.

## Phase 7 — Voice and capability audit (P2)

- Surface voice provider/readiness/plan status alongside current voice settings.
- Test voice note and outbound audio behaviour against `reply_with_audio`.
- Audit every capability-hidden workflow route for matching server enforcement.
- Add owner-facing “not available for this plan/configuration” states.

## Release process for every phase

1. Build a single vertical slice in its own branch/worktree.
2. Add focused API, tenant-isolation, and UI tests.
3. Run `npm run typecheck:ci`, relevant Jest tests, lint, and `git diff --check`.
4. Self-review schema, auth, secret exposure, and tenant scope.
5. Rebase on current `origin/staging`, re-run focused gates, push a small
   staging commit.
6. Wait for full GitHub CI/Docker image success.
7. Deploy pinned staging image and run a real smoke test.
8. Promote only reviewed, pinned staging commits to production.

## Suggested first implementation slice

Start with **Phase 1: Channels and Automation Status**, initially WhatsApp
only. It turns the Meta staging test into an owner-visible workflow and creates
the reusable status contract needed by Instagram and the inbox.
