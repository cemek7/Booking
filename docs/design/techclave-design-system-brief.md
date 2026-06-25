# Techclave Design System — Seed Brief

> Paste this into the Claude Design session (claude.ai/design, `setup=design-system`) as your
> first message. It encodes the brand DNA already shipped in `src/app/globals.css`.

## Brand

- **Parent brand:** Techclave — "AI operating systems for African businesses"
- **Product:** Boka (booking / reservations platform)
- **Verticals served:** salons, clinics, restaurants, studios
- **Personality:** warm, premium, editorial, distinctly African; calm paper-and-ink base
  with a confident green action color and a gold editorial accent. NOT generic SaaS-indigo.

## Color tokens (source of truth — use these exact hex values)

### Neutrals / surfaces (paper & ink)
| Token | Hex | Use |
|---|---|---|
| `paper` | `#f6f5ef` | App background |
| `paper-strong` | `#ece7d8` | Raised surfaces, cards on paper |
| `line` | `#d8d3c4` | Borders, dividers |
| `ink` | `#10211a` | Primary text / foreground |
| `ink-soft` | `#274235` | Secondary text |
| `moss` | `#4d6a59` | Muted text, captions |

### Primary action (green)
| Token | Hex | Use |
|---|---|---|
| `green` | `#059669` | Primary buttons, links, active state |
| `green-strong` | `#047857` | Hover / pressed |
| `green-soft` | `#ecfdf5` | Tinted backgrounds, success surfaces |
| `green-border` | `#a7f3d0` | Subtle green borders |

### Accent (gold)
| Token | Hex | Use |
|---|---|---|
| `gold` | `#d4b368` | Editorial accent, highlights, premium cues (use sparingly) |

### Background texture (signature look)
The app background is layered, not flat — replicate as a token/utility:
```css
background-image:
  radial-gradient(circle at top left,  rgba(212,179,104,0.14), transparent 24%),
  radial-gradient(circle at top right, rgba(5,150,105,0.05),   transparent 24%),
  linear-gradient(180deg, #f8f7f2 0%, #f3f0e6 100%);
```
Text selection: `background: rgba(34,197,94,0.18); color: #0f172a;`

## Typography

| Role | Family (with fallbacks) | Notes |
|---|---|---|
| Display | "Iowan Old Style", Palatino, "Book Antiqua", Georgia, serif | `.techclave-display`: letter-spacing **-0.05em**, line-height **0.94** |
| Sans (body + headings) | "Avenir Next", "Segoe UI", "Helvetica Neue", Arial, sans-serif | Headings h1–h4: letter-spacing **-0.04em** |
| Mono | ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas | code / data |

- **Kicker / eyebrow:** 11px, weight 600, letter-spacing **0.32em**, UPPERCASE.
- Headings are tight-tracked and serif-display for hero moments; sans for UI.

## Components to generate (priority order)

1. **Foundations** — color palette, type scale, spacing, radius, shadows, the textured background.
2. **Buttons** — primary (green), secondary (ink outline on paper), ghost, gold accent; hover = green-strong.
3. **Inputs / forms** — text field, select, textarea on paper surfaces, green focus ring.
4. **Cards** — on `paper-strong` with `line` border; an editorial variant with gold kicker.
5. **Badges / status** — confirmed, pending, cancelled, no-show (booking domain).
6. **Navigation** — top bar + sidebar (dashboard).
7. **Tables** — reservations/bookings list.
8. **Empty states & toasts.**

## Current app layout (must be reflected — this is what real users see)

> The homepage already uses the brand tokens above. The **dashboard does not yet** — it is still
> on a legacy indigo/gray SaaS theme. The design system's job is to bring the dashboard onto the
> brand. Below is the actual current dashboard structure (`src/components/DashboardLayoutClient.tsx`
> + `UnifiedDashboardNav.tsx`) so the system models real screens, not a generic app shell.

### Dashboard shell
- **Top header** — full-width, ~56px (h-14), surface = white today (→ should become `paper` + `line` bottom border).
  - Left: mobile hamburger (collapses sidebar) + logo-mark (rounded square) + "boka" wordmark.
  - Right: user email (truncated), circular **avatar** showing the user's initial, "Sign out" button.
- **Sidebar** — desktop ~240px (w-60), fixed left, vertical nav. Mobile → slide-over drawer (~288px) with dark backdrop.
- **Main** — scrollable content area, content max-width ~1280px (max-w-7xl), centered.
- **Nav items** (role-gated): Dashboard, Bookings, Schedule, Services, Customers, Staff, Analytics,
  Reports, Showcase, Chats, Settings, Billing, FAQs, Tasks, Super Admin.

### Components the dashboard actually needs
- App header bar (logo, avatar, sign-out).
- Sidebar nav item: default / active / hover states + section grouping by role.
- Mobile slide-over drawer + backdrop.
- Page header (title + actions row).
- Data tables (bookings, customers, staff).
- Stat / metric cards (analytics, reports pages).
- Status badges: confirmed, pending, cancelled, **no-show**.
- Forms (settings, services, staff invite).

## Complete surface inventory (audit of all 16 sections / 77 pages)

> Reality: `brand-theme` has **0 references app-wide**. Brand tokens live ONLY on the root homepage.
> Every surface below is still legacy indigo/gray and needs migration. Priority = customer impact.

| Priority | Surface | What it is | Theme today |
|---|---|---|---|
| **P0** | `book/[slug]/` (+ `/confirmation`) | **Public customer booking flow** — the core product moment | slate gradient + indigo |
| **P0** | `booka/auth/*` (7 pages) | **Live auth**: signin, signup, onboarding, select-tenant, callback, forbidden, unauthorized (sign-out redirects here) | indigo/gray |
| **P1** | `dashboard/` (42 pages) | Operator dashboard shell + all inner pages | indigo/gray (see shell above) |
| **P1** | `booka/page.tsx` | Booka product landing | gray |
| **skip** | `auth/signin`, `auth/signup` | Redirect stubs → `booka/auth` (no UI) | n/a |
| **note** | `auth/{callback,select-tenant,onboarding,forbidden,unauthorized}` | Real but **duplicate** UI of `booka/auth` — consolidate in code first, then they inherit the canonical auth styles | indigo/gray |
| **P2** | `chat/` | Chat surface (own layout) | indigo/gray |
| **P2** | `settings/` (6 pages) | Settings (own layout) | indigo/gray |
| **P2** | `clients/` | Client portal (own layout) | gray |
| **P3** | `staff/`, `schedule/`, `reservations/`, `owner/`, `reviews/`, `voice/`, `products/`, `billing/`, `tenant/` | Various app sections | indigo/gray |

**Shared shells to design once (used across surfaces):** booking-flow container, auth card/screen,
public mini-site (`book/[slug]`), the dashboard chrome (header+sidebar+drawer).

**Public booking flow components (P0 — customer-facing):** service picker, staff picker, date/time
slot grid, booking summary, confirmation screen, the tenant mini-site header/branding block.

**Auth components (P0):** auth card, signin/signup forms, onboarding stepper, tenant-select list,
forbidden/unauthorized empty states.

## The migration this system drives (state it to Claude Design)

There are currently **two visual languages** in the product:
- **Homepage** → brand (paper/ink/green/gold, serif display). ✅ done.
- **Dashboard** → legacy **indigo + gray** SaaS, flat white surfaces. ❌ not yet migrated.

The legacy palette to **replace**:
| Legacy (remove) | Brand (use instead) |
|---|---|
| `indigo-600` (logo, primary action) | `green` `#059669` |
| `indigo-700` (hover/active) | `green-strong` `#047857` |
| `indigo-100 / indigo-50` (avatar, tints) | `green-soft` `#ecfdf5` / `green-border` |
| `gray-50` (app bg) | `paper` `#f6f5ef` (+ textured background) |
| `gray-200` (borders) | `line` `#d8d3c4` |
| `bg-white` (flat surfaces) | `paper-strong` `#ece7d8` for raised cards |
| `gray-900 / gray-600 / gray-500` (text) | `ink` / `ink-soft` / `moss` |

## Constraints

- Replaces a legacy indigo theme — there must be **no indigo** in the output. Green is the action color.
- Must read as premium/editorial, not flat-material SaaS.
- Light theme is primary. (Dark theme optional, second pass.)
- Tech target: Next.js 16 + Tailwind v4 (`@theme` CSS variables), React 19 — so export tokens as CSS custom properties / Tailwind theme.
- The dashboard chrome (header + sidebar) is the highest-value surface to redesign — prioritize it.
