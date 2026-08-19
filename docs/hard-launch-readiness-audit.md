# Hard Launch Readiness Audit

Date: 2026-05-19

## Verdict

**No-go for a paid VPS deployment right now.**

The platform has the right building blocks, but the repo is not yet in a release-stable state. The main blockers are not one feature; they are release hygiene, overlapping legacy surfaces, and incomplete validation coverage.

## Strict No-Go Blockers

1. The worktree is not release-clean.
- There are hundreds of modified, deleted, and untracked files across auth, WhatsApp, billing, dashboards, migrations, tests, and docs.
- That makes the current branch impossible to reason about as a stable release artifact.

2. Full-project validation is still not tractable.
- `tsc --noEmit` still hits the heap ceiling in this workspace.
- Targeted lint passes on changed files, but there is no reliable whole-repo type safety signal.

3. Multiple overlapping legacy surfaces still exist.
- Auth has legacy and current routes in parallel.
- WhatsApp still has compatibility shims, but the canonical runtime path is now the tenant-scoped webhook tree at `/api/webhooks/whatsapp/[tenantId]`.
- Dashboard surfaces exist in both plural and singular forms.
- That is manageable for development, but too messy for a paid deployment without a prune pass.

4. Voice is not a real product path yet.
- `src/lib/voice/*` exists, but there is no end-to-end user-facing voice capability in the shipped flow.
- Treat voice as future work, not launch scope.

## Launch-Ready Core

These are the pieces I would keep for a VPS launch once the repo is cleaned up:

- `src/app/api/webhooks/whatsapp/[tenantId]/route.ts`
- `src/app/api/webhooks/whatsapp/route.ts` and `src/app/api/webhooks/whatsapp/meta/route.ts` as legacy compatibility shims
- `src/app/api/tenants/[tenantId]/whatsapp/connect/route.ts`
- `src/lib/whatsapp/providers/*`
- `src/lib/whatsapp/v2/*`
- `src/lib/billing/ai-wallet.ts`
- `src/lib/llmAdapter.ts`
- `src/app/api/superadmin/dashboard/route.ts`
- `src/components/SuperAdminDashboard.tsx`
- `src/app/api/ready/route.ts`
- `src/app/api/health/route.ts`
- `src/lib/redis.ts`

These are the pieces that make the platform commercially useful now:
- tenant-isolated WhatsApp routing
- exact-cost AI accounting
- tenant wallet isolation
- superadmin finance visibility
- Redis-backed production gating

## Old Legacy to Remove

These legacy aliases and migration scraps have now been removed from the runtime surface:

- Legacy auth migration debris
  - Already retired and no longer present in the runtime surface.
- Legacy WhatsApp webhook aliases
  - The old webhook alias paths have been removed in favor of the canonical WhatsApp webhook route tree.

- `src/lib/voice/*`
  - Not launch-blocking, but currently unused product surface.
  - Keep only if you actively plan voice in the next phase.

- Legacy documentation snapshots in the repo root
  - The tree contains a large number of stale implementation summaries and audit markdown files.
  - They are not runtime risk, but they are making the repo unreadable.

## Keep for Later

These are useful, but not launch-critical:

- `src/app/dashboard/showcase/*`
  - Good product value, but not required for first paid deployment.

- `src/app/api/showcase-packs/*`
  - Same as above.

- `src/app/api/agent/voice-call/route.ts`
  - Future voice-call feature.

- `src/lib/voice/livekitService.ts`
  - Infrastructure for a voice-call feature, not needed for current launch.

- `src/app/dashboard/superadmin/analytics/page.tsx`
  - Useful once platform operations mature, but not required for first revenue.

- `src/app/api/analytics/*`
  - Good for retention and insight, but not launch-blocking.

## What Is Actually Needed Now

If you want to launch a paid VPS deployment, the minimum live set is:

- one canonical auth flow
- one canonical WhatsApp webhook path per provider
- Redis enabled in production
- Supabase migrations applied
- exact-cost AI accounting
- wallet isolation
- clean tenant superadmin controls
- a stable readiness probe

## Current Operational Risks

1. Redis is required for production-grade rate limiting.
- The code is now wired to fail closed in production rather than silently degrade.
- That is the correct behavior, but it means the VPS deployment must provision Redis properly.

2. Exact cost is now the accounting default.
- Good for auditability.
- Bad if a provider path does not return exact usage/cost metadata.
- Any provider path that cannot return exact cost must either be excluded or explicitly allowed by fallback flag.

3. WhatsApp routing is still multi-surface.
- Evolution, WAHA, and Meta are all present, but they now provision to the tenant-scoped webhook route.
- That is good for flexibility, but dangerous unless the canonical routes are the only externally documented ones.

4. The repo is too big to validate cleanly in one pass.
- Until the worktree is trimmed, every deploy is higher risk than it should be.

## Recommended Prune Order

1. Lock the release branch and stop broad refactors.
2. Delete or quarantine legacy route shims after confirming nothing external uses them.
3. Keep the canonical WhatsApp provider routes only.
4. Keep the exact finance model and superadmin dashboard.
5. Leave voice and showcase as phase-2 features unless they are part of the immediate paid offer.

## Final Go / No-Go

**No-go today** for a paid VPS deployment.

**Go** only after:
- the worktree is cleaned up,
- legacy routes are pruned,
- Redis is provisioned,
- Supabase migrations are confirmed,
- and you have one successful end-to-end smoke test for auth, inbound WhatsApp, outbound reply, and wallet settlement.
