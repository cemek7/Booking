# Boka Design System — v2 Draft (fresh)

> Seed for a new claude.ai/design session. This version reconciles the two looks that exist
> in the product today into **one** system: the warm **paper/ink/gold** brand (homepage) and the
> **emerald/slate, rounded, pill** app styling the dashboard already ships. One token set, two
> contexts (marketing vs app). Grounded in the real codebase, not an idealized brand.

---

## 0 · Company & product

- **Parent:** Techclave — "AI operating systems for African businesses."
- **Product:** Boka — multi-tenant booking / reservations platform (Next.js 16 · React 19 · Supabase · Tailwind v4 `@theme`).
- **Who uses it:** business **owners / managers / staff** run a dashboard; their **customers** book through a public reservation page. Roles: superadmin · owner · manager · staff.
- **Verticals:** salons, clinics, restaurants, studios.
- **Domain language:** bookings/reservations, services, staff, customers, schedule; statuses **confirmed · pending · cancelled · no-show**; payments cash · card · transfer. Money in Naira (₦).

## 1 · The one rule that makes this coherent: two contexts, one palette

| | **Marketing** (homepage, booking landing) | **App** (dashboard, auth, booking flow) |
|---|---|---|
| Surface | Warm paper `#f6f5ef` + signature gold/green texture | Cooler near-white `#ffffff` / `#f8fbf9` |
| Headings | **Serif display** (Iowan), tight tracking | **Sans** (Avenir), `font-semibold`, tracking-tight |
| Accent | **Gold** editorial cues, sparingly | **Emerald/green** functional accent |
| Radius | Editorial, calmer | **Generous** — `rounded-2xl/3xl` cards, **pill** buttons |
| Hero | Paper texture | Soft **green→white radial** wash |

Same colors, same fonts, same tokens underneath. Context only shifts *which* of them lead. **No indigo, ever.**

## 2 · Color tokens (exact hex — single source of truth)

### Neutrals / surfaces
| Token | Hex | Use |
|---|---|---|
| `paper` | `#f6f5ef` | Marketing background |
| `paper-strong` | `#ece7d8` | Raised editorial surfaces |
| `surface` | `#fffefb` | Warm near-white card |
| `app-canvas` | `#f8fbf9` | App background (barely-green off-white) |
| `line` | `#d8d3c4` | Borders, dividers |
| `ink` | `#10211a` | Primary text / headings |
| `ink-soft` | `#274235` | Secondary text |
| `moss` | `#4d6a59` | Muted text, captions (app body uses this, **not** slate) |

### Green (primary action) — note: Tailwind `emerald-*` == these
| Token | Hex | Use |
|---|---|---|
| `green` | `#059669` | Primary buttons, links, active (= `emerald-600`) |
| `green-strong` | `#047857` | Hover / pressed (= `emerald-700`) |
| `green-deep` | `#065f46` | Deep accent text on tints (= `emerald-800`) |
| `green-soft` | `#ecfdf5` | Tinted backgrounds, success surfaces |
| `green-border` | `#a7f3d0` | Subtle green borders |

### Gold (editorial accent — sparing)
| Token | Hex |
|---|---|
| `gold` | `#d4b368` |
| `gold-soft` | `#f7f0dd` |

### Status (booking domain)
| Status | Fg | Soft bg | Border |
|---|---|---|---|
| confirmed | `#059669` | `#ecfdf5` | `#a7f3d0` |
| pending | `#b8862b` | `#fbf3e0` | `#ecd9a6` |
| cancelled | `#b4453a` | `#fbeae7` | `#f0c5bd` |
| no-show | `#5c5448` | `#efece4` | `#d8d3c4` |

### Signature washes
- **Marketing texture** (`bg-boka`): `radial-gradient(circle at top left, rgba(212,179,104,.14), transparent 24%), radial-gradient(circle at top right, rgba(5,150,105,.05), transparent 24%), linear-gradient(180deg,#f8f7f2,#f3f0e6)`
- **App hero wash** (`bg-hero-green`): `radial-gradient(circle at top left, #f0fdf4, #ffffff 55%, #f8fbf9 100%)`
- Selection: `rgba(34,197,94,.18)` on `#0f172a`.

## 3 · Typography

| Role | Stack | Notes |
|---|---|---|
| Display (marketing/hero) | `"Iowan Old Style", Newsreader, Palatino, Georgia, serif` | tracking **-0.05em**, line-height **0.94** |
| Sans (all app UI + body) | `"Avenir Next", Mulish, "Segoe UI", Arial, sans-serif` | headings weight 600, tracking **-0.04em** |
| Mono (data) | `ui-monospace, SFMono-Regular, Menlo, Consolas` | money, times, refs (`₦ 24,500`, `14:30`, `#BK-20418`) |

- **Kicker / eyebrow:** 11px, weight 600, letter-spacing **0.32em**, UPPERCASE, in moss or gold.
- ⚠️ Iowan & Avenir are Apple system faces; load **Newsreader** + **Mulish** as web fallbacks (after the native names). Upload licensed faces to make it exact everywhere.

## 4 · Radius, spacing, elevation

- **Radius:** controls `--radius-md 10px`; compact cards `--radius-lg 14px`; **app cards `--radius-2xl 18px`** (default card); **app hero `--radius-3xl 24px`**; **pills `999px`** (buttons & badges). App leans round — this is what the dashboard ships.
- **Spacing:** 4px scale; page rhythm `--page-x 24px` / `--page-y 20px`; app content max-width **1280–1600px** centered.
- **Shadows:** warm, low-contrast (ink at low alpha). `--shadow-sm` for cards (the app default), `--shadow-lg` for overlays/toasts, `--shadow-green` glow under primary buttons. Borders do most of the separation work, not heavy shadows.
- **Motion:** calm, 120–320ms; press = subtle translateY + scale 0.99, no bounce.
- **Focus:** 3px green ring + green border on inputs.

## 5 · Components

**Buttons** — **pill by default** (`rounded-full`); variants: primary (green fill, green glow) · secondary (ink/line outline on surface) · ghost · gold (editorial). Sizes sm/md/lg (32/40/48px). `shape="rounded"` for dense toolbars.
**Inputs / forms** — text, select, textarea, checkbox, switch; `radius-md`, green focus ring, on `surface`.
**Cards** — `default` (surface + line + shadow-sm, `radius-2xl`) · `editorial` (paper-strong + gold kicker + serif title) · `flat` (no shadow) · **`hero`** (green→white wash, green-border, `radius-3xl`, green kicker — dashboard greeting / feature banners).
**Status badge** — pill, soft bg + border per status. Fixed labels: Confirmed · Pending · Cancelled · No-show.
**Tag** — small pill (green / gold / neutral), e.g. "Top 5% on Boka", "4.9 ★".
**Avatar** — initials on ink chip (prefer over photos).
**StatCard / KPI** — label + big value (mono or display) + delta + sub; rounded-2xl.
**Table** — bookings/customers/staff; hairline rows, row hover tints to green-soft, mono for times/money.
**Navigation** — **AppHeader** (56px: hamburger + logo + email + avatar + sign out), **Sidebar** (240px desktop / 288px drawer + dark backdrop, role-gated), **TopBar** (page title + actions), **Tabs**.
**Feedback** — **Toast**, **EmptyState** (line-icon medallion + warm copy).
**Icons** — Lucide, 2px stroke (18px nav, 15–16px inline, 26–30px in empty states); moss default, green active, white on fills. **No emoji** in UI; ★ only in rating tags.

## 6 · Surfaces to design (priority = customer impact)

| Priority | Surface | Notes |
|---|---|---|
| **P0** | Public booking flow (`book/[slug]`) | service → date/time slot grid → details → confirmation; tenant mini-site header. Customer-facing. |
| **P0** | Auth (sign in / up / onboarding / select-tenant / forbidden) | split editorial brand panel + form card |
| **P1** | Dashboard shell + home | AppHeader + Sidebar + KPI row + today's schedule table + hero greeting card |
| **P1** | Marketing landing | paper texture + serif display |
| **P2** | Chat · Settings · Client portal | app context |
| **P3** | Staff · Schedule · Reservations · Owner · Reviews · Billing · Products · Tenant | app context |

### Dashboard shell spec (model exactly — matches `DashboardLayoutClient.tsx`)
- **Top header** ~56px: left = hamburger (mobile) + logo-mark + "boka" wordmark; right = email (truncated) + circular initial avatar + "Sign out".
- **Sidebar** 240px desktop / 288px mobile drawer over dark backdrop; nav items (role-gated): Dashboard, Bookings, Schedule, Services, Customers, Staff, Analytics, Reports, Showcase, Chats, Settings, Billing, FAQs, Tasks, Super Admin.
- **Main** scrollable, content centered, max-width 1280–1600px, generous `px` + `py-8`.

## 7 · Voice & content

- **Warm, calm, direct — never breathless.** Speaks like a trusted front-desk colleague.
- Address the operator as **you** ("You're booked in", "Reply to 3 messages"); refer to the business by name.
- **Sentence case everywhere** except the tracked kicker. Buttons are verbs ("Confirm booking", "New reservation").
- Numbers/money/times in **mono**. Naira `₦` with a thin space.
- Examples — Empty: *"No bookings yet — when customers reserve through your page, they'll appear here."* · Confirmation: *"You're booked in. We've sent a confirmation by SMS."* · Nudge: *"You're trending toward your best week this quarter."*
- **No emoji** in product UI.

## 8 · Hard constraints

- **No indigo / no bluish-purple** anywhere. Green is the action color.
- App body text is **moss/ink-soft** (warm), not cool slate — that's the reconciliation: keep the app rounded/emerald/pill feel from Codex, but warm the greys toward the brand.
- App reads round (rounded-2xl/3xl + pills) and uses the green hero wash; marketing reads editorial (paper + serif + gold).
- Light theme primary; dark theme is a later pass.
- Export tokens as CSS custom properties + Tailwind v4 `@theme` (the app consumes both).
