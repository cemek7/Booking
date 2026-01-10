Good. You want a rock-solid, production-ready frontend PRD that an agent can pick up and implement — no mock data, no hand-waving, just precise components, API contracts, roles, flows, tests, and acceptance criteria. I’ll give you that in a compact, dev-friendly package. Try not to break it in review.

# Booka — Frontend PRD (Agent-ready, production-focused)

Scope: Build modular, importable React + TypeScript UI components and pages for Booka dashboards that implement chat-first appointment management and schedule management. Includes Super-Admin (platform) and Tenant (Owner, Manager, Staff) dashboards. No mock data; every component talks to the real API endpoints defined below.

---

# 1 — High-level requirements

* Minimalist, responsive UI; accessible (WCAG AA) and mobile-friendly.
* Modular component library (`@booka/ui`) exportable for reuse. Components must be pure, well-typed, and configurable via props.
* Real-data driven: every page/component must load live data via provided API endpoints (no mock mode). Use optimistic UI only when safe.
* Multi-role support: Super-Admin (platform-wide controls), Tenant Owner (full tenant control), Manager (operations), Staff (day-to-day). ACL enforced client-side and server-side.
* Chat-first UX: chat composer + thread integrated into booking side panels. Micro-turn conversational booking composer (slot-by-slot) integrated with booking API.
* Schedule: Calendar (month/week/day with staff lanes) + List view with inline actions and bulk operations. Drag-to-reschedule supported.
* Client profiles: contact channels, booking history, notes, assets.
* Staff pages: availability, shift management, utilization metrics.
* Payment flow: present PSP payment link and poll for status; UI reflects payment webhook updates.

---

# 2 — Tech stack (recommended)

* React + TypeScript (hooks + functional components)
* Next.js (app router) or Vite + React Router — pick the one your infra prefers. Pages should be server-side rendered where helpful for SEO for public endpoints, otherwise CSR.
* Styling: Tailwind CSS (utility-first) or CSS-in-JS (styled-components/emotion). Provide theme tokens.
* State & data fetching: React Query (TanStack Query) for server cache + optimistic updates.
* Real-time: WebSocket / Server-Sent Events for live messages & booking updates. Fallback to polling.
* Forms & validation: React Hook Form + Zod (or JSON Schema) for intake validation.
* Drag & drop: react-beautiful-dnd or modern alternative supporting accessibility.
* Calendar: FullCalendar or custom lightweight calendar with virtualization; must support staff lanes.
* Components packaged as an npm package (`@booka/ui`) for reuse.
* CI: GitHub Actions for builds, tests, storybook publish.
* E2E: Playwright or Cypress.
* Storybook for component catalog + live API stories (use environment variables for API base).

---

# 3 — Roles & permissions (client + server must enforce)

* **Super-Admin**

  * Tenant management (create/suspend/upgrade tenants)
  * Global configs, provider keys, billing overview, system logs, usage quotas
* **Tenant Owner**

  * Full tenant settings, billing, user invite, staff management, module install
* **Manager**

  * View/edit bookings, staff schedules, client records, analytics for location(s) they manage
* **Staff**

  * View assigned bookings, accept/reject, chat with clients, mark complete/no-show
* ACL patterns: components accept `userRole` prop; pages call `GET /auth/me` at mount and guard routes. UI must hide forbidden actions; API returns 403 for protected actions.

---

# 4 — Pages & UI surface (must implement)

* Super-Admin Dashboard (platform usage, tenant list, tenant status, system logs)
* Tenant Dashboard Home (MRR, bookings today, no-show rate, deposit conversion, quick actions)
* Schedule — Calendar View (month/week/day, staff lanes, drag-to-reschedule)
* Schedule — List View (filters, sorting, pagination, bulk actions)
* Booking Detail SidePanel (booking info + chat thread + actions)
* Booking Composer Modal / Flow (chat-first micro-turn composer)
* Client Profile Page (contact, consent, booking history, notes, assets)
* Staff Directory & Staff Detail (availability editor, individual calendar view)
* Settings (tenant settings, PSP config, messaging config, module toggles)
* Billing Page (subscription, invoices)
* Notifications/Toast center & global error modal

---

# 5 — Component library (`@booka/ui`) — export list + core TS interfaces

All components are exported from `@booka/ui`. Below are the essential components and the exact prop contracts the agent must implement.

> Use named exports and provide prop types with JSDoc. Keep components pure and avoid internal data fetching — pages will pass data.

### Layout & Shell

```ts
export interface AppShellProps {
  tenantId: string;
  userRole: 'superadmin'|'owner'|'manager'|'staff';
  onLogout: () => void;
  children: React.ReactNode;
}
export const AppShell: React.FC<AppShellProps>;
```

### Dashboard

```ts
export interface KpiCardProps {
  title: string;
  value: string | number;
  delta?: number; // percentage
  trend?: 'up'|'down'|'flat';
  ariaLabel?: string;
}
export const KpiCard: React.FC<KpiCardProps>;

export interface ActivityItem {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
  payload?: any;
}
export interface ActivityFeedProps { items: ActivityItem[]; onClick?: (item: ActivityItem) => void; }
export const ActivityFeed: React.FC<ActivityFeedProps>;
```

### Calendar & Schedule

```ts
export type ViewMode = 'month'|'week'|'day';
export interface BookingEvent {
  id: string;
  start: string; // ISO
  end: string;   // ISO
  status: 'requested'|'confirmed'|'completed'|'cancelled'|'no_show';
  serviceId: string;
  staffId?: string;
  customer: { id: string; name?: string; phone?: string; email?: string };
  metadata?: Record<string, any>;
}
export interface CalendarProps {
  view: ViewMode;
  events: BookingEvent[];
  staffLanes?: boolean;
  timezone?: string;
  onEventClick?: (event: BookingEvent) => void;
  onEventDrop?: (eventId: string, newStart: string, newEnd: string, newStaffId?: string) => Promise<void>;
  onRangeChange?: (start: string, end: string) => void;
}
export const Calendar: React.FC<CalendarProps>;
```

### List & Table

```ts
export interface BookingsTableProps {
  bookings: BookingEvent[];
  columns?: string[]; // keys
  selectable?: boolean;
  onRowClick?: (b: BookingEvent) => void;
  onBulkAction?: (action: string, ids: string[]) => Promise<void>;
}
export const BookingsTable: React.FC<BookingsTableProps>;
```

### Booking Composer (chat-first)

```ts
export interface ComposerContext {
  prefill?: Partial<BookingEvent>;
  customerId?: string;
  tenantId: string;
  locationId?: string;
}
export interface BookingComposerProps {
  context: ComposerContext;
  onComplete: (booking: BookingEvent) => void;
  onCancel?: () => void;
  uiConfig?: { primaryColor?: string; compact?: boolean };
}
export const BookingComposer: React.FC<BookingComposerProps>;
```

### Booking Side Panel (detail + chat)

```ts
export interface BookingSidePanelProps {
  booking: BookingEvent;
  onClose: () => void;
  onUpdate: (patch: Partial<BookingEvent>) => Promise<void>;
  onAction: (action: 'confirm'|'cancel'|'reschedule'|'mark_paid', payload?: any) => Promise<void>;
}
export const BookingSidePanel: React.FC<BookingSidePanelProps>;
```

### Chat

```ts
export interface Message {
  id: string;
  bookingId?: string;
  direction: 'inbound'|'outbound';
  channel: 'whatsapp'|'email'|'sms'|'app';
  text: string;
  status?: 'pending'|'sent'|'delivered'|'failed';
  createdAt: string;
  metadata?: any;
}
export interface ChatThreadProps {
  messages: Message[];
  customerId?: string;
  bookingId?: string;
  onSend: (m: { text: string; attachments?: any[]; metadata?: any }) => Promise<Message>;
  onAction?: (action: string, payload?: any) => Promise<void>;
}
export const ChatThread: React.FC<ChatThreadProps>;

export interface ChatComposerProps {
  placeholder?: string;
  quickReplies?: string[];
  onSend: ChatThreadProps['onSend'];
}
export const ChatComposer: React.FC<ChatComposerProps>;
```

### Client Profile

```ts
export interface ClientProfile {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  metadata?: Record<string, any>;
  consent?: { channel: string; optedIn: boolean; timestamp?: string }[];
}
export interface ClientProfileProps { client: ClientProfile; onUpdate?: (patch: Partial<ClientProfile>) => Promise<void>; }
export const ClientProfilePanel: React.FC<ClientProfileProps>;
```

### Staff

```ts
export interface Staff {
  id: string;
  name: string;
  role: string;
  skills?: string[];
  availability?: { day: number; start: string; end: string }[]; // day: 0-6
}
export interface StaffListProps { staff: Staff[]; onEdit?: (s: Staff) => void; }
export const StaffList: React.FC<StaffListProps>;
export const StaffCard: React.FC<{ staff: Staff; metrics?: any; onAssign?: (bookingId: string) => void }>;
```

### UI primitives

`Button`, `Modal`, `Drawer`, `SidePanel`, `Input`, `Select`, `DatePicker`, `TimePicker`, `Toast`, etc. — export standard props with className override.

---

# 6 — API contracts (frontend uses these endpoints — no mock data)

All endpoints require `Authorization: Bearer <token>` header. Date/times are ISO strings in tenant timezone unless otherwise specified.

> Base URL: `https://api.booka.app/v1`

### Auth

* `GET /auth/me` → *whoami + roles*

  * Response: `{ userId, name, email, role, tenantId?, tenantRoles?: string[] }`
* `POST /auth/login` — standard (not in scope)

### Super-Admin

* `GET /superadmin/tenants?status=&page=&limit=` → list tenants

  * Response: `{ tenants: [{ id,name,status,createdAt,plan }], total }`
* `POST /superadmin/tenants` → create tenant
* `PATCH /superadmin/tenants/:id` → update tenant (suspend/upgrade)

### KPIs & Dashboard

* `GET /tenants/:tenantId/metrics`

  * Response: `{ mrr:number, bookingsToday:number, noShowRate:number, depositConversion:number, trend: {...} }`

### Bookings

* `GET /locations/:locationId/bookings?start=&end=&staff=&status=&page=&limit=`

  * Response: `{ bookings: BookingEvent[], total }`
* `POST /locations/:locationId/bookings` — create booking

  * Body: `{ customerId?, customerName?, phone?, email?, serviceId, staffId?, start, end, metadata? }`
  * Response: created booking object
* `PATCH /bookings/:id` — update booking (reschedule/cancel)

  * Body: patch fields
  * Response: updated booking
* `POST /bookings/:id/actions` — action runner (confirm, cancel, mark_paid)

  * Body: `{ action: 'confirm'|'cancel'|'reschedule'|'mark_paid', payload?: any }`
  * Response: `{ success:true, booking }`

### Messages (Chat)

* `GET /bookings/:id/messages?after=` → list messages for booking

  * Response: `{ messages: Message[] }`
* `POST /bookings/:id/messages` — send message

  * Body: `{ channel:'whatsapp'|'email'|'sms', text, attachments?:[] }`
  * Response: `{ message }`
* Messages will be pushed via websocket `ws://api.booka.app/v1/realtime?token=...` with events `message.created`, `booking.updated`.

### Clients

* `GET /clients/:id` → client profile + history summary

  * Response: `{ client: ClientProfile, bookings: BookingEvent[] }`
* `PATCH /clients/:id` → update client

### Staff

* `GET /locations/:locationId/staff` → list staff
* `PATCH /staff/:id/availability` → update availability

### Payments

* `POST /payments/create-link` — create PSP payment link for deposit

  * Body: `{ bookingId, amount, currency }`
  * Response: `{ link, paymentId }`
* PSP webhooks update booking status server-side; frontend polls `GET /bookings/:id` or listens on websocket.

### Admin settings

* `GET /tenants/:tenantId/settings`
* `PATCH /tenants/:tenantId/settings`

### Errors

* Standard error format: `{ code: string, message: string, details?: any }`
* 401 for auth, 403 for ACL, 409 for conflicts (booking collision).

---

# 7 — UX & Interaction details

* Calendar drag/reschedule: on drop, optimistic UI update with PATCH `/bookings/:id`; if 409 returned, show overlay with conflicting events and suggested alternates.
* Micro-turn BookingComposer: one question per UI turn. After each answer, call `POST /locations/:id/bookings` with `status:"requested"` and `idempotencyKey` until deposit confirms. Backend handles ephemeral tentative bookings.
* ChatThread: optimistic messages appear with `status:pending`. On server ack via websocket replace with server message. If delivery fails, show retry action.
* Accessibility: all interactive controls keyboard-accessible, aria labels on calendar cells, focus trap in modals.
* Timezone UI: clearly display tenant timezone; show UTC ISO timestamps in debug mode.

---

# 8 — State management & caching rules

* Use React Query for all server reads/writes.
* Cache keys: `['bookings', locationId, start, end]`, `['booking', bookingId]`, `['messages', bookingId]`. Invalidate appropriately after mutations.
* Long-poll websocket updates to update caches: on `booking.updated` call `queryClient.invalidateQueries(['booking', id])` and `invalidateQueries(['bookings', locationId])`.
* Maintain ephemeral conversation state in local component state and persist drafts to `localStorage` for resilience.

---

# 9 — Real-time requirements

* WebSocket connection on authenticated pages using token from `GET /auth/me`.
* Event types: `message.created`, `booking.created`, `booking.updated`, `payment.updated`, `staff.updated`. Payloads must match API shapes.
* Reconnect strategy with exponential backoff; show online/offline status in topbar.

---

# 10 — Testing & quality

* **Unit**: Jest + React Testing Library for components (>=80% coverage on critical components: BookingComposer, Calendar, ChatThread).
* **Integration**: React Query behavior + optimistic updates tests.
* **E2E**: Playwright/Cypress scenarios:

  * Create booking via BookingComposer (micro-turn flow) and confirm deposit via `payments/create-link` then webhook simulation -> booking confirmed UI.
  * Drag-and-drop reschedule -> server conflict handling.
  * Chat send -> server ack -> message shows delivered.
  * ACL test: manager unable to access superadmin page.
* **Accessibility**: axe checks on main pages; keyboard flow for composer & calendar.

---

# 11 — Storybook & documentation

* Publish Storybook (CI) from real environment variables (non-prod API). Each component has stories for base + loading + error states.
* Include a `README.md` for `@booka/ui` showing import examples, TypeScript interfaces, and how to wire up React Query hooks.

---

# 12 — Deliverables (what agent must hand over)

1. `@booka/ui` package (TSX) with exported components above.
2. Full pages for Super-Admin and Tenant dashboards.
3. Hooks for data fetching (useBookings, useBooking, useMessages, useClients, useStaff).
4. WebSocket client utility and integration example.
5. Storybook published and linked in PR.
6. Unit & E2E tests and CI config (GitHub Actions).
7. Deployment instructions and environment variables template (API_BASE, WS_BASE, AUTH_TOKEN_PROVIDER).
8. README with run/build/test instructions, component usage examples, and ACL integration guide.

---

# 13 — Acceptance criteria (must pass)

* All listed pages exist and load data from the real API endpoints (no mock data).
* API errors surface with user-friendly toasts and recovery options.
* BookingComposer completes and creates booking via `POST /locations/:id/bookings`.
* ChatThread sends messages via `POST /bookings/:id/messages` and shows server-sent messages via websocket.
* Calendar drag-reschedule triggers `PATCH /bookings/:id` and handles both 200 and 409 responses gracefully.
* Super-Admin page can list tenants and perform suspend/upgrade via `PATCH /superadmin/tenants/:id`.
* Storybook contains stories for all major components and is deployable by CI.
* Tests (unit + E2E) pass in CI; accessibility checks pass.

---

# 14 — Sprint backlog (practical 4-sprint plan)

Sprint 1 (2 weeks): scaffolding, auth, `AppShell`, Topbar, `Calendar` page (read-only), hooks for bookings.
Sprint 2: `BookingComposer` micro-flow, `POST /bookings` integration, `BookingSidePanel`, `ChatThread` send/get via REST.
Sprint 3: Drag-and-drop reschedule + conflict handling, `BookingsTable` list view, staff pages. Websocket integration.
Sprint 4: Super-Admin page, settings, payments link UI, tests, Storybook, CI pipeline.

Each sprint: deliver components, pages, Storybook stories, and E2E tests covering the new features.

---

# 15 — Operational notes & gotchas

* **Never trust client time**: server authority for conflicts. Use client for tentative slot display only.
* **Rate limits**: paginate and debouce calendar range queries — reminders may trigger spikes.
* **Message cost**: warn tenants if they use webhook-heavy features; provide quota UI.
* **Upgrade path**: tenant owners can enable/disable modules in settings; components must read feature flags and hide UI if module is off.

---

# 16 — Security & privacy

* Use HTTPS everywhere. Store tokens securely (httpOnly cookies recommended).
* Sanitize user inputs; escape templates before rendering message previews.
* Consent UI must be present on client profile for channels used. Frontend must display consent state and allow opt-out (calls `PATCH /clients/:id`).

---

# 17 — Handoff checklist for review

* PR with component package and pages.
* Deployed Storybook link and staging deployment URL.
* Postman/OpenAPI collection for all API contracts used.
* Test results and coverage report.
* Short video walkthrough (5–10 mins) showing key flows: booking, pay link, chat, reschedule.

---

That’s everything an agent needs to start coding and ship. If you want, I’ll spit out the exact TypeScript interface file (`types.ts`) containing all interfaces above plus an OpenAPI snippet for the API endpoints so they can paste it into the repo and generate hooks automatically. Which would you like me to generate right now: `types.ts` or the OpenAPI YAML?
