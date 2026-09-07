# Plan: Dashboard capability scoping (show only what the tenant uses)

**Date:** 2026-07-31
**Problem:** Booka does bookings + sales + inventory + CRM + support, but the
dashboard shows *all 35 nav items* to every tenant, gated only by role. A
sales-only shop still sees "Bookings" and "Schedule"; a bookings-only salon sees
"Products"/"Inventory"/"Orders". The dashboard should reflect the workflow the
tenant actually runs.

## What exists today (reuse, don't rebuild)
- `src/components/UnifiedDashboardNav.tsx` — `ALL_NAV_ITEMS: {href,label,icon,roles}[]`, filtered **only by role**. This is the gating point.
- `src/lib/verticalModuleManager.ts` / `verticalModuleRuntime.ts` — an *industry-vertical* module system (beauty/hospitality/medicine). **Different axis** from capability scoping; keep it, don't overload it.
- `tenant_modules(registry_data jsonb)` table + `/api/modules` (install/uninstall/configure/list) + `src/components/modules/ModuleManager.tsx` UI — reusable persistence + settings surface.
- `tenants.business_type` / `tenants.industry` — signal for sensible defaults.
- `tenants.settings` jsonb (restored 2026-07-30) — natural home for a `capabilities` object.

## Core model: capabilities (orthogonal to role & vertical)
Define a small fixed set of **capabilities**, each mapping to nav items + routes:

| Capability | Nav items gated | Notes |
|-----------|-----------------|-------|
| `bookings` | Bookings, Schedule (owner/manager/staff variants), Services, Staff | the appointments workflow |
| `sales`    | Orders, Products, Showcase | retail/commerce |
| `inventory`| Inventory | depends on `sales` |
| `crm`      | Customers, Leads | |
| `support`  | Support, FAQs | |
| `analytics`| Analytics, AI Metrics, Usage, Reports | always-on for owner; can stay ungated |
| always-on  | Chats, Tasks, Settings, Billing | never hidden |

Superadmin items are unaffected (platform scope, not tenant capability).

## Data model
- Store `settings.capabilities` on the tenant as `{ bookings: bool, sales: bool, inventory: bool, crm: bool, support: bool }` (default true where unset, so existing tenants are unchanged until they opt to trim).
- No new table needed — `tenants.settings` already exists. (If we later want per-capability config/telemetry, `tenant_modules.registry_data` is the richer home.)
- **Migration:** none required for storage. A one-time backfill could seed defaults from `business_type` (e.g. `retail`/`store` → sales+inventory+crm, no bookings; `salon`/`clinic` → bookings+staff+crm). Optional; can also be done lazily.

## Implementation steps
1. **Types + source of truth.** Add `Capability` union + `TenantCapabilities` type. Add `getTenantCapabilities(tenantId)` (server) reading `tenants.settings.capabilities`, defaulting all-true. Add a `useTenantCapabilities()` client hook (memoized, same pattern as `useTenantCurrency`) fed from the tenant context/provider that already loads settings — avoid a new per-render fetch.
2. **Tag nav items.** Add optional `capability?: Capability` to `NavItemDef`. Annotate each item in `ALL_NAV_ITEMS`. Items with no `capability` are always-on.
3. **Gate the nav.** In `UnifiedDashboardNav`, filter by `role AND (item.capability == null || caps[item.capability])`. One-line predicate change; everything else stays.
4. **Guard the pages** (defense in depth — nav hiding isn't security). Add a lightweight server check in the relevant `dashboard/*/layout.tsx` (or a shared `requireCapability()` helper) that redirects to `/dashboard` when the capability is off. Prevents deep links / bookmarks to disabled surfaces.
5. **Settings UI.** Add a "Workflow / Capabilities" card in Settings (or extend `ModuleManager.tsx`): owner toggles which capabilities are on. Writes `settings.capabilities` via the existing `/api/tenants/[tenantId]/settings` PATCH (already merges settings).
6. **Onboarding tie-in.** Use the onboarding signals we already collect (services vs products) to seed initial capabilities: added services → `bookings`; added products → `sales`(+`inventory` if stock given). Set `settings.capabilities` at tenant creation so the first dashboard is already scoped.
7. **Defaults by business_type** (optional polish): a `defaultCapabilitiesFor(businessType)` map for tenants that skip the product/service steps.

## Testing
- Unit: `getTenantCapabilities` defaulting + `defaultCapabilitiesFor`.
- Nav: render `UnifiedDashboardNav` with caps `{sales:true, bookings:false}` → asserts Bookings/Schedule/Services absent, Orders/Products present, Chats/Settings always present.
- Page guard: request a `bookings` route with bookings off → redirect.
- Regression: caps all-true (default) → nav identical to today (no behaviour change for existing tenants).

## Effort / sequencing
- Steps 1–3 (types + nav gating): ~half a day, low risk, immediately visible.
- Step 4 (page guards): ~half a day.
- Steps 5–7 (settings UI + onboarding seed + defaults): ~1 day.
- Ship 1–3 first behind an all-true default (no visible change), then wire the settings toggle, then onboarding seeding.

## Open decisions for the user
1. **Default posture:** all-capabilities-on for existing tenants (safe, opt-in trim) — recommended — vs. infer-and-trim from business_type on first load (more magical, riskier).
2. **Who toggles:** owner-only, or owner+manager?
3. **Granularity:** the 5-capability set above, or finer (e.g. split `leads` from `customers`)? Coarser = simpler UX.
4. **Storage home:** `tenants.settings.capabilities` (simple, recommended) vs `tenant_modules.registry_data` (richer, ties into the vertical-module system).

## Non-goals
- Not touching the vertical-module system (beauty/hospitality/medicine) — that's a separate axis.
- Not gating superadmin/platform surfaces.

---

## Implementation status (2026-07-31) — SHIPPED (decisions: all-on / owner-only / 5 coarse / tenants.settings)
- `src/lib/capabilities.ts` — types, `DEFAULT_CAPABILITIES` (all-on), `resolveCapabilities` (inventory⇒sales), `getTenantCapabilities`, `capabilityForHref`, `isRouteEnabled`. Unit-tested (`src/__tests__/lib/capabilities.test.ts`, 10 cases).
- `tenant-context.tsx` — carries `capabilities`, seeded via `initialCapabilities`.
- `dashboard/layout.tsx` — fetches capabilities server-side, seeds the client.
- `UnifiedDashboardNav.tsx` — filters nav items by `isRouteEnabled` (defensive `useContext`, all-on fallback).
- `/api/tenants/[tenantId]/settings` schema — accepts `capabilities`.
- `CapabilitiesCard.tsx` on owner Settings — 5 toggles, save.
- Onboarding — seeds capabilities from services/products declared.
- Default posture all-on ⇒ zero change for existing tenants until an owner trims.

### Remaining / follow-ups
- **Page guards** (defense-in-depth): a sales-only owner can still *type* `/dashboard/bookings` and see their own (empty) surface. Not a security issue (own tenant data), but for polish add a `requireCapability()` redirect in the relevant `dashboard/*/layout.tsx`.
- ~~Public storefront preview~~ — **SHIPPED (2026-07-31).** Distinct from the
  booking page (separate route + service, never merged):
  - `src/lib/publicStorefrontService.ts` — `getTenantProducts` + `createPublicOrder` (writes the existing retail_orders engine; no new "store" table).
  - `/api/public/[slug]/products` (GET catalogue) + `/api/public/[slug]/order` (POST, Zod-validated, `{auth:false}`).
  - `src/app/store/[slug]/` — layout + SSR page + `StorefrontContainer` (catalogue, cart, checkout, inline success + pay-now link).
  - `PublicLinksCard` on owner Settings — capability-aware: shows Booking page when `bookings` on, Storefront when `sales` on.
  - Bonus: fixed a pre-existing ghost — `createPublicBooking` inserted `reservations.source` (no column ⇒ public booking 500'd). Added `source` via `db/migrations/2026-07-31_add_reservations_source.sql`.
