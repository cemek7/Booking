# Plan: relocate the app from `/dashboard` to `/booka/dashboard`

**Date:** 2026-08-15
**Status:** DRAFT — awaiting approval (no code written yet)
**Goal:** Make the URL structure match the intended TechClave information architecture:

| URL | Serves | Today | Target |
| --- | --- | --- | --- |
| `techclave.cloud/` | TechClave product-house landing | ✅ `src/app/page.tsx` | unchanged |
| `techclave.cloud/booka` | Booka product landing | ✅ `src/app/booka/page.tsx` | unchanged |
| `techclave.cloud/showcase` | Capability showcase | ✅ `(showcase)` group | unchanged |
| `techclave.cloud/booka/dashboard/**` | Booka app (owner/manager/staff/superadmin) | ❌ lives at `/dashboard/**` | **move here** |

This is the one piece of the target IA that does not yet exist. Everything else already matches.

## Why this is non-trivial (blast radius)

Measured against the current `staging` tree:

- **66** route files under `src/app/dashboard/` (`page.tsx` / `route.ts` / `layout.tsx`).
- **54** source files contain hardcoded `/dashboard` string references (links, `redirect()`, `router.push`).
- **`src/middleware.ts`** holds a `PROTECTED_ROUTES` map keyed on `/dashboard/*` prefixes (superadmin/owner/manager/staff gating), plus a root-`/`→role-dashboard redirect (lines ~116–179).
- **Auth default-destination** is `/dashboard` in at least: `src/lib/auth/auth-manager.ts` (`return '/dashboard'` ×2), `src/lib/auth/require-capability.ts` (`redirect('/dashboard')`), `src/lib/auth/middleware.ts`, `src/middleware.ts`.
- **OAuth / provider callbacks** already reference `/booka/auth/callback` (nginx config), so post-login redirects that land on `/dashboard` must move too, or logins deep-link to a dead path.

## Decision: how to move

Three options considered:

1. **Physical move + redirects (RECOMMENDED).** `git mv src/app/dashboard → src/app/booka/dashboard`, update every reference, add a permanent redirect `/dashboard/** → /booka/dashboard/**` for old bookmarks/OAuth/session cookies. Canonical URLs become `/booka/dashboard/*`. Correct and clean; largest diff.
2. **Rewrite alias only.** Keep files at `/dashboard`, add `next.config` rewrite `/booka/dashboard/:path* → /dashboard/:path*`. Small diff, but URLs are *aliased not moved* — canonical stays `/dashboard`, cookie `path` scoping and analytics get muddy, and the middleware matcher must handle both prefixes. Rejected as a permanent solution.
3. **Next `basePath`.** Rejected — `basePath` moves the **entire** app (`/`, `/booka`, `/showcase`, `/api`) under a prefix, which is the opposite of what we want. Deploy docs explicitly say "no basePath."

Recommendation: **Option 1**, with the Option-2 rewrite kept only as a short-lived compatibility redirect.

## Step-by-step (Option 1)

1. **Branch off `staging`** in a dedicated worktree (`feat/booka-dashboard-relocation`). This is a product change — not the showcase branch.
2. **Move the routes:** `git mv src/app/dashboard src/app/booka/dashboard`. Confirm `src/app/booka/layout.tsx` (if any) doesn't double-wrap the dashboard layout.
3. **Middleware (`src/middleware.ts`):**
   - Re-key `PROTECTED_ROUTES` from `/dashboard/*` → `/booka/dashboard/*` (keep the most-specific-first ordering).
   - Update the `config.matcher` so the middleware still runs on the new prefix.
   - Update the root-`/`→role-dashboard redirect to target `/booka/dashboard` — **and reconcile it with the TechClave landing**: `/` must keep rendering the landing for anonymous visitors; only authed users get redirected. Verify this doesn't hijack the public landing.
4. **Auth redirect defaults:** update `auth-manager.ts`, `require-capability.ts`, `auth/middleware.ts`, and any `getDefaultDashboard()`-style helper from `/dashboard` → `/booka/dashboard`. Centralize into one constant (`BOOKA_APP_HOME = '/booka/dashboard'`) to prevent future drift.
5. **Bulk reference update:** sweep the 54 files. Prefer a scripted replace of `'/dashboard` → `'/booka/dashboard` (and the `"`/`` ` variants), then **manually review** each hit — exclude false positives (`/dashboard` inside `/api/...` strings that aren't app routes, doc/comment strings, `/dashboard/ops` on the landing which must also move).
6. **Landing links:** update `src/app/page.tsx` (`/dashboard/ops` product card → `/booka/dashboard/ops`) and any footer/nav dashboard links.
7. **Compatibility redirect:** add to `next.config` a permanent redirect `/dashboard/:path* → /booka/dashboard/:path*` so existing sessions, emailed links, and OAuth callbacks survive the cutover. Plan to retire it after one release cycle.
8. **External callback config:** update Supabase Auth redirect allow-list, Google/Meta OAuth callback URLs, and any provider that hard-codes a post-login `/dashboard` path.
9. **Tests:** update `src/__tests__` and any e2e/route tests asserting `/dashboard` paths; add a test that `/dashboard/x` redirects to `/booka/dashboard/x` and that middleware gates the new prefix.

## Verification gates

- `npm run typecheck:ci` clean.
- `npm test` clean (the CI deploy gate runs this; a miss fails the build before it deploys).
- Manual: sign in as each role → land on the correct `/booka/dashboard/*`; anonymous `/` still shows the TechClave landing; old `/dashboard/*` 308-redirects; a protected `/booka/dashboard/owner` blocks a staff user.
- `grep -rn "'/dashboard\|\"/dashboard\|\`/dashboard" src` returns only intentional compat/redirect references.

## Risks / watch-items

- **Auth lockout** if a redirect default is missed → user bounces to a dead `/dashboard`. Mitigated by the compat redirect (step 7) and centralized constant (step 4).
- **Root-`/` redirect vs landing** collision (step 3) — the single highest-risk item; test both anonymous and authed.
- **Middleware matcher** must be updated or gating silently stops applying on the new prefix (security regression).
- **OAuth provider config is outside the repo** (step 8) — code can be perfect and logins still fail if the provider allow-list isn't updated in lockstep. Coordinate the cutover.
- Concurrent sessions edit `src/app` heavily — rebase/land fast to avoid conflicts across 66 moved files.

## Rollback

Revert the commit; the compat redirect and the physical move are in one changeset. Because old `/dashboard` URLs are redirected (not deleted server-side until retirement), a revert restores the prior behavior cleanly.
