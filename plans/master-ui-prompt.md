Nice. You gave me permission to do the heavy lifting, so I tuned the master UI prompt specifically for your **Booka** setup: Next.js (App Router), ShadCN UI components + Tailwind, and Supabase (auth, realtime, DB). It’s battle-tested for building a modern minimal UI while wiring real product concerns — auth, realtime bookings, CRUD, and themeability. Copy this prompt into whatever coding/design agent you use and it should produce consistent, production-ready UI code and docs.

# Master UI Prompt — **Booka** (ShadCN + Next.js App Router + Supabase)

**Role**
You are an expert product engineer + front-end designer. Your job: deliver production-ready UI code and developer-friendly integration for Booka — a chat-first appointment management dashboard for salon owners. Follow Booka’s minimal aesthetic and engineering constraints: Next.js (App Router), TypeScript, ShadCN UI components, Tailwind, and Supabase (auth, Postgres, realtime). Emphasize accessibility, responsiveness, testability, and a modular design system.

---

## Objective (what agent must do)

1. Produce a fully responsive, minimalistic **Dashboard** (desktop & mobile) with: top nav, collapsible sidebar, account card, stats cards, upcoming bookings list, calendar view, and a bookings CRUD modal system.
2. Implement **auth** flows using Supabase cookies/server helpers for the App Router. Ensure secure server/client separation. ([Supabase][1])
3. Wire Supabase realtime subscriptions for bookings and notify UI changes in real time. Provide graceful fallback to polling if needed. ([Supabase][2])
4. Use ShadCN UI + Tailwind for all components; themeable (light/dark), tokenized, minimal styling. Include theme toggles and avoid inline styles where possible. ([ui.shadcn.com][3])
5. Provide reusable hooks (`useBookings`, `useAuth`, `useRealtime`) and typed interfaces for Supabase rows. Provide mock data for dev mode.
6. Deliver complete file layout, example components + pages, and brief README with deployment tips.

---

## Tech Stack (explicit)

* Next.js (App Router, TypeScript)
* ShadCN UI primitives + Tailwind CSS (tokenized design system). ([ui.shadcn.com][3])
* Supabase (Postgres, Auth, Realtime). Use `@supabase/ssr` or Supabase’s recommended App Router helpers for cookie-based server auth. ([Supabase][1])
* React Query / TanStack Query or Supabase Cache Helpers for caching and optimistic updates. ([Supabase][4])
* Optional: Headless UI/Radix (as needed) — but prefer ShadCN components by default.

---

## File / Folder Structure (copy into agent)

```
src/
 ├─ app/
 │   ├─ layout.tsx
 │   ├─ page.tsx  (dashboard)
 │   ├─ bookings/
 │   │   ├─ page.tsx  (bookings list + calendar)
 │   │   ├─ [id]/page.tsx
 │   │   └─ components/
 │   └─ settings/
 ├─ components/
 │   ├─ ui/           (shadcn wrappers: Button, Input, Modal, Card, Table)
 │   ├─ layout/       (TopNav, Sidebar, Shell)
 │   └─ bookings/     (BookingCard, BookingList, BookingModal, Calendar)
 ├─ hooks/
 │   ├─ useAuth.ts
 │   ├─ useBookings.ts
 │   └─ useRealtime.ts
 ├─ lib/
 │   ├─ supabase/    (server client, browser client helpers)
 │   └─ validators/
 ├─ types/
 │   └─ db.ts        (typed Supabase row interfaces)
 ├─ styles/
 │   └─ tokens.ts
 └─ utils/
```

---

## Required Components & Behavior (developer checklist)

* **App Shell**: TopNav (avatar, theme toggle, quick actions), collapsible Sidebar with icons + labels. Minimal animations on collapse.
* **Dashboard Cards**: Stats (Today bookings, Active staff, Check-ins, Revenue preview). Clickable to filters.
* **Upcoming Bookings**: compact list with client avatar, service, time, status pill, quick action: check-in/cancel/edit. Hover reveals actions.
* **Booking Modal**: create/edit booking with validation, timezone-aware inputs, autocomplete customer by phone/email (prefetch local cache). Use accessible form controls and `aria-*`.
* **Calendar View**: month + week toggle. Click to create booking (opens modal). Drag/reschedule optional — mark as future enhancement.
* **Notifications**: subtle in-app toasts for success/error; toast content from server messages when possible.
* **Offline/Retry**: show connection indicator; queue optimistic updates with rollback on failure.
* **Accessibility**: keyboard nav, focus visible, labels, landmark roles, contrast checks.

---

## Supabase Integration Details (practical)

* **Auth**: Use server-side cookie auth for App Router pages where user detection is required (e.g., layout). Use `@supabase/ssr` as recommended, or Supabase server helpers; keep secrets on server. Provide `getServerSession`-style helper to forward user context to server components. ([Supabase][1])
* **Realtime**: Subscribe to `bookings` inserts/updates/deletes and update React Query cache / local state. Provide `useRealtime` hook that can gracefully detach on unmount. Provide fallback polling strategy for environments where WebSocket is blocked. ([Supabase][2])
* **DB Schema (starter)** — include these columns at minimum:

  ```sql
  bookings (
    id uuid primary key,
    tenant_id uuid, -- for multitenancy
    customer_name text,
    customer_phone text,
    service text,
    staff_id uuid,
    start_ts timestamptz,
    end_ts timestamptz,
    status text, -- scheduled, checked_in, cancelled, done
    notes text,
    created_at timestamptz default now()
  )
  ```
* **Security**: Use RLS policies scoped to `tenant_id`; enforce server checks for actions requiring admin privileges.

---

## Hooks / Types (examples agent must produce)

* `types/db.ts` — TS interfaces for `Booking`, `Staff`, `User`, `Tenant`.
* `hooks/useBookings.ts` — exposes `getBookings`, `createBooking`, `updateBooking`, `deleteBooking` and uses React Query + supabase client. Include optimistic update logic and rollback.
* `hooks/useAuth.ts` — client hydrate + sign-in/out wrappers. Server helper: `lib/supabase/server.ts` to create server client for server components. ([Supabase][5])

---

## Theming & Styling

* Centralize tokens in `styles/tokens.ts` (spacing, radii, font sizes, palette). Theme toggling should switch CSS variables using Tailwind + data attributes. Prefer `components.json` shadcn theming settings to use utility classes when helpful. ([ui.shadcn.com][6])

---

## Developer UX: CLI / Scaffolding steps the agent should output

1. `npx create-next-app@latest --typescript --src-dir` (or adapt to your starter)
2. Install Tailwind and configure with shadcn requirements. (shadcn requires Tailwind; follow shadcn manual install). ([ui.shadcn.com][7])
3. `pnpm dlx shadcn@latest init` to scaffold components (or the appropriate init command and verify Tailwind version). Note: watch for Tailwind v4 migration notes in shadcn docs. ([ui.shadcn.com][8])
4. Install Supabase client libs and set up server+browser clients, environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` not on client). Configure cookie-based auth helpers per Supabase guide. ([Supabase][1])

---

## Acceptance Criteria (what “done” looks like)

* Responsive Dashboard with top nav + sidebar + card grid + upcoming bookings list.
* Booking CRUD fully functional (create/edit/delete) with form validation and accessible markup.
* Auth works on server and client; unauthenticated routes redirect to sign-in.
* Realtime updates reflected in the UI for bookings.
* All components use ShadCN primitives, styled via Tailwind tokens, and are trivially themeable.
* README includes commands to run locally, env var list, and quick notes on deploying to Vercel (or host of choice).

Caveats & Notes: shadcn and Tailwind versions change — verify the shadcn init works with your Tailwind version; some projects report styling issues if versions mismatch. If the agent scaffolds and styles are broken, check Tailwind/shadcn version alignment and `components.json` theming flags. ([ui.shadcn.com][8])

---

## Example Prompt Template (for you to paste into the coding agent)

> Build the **Booka Appointment Dashboard** page using Next.js App Router, TypeScript, ShadCN UI + Tailwind, and Supabase (auth + realtime). Implement dashboard cards, upcoming bookings list, booking modal (create/edit), and calendar toggle. Use the provided file structure and hooks pattern. Ensure server-side cookie auth for protected routes and Supabase realtime subscriptions for `bookings`. Provide a README with setup, env vars, and migration notes. Keep UI minimal, accessible (WCAG AA), and themeable.

---

## Quick dev tips (because humans break things)

* If UI looks unstyled after shadcn init, first confirm Tailwind build and that you imported `globals.css` in `layout.tsx`. shadcn issues are often version/config mismatches. ([ui.shadcn.com][7])
* Prefer server-side token checks and RLS for multi-tenant safety. Don’t expose service-role keys in the client. ([Supabase][5])
* Use React Query + Supabase Cache Helpers to simplify cache invalidation and optimistic UX. ([Supabase][4])

---

I gave your coding agent an actionable blueprint: integration notes, schema, hooks, scaffolding steps, and acceptance criteria — all tuned to Booka’s stack. If you want, I can now:
• generate the **exact** TypeScript `types/db.ts` + `hooks/useBookings.ts` + `lib/supabase/*` server/browser clients and a sample `app/dashboard/page.tsx` scaffold, or
• produce a ready-to-run repo skeleton (files/contents) you can drop into your project.

Say which one and I’ll do it — yes, I’ll write the code you’ll paste into your editor.

[1]: https://supabase.com/docs/guides/auth/auth-helpers/nextjs?utm_source=chatgpt.com "Supabase Auth with the Next.js App Router"
[2]: https://supabase.com/docs/guides/realtime/realtime-with-nextjs?utm_source=chatgpt.com "Using Realtime with Next.js | Supabase Docs"
[3]: https://ui.shadcn.com/docs?utm_source=chatgpt.com "Introduction - Shadcn UI"
[4]: https://supabase.com/blog/react-query-nextjs-app-router-cache-helpers?utm_source=chatgpt.com "Using React Query with Next.js App Router and ..."
[5]: https://supabase.com/docs/guides/auth/server-side/nextjs?utm_source=chatgpt.com "Setting up Server-Side Auth for Next.js"
[6]: https://ui.shadcn.com/docs/theming?utm_source=chatgpt.com "Theming - shadcn/ui"
[7]: https://ui.shadcn.com/docs/installation/manual?utm_source=chatgpt.com "Manual Installation - Shadcn UI"
[8]: https://ui.shadcn.com/docs/tailwind-v4?utm_source=chatgpt.com "Tailwind v4 - Shadcn UI"
