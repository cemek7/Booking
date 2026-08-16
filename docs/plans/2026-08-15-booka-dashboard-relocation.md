# Plan: `/booka/dashboard` URL structure

**Date:** 2026-08-15 (revised 2026-08-16)
**Status:** ✅ ALREADY IMPLEMENTED — this doc now records the shipped design, not a pending change.

> **Correction (2026-08-16):** The original draft of this plan proposed a *physical* route
> move (`git mv src/app/dashboard → src/app/booka/dashboard`) plus a compatibility redirect.
> Before executing it, we discovered the `/booka/dashboard` structure was **already shipped to
> `staging`** via a middleware **rewrite/alias** approach (commit *"feat(dashboard): add Booka
> workspace routes and tenant staff view"*). The physical move was therefore abandoned as
> redundant and destructive. The rejected "Option 2" in the original draft is, in fact, the
> approach that shipped — and it works. This document is rewritten to describe that.

## Target IA (all four now satisfied)

| URL | Serves | Status |
| --- | --- | --- |
| `techclave.cloud/` | TechClave product-house landing | ✅ `src/app/page.tsx` (anon); authed users redirect to their workspace |
| `techclave.cloud/booka` | Booka product landing | ✅ `src/app/booka/page.tsx` |
| `techclave.cloud/showcase` | Capability showcase | ✅ `(showcase)` route group |
| `techclave.cloud/booka/dashboard/**` | Booka app (owner/manager/staff/superadmin) | ✅ via middleware rewrite (below) |

## How it actually works (the shipped design)

Physical App Router pages stay at `src/app/dashboard/**`. The public URL is `/booka/dashboard/**`.
The translation lives in two places:

- **`src/lib/navigation/dashboard-path.ts`** — single source of truth:
  - `toBookaDashboardPath('/dashboard/x')` → `'/booka/dashboard/x'` (internal → public; used for links/redirects)
  - `toInternalDashboardPath('/booka/dashboard/x')` → `'/dashboard/x'` (public → internal; used for the rewrite)
  - `isBookaDashboardPath(pathname)` — guard
- **`src/middleware.ts`**:
  - Legacy `/dashboard/**` → **redirect** to `/booka/dashboard/**` (query preserved via `nextUrl.clone()`), so old bookmarks/emailed links/OAuth callbacks keep working.
  - Incoming `/booka/dashboard/**` → auth-gated, then **`NextResponse.rewrite`** to the internal `/dashboard/**` page. The App Router pages are reused unchanged.
  - Anonymous `/` → renders the TechClave landing (no redirect). Authed `/` → `getRoleDashboardPath(role)` → `/booka/dashboard/**`.
  - `/login`, `/onboarding`, `/admin`, `/superadmin` → redirected to their `/booka/...` or `/dashboard/superadmin` equivalents.
  - Matcher `'/((?!api|monitoring|_next/static|_next/image|favicon.ico).*)'` covers `/`, `/dashboard/**`, and `/booka/dashboard/**`.
- **`getRoleDashboardPath`** (`src/types/unified-permissions.ts`) wraps every role destination in `toBookaDashboardPath`, so all post-login redirects emit `/booka/dashboard/**`.
- **`/booka/auth/**`** routes physically exist (signin, onboarding, callback, select-tenant, …).

Verification: `src/lib/navigation/dashboard-path.test.ts` covers the mapping (passing).

## Why the rewrite approach was kept (vs a physical move)

- It already ships, is coherent, and is covered by a test.
- Users already get canonical `/booka/dashboard/**` URLs (nav emits them; legacy paths 30x-redirect), so a physical move buys **no** URL/UX improvement.
- A physical move would churn 84 route files + ~53 reference files to replace working code and would collide with the concurrent session that authored this.
- **Internal permission-map / route-guard keys intentionally stay `/dashboard/**`** (e.g. `canAccessRoute`, middleware `PROTECTED_ROUTES`) because they match against the post-rewrite *internal* path. Do **not** bulk-rename these — it would break authorization matching.

## Follow-up applied (2026-08-16)

- **`src/lib/auth/auth-manager.ts` `getRedirectUrl`** now emits `/booka/dashboard**` directly
  (via `toBookaDashboardPath`) instead of a bare `/dashboard`, removing an extra redirect hop
  on the tenant-select sign-in path and matching `getRoleDashboardPath`. Other bare-`/dashboard`
  links were deliberately left — they resolve correctly through the middleware redirect by design.

## If a physical move is ever genuinely wanted

Only worth it to *delete the rewrite indirection*. It would require: `git mv` the routes, re-key
`PROTECTED_ROUTES` + `config.matcher`, drop the rewrite branch in middleware while keeping the
legacy `/dashboard`→`/booka/dashboard` redirect, update external OAuth allow-lists, and update
tests. High blast radius, low reward. Not recommended.
