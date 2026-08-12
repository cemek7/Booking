# Booka Product UI Surface Audit

Date: 2026-08-12  
Scope: rendered Booka product interfaces only. This is not an infrastructure or
database audit. Findings were grounded against `src/app/**/page.tsx`, dashboard
navigation, Settings components, and the owner/customer-facing components they
render.

## Rules for using this backlog

- A setting must have a clear owner-facing explanation, current state, and a
  visible result after saving.
- Prefer extending a canonical surface over creating a second page for the same
  concept.
- Do not present a control as active when its backend behaviour is pending.
- Each build item needs a route/API check and a small UI regression test where
  practical.

## P0 — clarity and trust gaps

### 1. Consolidate the Settings experience

**Evidence:** `/dashboard/settings` renders `CapabilitiesCard`, `PublicLinksCard`,
`SettingsWorkspace`, `CalendarSettings`, and `TenantSettingsHost` together.
`SettingsWorkspace` and `TenantSettingsClient` both edit overlapping business,
booking, payment, public-page, and profile settings.

**User problem:** an owner has to know which of several cards owns a setting and
can see the same business concept in multiple places.

**UI addition:** one Settings information architecture:

```text
Business | Bookings | Team | AI & Knowledge | Channels | Storefront | Payments | Security | Data
```

Move the existing cards into those sections, retain deep-link tabs, and remove
duplicated inputs only after the canonical replacement is live.

### 2. Channel health and automation status

**Evidence:** the Meta WhatsApp and Instagram cards show only connection status;
the customer-message pipeline has several operational states that are otherwise
visible only in logs. WhatsApp now has an AI reply toggle, but owners cannot see
whether a message was received, queued, handled by a human, spend-capped, or
failed at the AI provider.

**UI addition:** a compact status card in **Settings → Channels** and a link from
Chats:

- each connected channel, number/account label, and connection state;
- AI replies: enabled / paused / human handling / unavailable;
- last inbound, last outbound, last successful reply, and last redacted error;
- queue state and a safe “test connection” action for owners;
- Meta template/24-hour-window guidance where relevant.

### 3. Inbox operational context

**Evidence:** `ChatsPanel` renders `Avg Response Time` as a permanent `—`.
The inbox supports channel, assignment, escalation, and human takeover but does
not visibly explain the current automation state on the conversation list.

**UI addition:**

- replace the placeholder with a real metric or remove it until data exists;
- show AI/human ownership, handoff expiry, and reply eligibility in the thread;
- add clear filters for “needs a human”, “AI paused”, and “reply failed”; and
- show a short next action for each blocked state.

### 4. Storefront editor after onboarding

**Evidence:** onboarding writes `storefront`, `operationalMemory`, and
`campaignDefaults`; the public storefront renderer supports blocks, campaigns,
service/product grids, reviews, FAQs, gallery, staff, and CTA configuration.
The Settings UI provides links but no editor for that composition.

**UI addition:** **Settings → Storefront** with:

- live preview plus draft/publish state;
- hero copy, CTA, visible blocks, services/products featured, and campaign;
- preview/share links and basic conversion summaries;
- safe defaults generated from onboarding rather than an empty builder.

## P1 — owner controls that need a complete UI

### 5. WhatsApp messaging policy panel

**Evidence:** `WhatsAppSyncSection` exposes owner-alert switches, template
consent, and a monthly Meta budget in one dense card.

**UI addition:** split into clear subsections:

- **Customer replies** — AI pause/resume and human takeover policy;
- **Owner notifications** — booking, cancellation, daily/weekly summaries;
- **Proactive messages and cost** — template consent, current spending, cap,
  and a plain-language explanation of what is chargeable.

Show an explicit “not active yet” badge for any control whose enforcement is
not yet shipped; do not leave it looking live.

### 6. Instagram channel settings

**Evidence:** an Instagram OAuth connection card exists; the adjacent channel
form captures handle, profile URL, goal, and `useDmReplies`, but the owner gets
no post-connect view of message eligibility or current reply policy.

**UI addition:** after connection, show account identity, 24-hour reply-window
guidance, AI reply toggle, last webhook activity, reconnect/disconnect, and
one clear “DM goal” control. Avoid presenting the handle/profile form as an
integration substitute.

### 7. AI front-desk control centre

**Evidence:** Agent settings include identity, language, FAQs, lead capture,
business hours, and voice settings; usage/billing and AI metrics are separate
pages.

**UI addition:** a single AI status strip within **AI & Knowledge**:

- current reply mode and selected platform provider health (not credentials);
- business-hours behaviour and out-of-hours preview;
- knowledge readiness: service count, FAQ count, missing information;
- lead-capture status and follow-up policy;
- link to AI usage/cost, plus the cause when replies are unavailable.

### 8. Voice feature readiness

**Evidence:** Agent settings expose voice-note, calls, TTS/STT provider, voice,
and reply-mode controls. The voice-call route checks whether calls are enabled.

**UI addition:** a gated **Voice** card with provider availability, phone/room
readiness, test action, and clear plan eligibility. Hide or label unavailable
controls instead of showing an apparently usable configuration.

### 9. Public booking and deposits consolidation

**Evidence:** `TenantSettingsClient` contains the public-booking and deposit
controls while `SettingsWorkspace` hosts other business settings and Paystack
details.

**UI addition:** one **Bookings & payments** surface combining public booking
availability, booking windows, deposit percentage, cancellation policy,
collection-account status, and a customer-facing preview of the booking flow.

## P2 — workflow and navigation improvements

### 10. Guided first-week checklist

**Evidence:** onboarding collects business, channels, capabilities, and
storefront data, but the post-onboarding dashboard has no visible launch
checklist tying these pieces together.

**UI addition:** a dismissible owner checklist:

```text
Add services → set business hours → connect a channel → enable AI replies
→ publish/share storefront → run a test booking
```

Each item should deep-link to the canonical Settings/operation surface.

### 11. Workflow-oriented dashboard navigation

**Evidence:** the owner navigation contains a large set of pages spanning
bookings, sales, inventory, CRM, chat, intelligence, support, and settings.
Capabilities hide items, but the initial navigation still asks a new owner to
understand Booka’s internal modules.

**UI addition:** preserve existing pages but organize the owner experience as:

```text
Today | Customers | Sell & book | Messages | Grow | Settings
```

Use the selected commercial motion to prioritise the appropriate entry points.

### 12. Actionable empty states across core workflows

**Evidence:** the product has distinct lists for bookings, services, products,
orders, customers, leads, chats, and tasks. Their first-use path is fragmented.

**UI addition:** standardised empty states that explain the first action and
cross-link the prerequisite (for example: no services → Add service; no
WhatsApp connection → Connect channel; no customer message → Share storefront).

### 13. Customer 360 entry point

**Evidence:** customer, bookings, leads, chats, orders, and support are separate
surfaces. `ChatContextPanel` provides partial conversation context but it is not
the owner’s durable customer workspace.

**UI addition:** a customer profile with bookings, purchases, conversation,
lead stage, payment history, notes, consent, and next task in one place.

### 14. Campaign creation versus campaign operations

**Evidence:** `/dashboard/ops` exposes escalation/campaign queue management and
retry actions, while storefront rendering can show promotions. There is no
obvious owner campaign-creation surface in the primary navigation.

**UI addition:** a guided campaign composer with audience, objective, template
eligibility/cost confirmation, schedule, preview, and post-send results. Keep
the existing Ops surface as the operational/retry view.

### 15. Operational intelligence explained for owners

**Evidence:** Booka has AI metrics, usage, analytics, reports, anomalies, close
reports, and an Ops centre. These are strong capabilities but distributed across
many route-level pages.

**UI addition:** an owner **Today** page with only actionable cards: bookings
at risk, unanswered conversations, low stock, payments requiring attention,
and one next-best action. Link through to the specialist pages.

## Separate engineering backlog retained from the earlier audit

These are not UI findings but must accompany the relevant UI controls so Booka
does not present a non-working switch:

- enforce WhatsApp template consent, spend caps, and owner-alert preferences;
- enforce Instagram DM reply preference in the pipeline;
- audit server-side capability enforcement for every gated workflow route;
- verify voice-note/audio-reply end-to-end enforcement;
- expose redacted channel/AI health data to support the UI status cards.

## Recommended delivery sequence

1. Finish staging AI/channel smoke tests.
2. Build the canonical **Channels + Automation Status** surface and associated
   enforcement in one slice.
3. Consolidate Settings around the new information architecture.
4. Add Storefront editor and post-onboarding checklist.
5. Improve inbox context and customer 360.
6. Add campaign composer and owner Today view.
