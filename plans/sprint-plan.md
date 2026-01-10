# Booka Sprint Plan (Phase Roadmap)

Generated: 2025-11-14
Scope Reference: Frontend PRD + Dev Plan v1.1
Cadence: 2-week sprints (10 working days). Each phase builds incrementally toward full PRD delivery.

## Sprint 1 — Navigation, Layout & Foundations
Tasks:
1. Sidebar & AppShell alignment (Dashboard, Schedule, Clients, Staff, Chat, Settings, Select Business).
2. Settings tab consolidation (single /settings with internal tabs).
3. Schedule page calendar/list toggle + staff lanes control.
4. Remove calendar from Dashboard; retain KPIs only.
5. Add active link styling & role gating (hide Staff for non-manager/staff restrictions).
6. Tech debt cleanup: unify role retrieval, remove unused imports.
Exit Criteria:
- Navigation stable for owner/manager/staff.
- Schedule supports calendar vs list view toggle.
- Dashboard free of scheduling UI.

## Sprint 2 — Booking Data & Reschedule Conflicts
Tasks:
1. Implement range-based bookings fetch (start/end/staff filters) replacing naive /api/reservations fetch.
2. Add React Query keys: ['bookings', locationId, start, end].
3. Conflict surface: on 409 show blocking modal listing conflicting bookings with alternative suggestions.
4. Enhance BookingComposer with idempotency key + status progression requested→confirmed.
5. Add Zod validation on booking create/reschedule payloads (client + API).
Exit Criteria:
- Accurate filtered bookings load per range.
- 409 conflicts produce user-visible resolution UI.
- Composer produces valid booking transitions.

## Sprint 3 — Chat Thread & Realtime Hardening
Tasks:
1. WebSocket client (retry, backoff, online/offline indicator).
2. ChatThread optimistic send status: pending → delivered/failure with retry.
3. Merge realtime events: booking.updated, message.created, payment.updated.
4. Accessibility pass: focus management in composer & side panel.
5. Add message attachments (UI stub + backend contract alignment).
Exit Criteria:
- Realtime resilient to disconnects.
- Chat messages reliably reflect delivery state.
- Keyboard navigation and focus visible across chat & composer.

## Sprint 4 — Client & Staff Detail Surfaces
Tasks:
1. Client profile page skeleton (history, notes, contact channels).
2. Staff detail with availability editor & utilization metrics.
3. Implement staff availability PATCH flow + optimistic UI.
4. Inline booking staff reassignment (drag to staff lane or dropdown).
5. Add tenant timezone indicator across schedule & booking panels.
Exit Criteria:
- Client & staff pages functional with live data.
- Availability edits persist & reflect realtime updates.

## Sprint 5 — Settings & Security Enhancements
Tasks:
1. Wire /tenants/:tenantId/settings GET/PATCH.
2. Business services editor (create/update durations, price, skill mapping).
3. Security tab: role assignment UI + MFA enrollment stub.
4. Add environment secret guards (missing secret surfaces actionable message).
5. Add theme toggle + tokens consolidation.
Exit Criteria:
- Settings tabs persist real data.
- Service catalog fully editable.
- Role changes reflect across UI (navigation + permissions).

## Sprint 6 — Payments & Deposit Flow
Tasks:
1. Payment link creation integration + display status in booking side panel.
2. Polling vs realtime updates for payment status with fallback.
3. Deposit conversion KPI real data pipeline.
4. Error/retry for failed payments (manual retry trigger).
5. Add payment events caching & optimistic status transitions.
Exit Criteria:
- Deposit flow visible & reliable.
- KPI cards reflect real data for conversion metrics.

## Sprint 7 — Testing & Storybook Coverage
Tasks:
1. Storybook stories for Calendar, BookingComposer, BookingSidePanel, ChatThread, Settings tabs.
2. Unit tests (≥70% coverage critical components).
3. E2E tests: booking create, reschedule conflict, chat send, payment link life cycle.
4. Accessibility automated checks (axe) in CI.
5. Visual regression baseline (optional) for key pages.
Exit Criteria:
- CI green with coverage thresholds.
- Storybook published & documented.

## Sprint 8 — Performance & Polish
Tasks:
1. Virtualize list view (reservations / clients) for large datasets.
2. Lazy-load heavy calendar & chat modules.
3. Debounce drag/drop reschedule network calls.
4. Optimize websocket event fan-out (batch updates).
5. Final accessibility audit (contrast, ARIA roles, calendar cells).
Exit Criteria:
- Smooth performance under high booking volume.
- Accessibility audit passes (WCAG AA core flows).

## Backlog / Stretch
- Internationalization (i18n keys extraction).
- Force override admin reschedule (conflict bypass).
- Advanced analytics charts & trend projections.
- LLM context integration & prompt management UI.

## Risk & Mitigation
- Unstable API contracts: Mitigate with typed adapters + Zod schemas.
- Realtime disconnects: Backoff & offline queue for chat/booking ops.
- Payment webhook delays: Fallback polling strategy documented.

## Metrics & Tracking
- Coverage % (Jest).
- Booking creation latency (ms avg). 
- Realtime reconnect success rate.
- Conflict resolution success ratio (resolved vs overridden).

## Acceptance Criteria Summary
Delivery considered complete when all sprint exit criteria met and PRD acceptance list satisfied (calendar drag, conflict UX, chat optimistic, payment flow, settings persistence, Storybook + tests, accessibility).

---
This roadmap is iterative; update per sprint retrospective outcomes.
