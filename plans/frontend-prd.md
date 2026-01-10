You want the PRD. I used your uploaded Product Requirements Document as the source and turned it into a polished, ready-to-use PRD for Booka dashboards. You're welcome. Now go build it. 

# Product Requirements Document — Booka Dashboards

## 1. Purpose

Create a modular, tenant-configurable frontend component library and set of dashboard pages for Booka that enable chat-first appointment management and schedule management. The UI must be minimalist, fast, mobile-first, accessible (WCAG AA), testable, and reusable across tenants.

*(Source: consolidated from uploaded PRD).* 

## 2. Success metrics (definition of done)

* All pages implemented using a shared component library (no one-off UI hacks).
* Calendar and List views render identical booking data and remain fully interactive: drag-to-reschedule, inline edits, bulk actions.
* End-to-end booking creation/edit flows including payment/deposit link flow functional with backend API.
* Chat-first composer and thread show conversational flows, structured quick actions (Confirm, Reschedule, Pay).
* Storybook stories for every component + unit tests for components and E2E tests for main flows.
* Accessibility: core flows meet WCAG AA.
* Test coverage for critical components ≥ 70% and E2E tests for booking, reschedule, chat, payment.

## 3. Target users & roles

* **Owner / Admin:** full access to dashboards, staff, settings, billing.
* **Manager:** view/edit bookings, staff scheduling, client notes.
* **Receptionist / Staff:** view assigned schedule, mark attendance, handle chats.
* **Read-only viewer:** dashboards only.

Components must accept a `role` prop or be wrapped by an ACL HOC to hide actions by permission.

## 4. Scope: pages & primary flows

* **Dashboard Home**

  * KPI cards (MRR, bookings today, no-show rate, deposit conversion).
  * Recent activity feed (booking.created, payment.received).
  * Quick actions: New booking, Broadcast, View calendar.

* **Schedule (Calendar view)**

  * Month/Week/Day toggles.
  * Staff lanes (day/week).
  * Drag & drop appointments between slots/staff.
  * Tap event → open side panel with booking details + chat thread.

* **Schedule (List view)**

  * Filterable/sortable table (date, staff, service, status).
  * Inline edit for status; quick actions (reschedule, cancel, mark paid).
  * Bulk actions: reminders, export CSV.

* **Client Profile**

  * Contact channels (WhatsApp, email), consent toggles.
  * Booking history timeline, notes, preferences, asset gallery.
  * Quick-create booking, refund/credit actions.

* **Staff Page**

  * Staff list, roles, working hours, skills.
  * Individual staff calendar + metrics (bookings/week, utilization).
  * Assign/unassign bookings.

* **Booking Flow**

  * Conversational micro-flow (date → time → service → staff → payment).
  * Payment/deposit via PSP link and webhook state handling.
  * Post-confirm drawer with WhatsApp template preview + send.

* **Chat Thread (Customer)**

  * Thread with message bubbles (channel icons), suggestions, quick actions (Confirm, Reschedule, Pay, Upload).
  * Compose supports attachments, templates, smart suggestions.
  * Escalation to human or premium LLM (tenant/quota gated).

## 5. Component inventory (exported from `@booka/ui`)

All components must be TypeScript-first, prop-driven, documented in Storybook and easily mockable.

Key components (non-exhaustive):

* Layout: `AppShell`, `Topbar`, `SideNav`
* Dashboard: `KpiCard`, `ActivityFeed`, `QuickActionButton`
* Schedule/Calendar: `Calendar`, `EventCard`, `MiniMonthPicker`
* List/Table: `BookingsTable`, `FilterBar`, `Pagination`
* Booking: `BookingComposer`, `BookingSidePanel`, `QuickBookingButton`
* Client: `ClientHeader`, `ClientTimeline`, `ClientNotesEditor`, `AssetGallery`
* Staff: `StaffList`, `StaffCard`, `StaffSchedule`
* Chat: `ChatThread`, `ChatComposer`, `MessageBubble`, `QuickActionsMenu`
* Primitives: `Modal`, `Drawer`, `SidePanel`, `Button`, `Input`, `Select`, `DatePicker`, `TimePicker`, `Switch`, `Badge`, `Toast`

### Component contracts & behavior

* `Calendar` props: `{ view: 'month'|'week'|'day', events[], staffLanes?, onEventDrop, onEventClick }`
* `BookingComposer` emits micro-turn events and final `onComplete(booking)`. Should support optimistic UI for payment initiation events.
* `ChatComposer` returns a Promise on `onSend()` to indicate server ack; use optimistic rendering.

## 6. Data shapes & frontend→backend API contracts

Frontend teams will rely on these endpoint contracts and response shapes.

Primary endpoints:

* `GET /tenant/:id/metrics` → KPIs
* `GET /locations/:id/bookings?start=&end=&staff=&status=` → bookings list
* `POST /bookings` → create booking (supports conversational context & metadata)
* `PATCH /bookings/:id` → update booking
* `POST /bookings/:id/actions` → actions: confirm, cancel, reschedule, mark_paid
* `GET /bookings/:id/messages` → chat thread for booking
* `POST /bookings/:id/messages` → send message (body: channel, text, attachments)
* `GET /clients/:id` → client profile & history
* `POST /payments/create-link` → returns { paymentLink, id }
* `GET /staff` → list staff & availability
* `PATCH /staff/:id/availability` → toggle availability

Booking event shape example:

```ts
type BookingEvent = {
  id: string;
  tenantId: string;
  locationId: string;
  serviceId: string;
  start: string; // ISO
  end:   string; // ISO
  status: 'requested'|'confirmed'|'completed'|'cancelled'|'no_show';
  customer: { id: string; name: string; phone?: string; email?: string };
  staffId?: string;
  metadata?: Record<string, any>;
}
```

Error format:

```json
{ "code": "string", "message": "string", "details": {...}? }
```

## 7. State management & caching

* Use React + TypeScript.
* Data fetching: React Query (TanStack Query) or SWR.
* Use optimistic updates for bookings and messages.
* Conversation state: store ephemeral UI state client-side; persist drafts to `localStorage`. If supported by backend, store conversation drafts in Redis-backed session.
* Calendar: range-based queries, viewport fetching, debounce & batch updates for drag events.
* Virtualize long lists (react-window/react-virtual) where appropriate.

## 8. Styling & design system

* Theme object: `{ colors, spacing, typography, radii }`, single tenant accent color.
* Tailwind-compatible tokens or CSS-in-JS allowed.
* Minimalist aesthetic: neutral palette, single accent color per tenant.
* Animations: subtle, between 80–200ms; respect reduced-motion accessibility.
* Components accept `className` and `style` for overrides.

## 9. Accessibility & Internationalization

* Keyboard support and ARIA for calendar drag/drop and list actions.
* Focus management on modals/drawers.
* All images must include `alt` text; attachments must be accessible.
* Timezones: display default tenant timezone; allow user local timezone toggle. Always use ISO timestamps from backend.
* I18n-ready: use message keys (i18next or similar), avoid hard-coded strings.

## 10. Testing & Storybook

* Storybook with stories for every component, covering states: empty, loading, success, error.
* Unit tests: Jest + React Testing Library.
* E2E tests: Cypress or Playwright for core flows: booking create, reschedule, chat send, payment link click.
* Accessibility tests: axe-core integrated in CI for critical flows.

## 11. Performance & offline behavior

* Lazy-load heavy modules (calendar).
* Virtualize long lists.
* Chat offline support: queue messages, allow drafting, show offline banner and retry logic.
* Hydration strategy: server-side render shell; hydrate dynamic parts client-side as needed.

## 12. Error handling & edge cases

* Human-friendly error messages with retry actions.
* Payment flow states: pending → success → failed (with retry).
* If WhatsApp message fails, offer fallback (email/SMS).
* Booking conflict: surface conflicting events and suggest alternatives; allow Admin-only “Force override”.
* Network races on drag/drop: debounce and present conflict resolution UI if backend rejects change.

## 13. Deliverables

* `@booka/ui` component package (TSX) with documented exports.
* Pages: Dashboard, Schedule (Calendar + List), Client Profile, Staff, Booking flow, Chat thread.
* Storybook with documented stories.
* Unit & E2E test skeletons and sample tests.
* Mock server or MSW handlers for all API endpoints with realistic mock data.
* README and developer usage examples.
* Example folder structure and starter hooks (`useBookings`, `useCalendar`, `useClient`).

## 14. Mock data & examples

Include copy/paste-ready mock data for developer onboarding (example booking, message objects, etc.). Use the timestamp examples and message shapes in the source PRD for rapid prototyping. 

## 15. Acceptance criteria (to ship)

* Core pages render with mock data; calendar/list toggle functions.
* BookingComposer completes and calls `onComplete` producing a booking object.
* Chat thread supports optimistic send and updates status on server ack.
* Drag-and-drop reschedule issues PATCH `/bookings/:id` and UI reflects change without reload.
* Storybook complete and critical components test coverage ≥ 70%.

## 16. Recommended implementation roadmap (developer checklist)

1. Scaffold `@booka/ui` package + Storybook.
2. Implement primitives: `KpiCard`, `BookingEventCard`, `ChatComposer`.
3. Build `Calendar` page with mock data and event click behavior.
4. Implement `BookingComposer` micro-flow, wire to mock API.
5. Implement chat thread with optimistic messaging + inbound updates.
6. Add ClientProfile and Staff pages.
7. Hook up auth and real API endpoints.
8. Add tests and accessibility checks; finalize docs.

---

### Notes / Next steps for the team

* Provide API contract mocks or a mock server (MSW) as early priority so frontend can run independently.
* Decide on real-time transport: WebSocket, SSE, or polling for inbound messages and booking webhook events; document chosen approach and include client reconnection strategy.
* Confirm payments PSP & webhook flow details with backend (idempotency, webhook retries).
* Finalize tenant theming payload and role/ACL model to drive UI component behavior.

---

