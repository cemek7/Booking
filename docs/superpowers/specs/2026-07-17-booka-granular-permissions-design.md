# Booka Granular Permissions & Staff Accountability — Design

**Date:** 2026-07-17
**Status:** Approved (brainstorm) — ready for implementation planning
**Scope:** Fourth sub-project of the "Booka Operational Intelligence" backlog (§12).
Closes the capability-gating stub that the Owner Commerce Commands (2026-07-16) and Revenue
Assurance (2026-07-16) specs rely on.

---

## 1. Objective

Define the granular commerce/service permission taxonomy the backlog §12 lists, map it to
the existing roles, add a per-user override layer, and **turn specs 2–3's ad-hoc
`capability` stub into real, enforced permissions** — with denied-action and
permission-change auditing.

## 2. Current-state findings (grounding)

- Layered, **code-level** permission system exists: `src/types/roles.ts` (Role enum) →
  `permissions.ts` (`PERMISSIONS`, `ROLE_PERMISSION_MAP`, `PermissionCheckResult`) →
  `enhanced-permissions.ts` (context-aware inheritance) → `unified-permissions.ts`
  (`UnifiedPermissionChecker`, static `hasPermission`).
- `src/lib/error-handling/route-handler.ts` already enforces both `roles:[]` and
  `permissions:[]` server-side, and the auth context already carries a `permissions: string[]`
  field on the user (currently mostly empty — routes rely on `roles:[]`).
- `public.tenant_users` has a flat `role text` column — **no per-user overrides, no
  tenant-defined roles.** The role→permission map is static in code.
- The WhatsApp owner-command dispatcher identifies actors by phone via
  `src/lib/whatsapp/v2/identityResolver.ts`, which currently returns **role only** (no
  `tenant_user_id`).
- Specs 2–3 introduced an ad-hoc `capability` enum
  (`refund|discount|adjust_stock|delete|manage_staff|approve_anomalies`) as a placeholder
  for this spec.

## 3. Architecture (extends the existing system, does not replace it)

### 3.1 Permission taxonomy
Add granular constants to `permissions.ts` `PERMISSIONS`:
`VIEW_APPOINTMENTS`, `MANAGE_APPOINTMENTS`, `COMPLETE_SERVICES`, `VIEW_PRODUCTS`,
`MANAGE_PRODUCTS`, `RECORD_SALES`, `ISSUE_DISCOUNTS`, `RECORD_PAYMENTS`, `ISSUE_REFUNDS`,
`ADJUST_INVENTORY`, `PERFORM_STOCK_COUNTS`, `VIEW_ANALYTICS`, `VIEW_REVENUE`, `MANAGE_STAFF`,
`APPROVE_ANOMALIES`, `APPROVE_LARGE_DISCOUNTS`, `APPROVE_REFUNDS`.

`ROLE_PERMISSION_MAP` defaults: **owner** = all; **manager** = ops + approvals (incl.
`MANAGE_STAFF`, `APPROVE_*`); **staff** = safe subset (`VIEW_APPOINTMENTS`,
`MANAGE_APPOINTMENTS`, `COMPLETE_SERVICES`, `VIEW_PRODUCTS`, `RECORD_SALES`,
`RECORD_PAYMENTS`) — **not** refunds, discount issuance/approval, inventory adjust,
stock counts, manage-staff, or approvals. `superadmin` bypasses (platform-level, unaffected).

### 3.2 Per-user override layer
New `tenant_user_permissions` (current-state, upserted): `tenant_user_id`, `permission`,
`effect` (grant|revoke), `reason`, `created_by`. Semantics: **row present = explicit
override wins; deleting the row resets to role default.** Unique
`(tenant_id, tenant_user_id, permission)`.

Change **history lives in `business_events`** (`staff.permission_changed`, before/after) —
so the table stays current-state, no append-only duplication.

### 3.3 Effective-permission resolution (two consumers, one rule)
`getEffectivePermissions(tenantId, tenantUserId)` composes, applying overrides as the
**outermost layer** over the existing enhanced-inheritance result, never bypassing security
rules:
```
granted(p) = (enhanced.granted(role, p, ctx)  OR  override.grant(p))
             AND NOT override.revoke(p)
             AND securityCheck.allowed(p)
```
Resolved **once per request / per message** (no separate caching machinery):
- **HTTP**: resolved at auth and carried on the existing `user.permissions` field;
  `route-handler`'s `permissions:[]` checks against it.
- **WhatsApp**: the dispatcher calls `getEffectivePermissions(tenantId, tenantUserId)`
  directly. **`identityResolver` is extended to surface `tenant_user_id`** (not just role).

### 3.4 Unify specs 2–3's capability stub
The dispatcher's `hasCapability(role, capability)` becomes `hasPermission(effective, P)`.
Mapping: refund→`ISSUE_REFUNDS`, discount→`ISSUE_DISCOUNTS`, adjust_stock→`ADJUST_INVENTORY`,
manage_staff→`MANAGE_STAFF`, approve_anomalies→`APPROVE_ANOMALIES`, delete→per-action
`MANAGE_*`. Spec 2's `set_staff_capability` command **writes `tenant_user_permissions`**
("remove payment permissions from Chidi" → revoke `RECORD_PAYMENTS` for Chidi) and emits
`staff.permission_changed`.

## 4. Guards (separation of duties)
- Changing permissions requires `MANAGE_STAFF`.
- **Owner role is protected** — its permissions cannot be revoked (no lockout).
- **A grantor can only grant permissions within their own effective set** (blocks
  privilege expansion; subsumes self-escalation).
- Superadmin bypass is unaffected (overrides are tenant-scoped).
- Finer role-target rules (e.g. manager-vs-manager) defer to the custom-roles work.

## 5. Enforcement & audit
- **Routes**: add `permissions:[]` to payments (record/refund), staff management, and the
  specs 1–3 APIs (close-reports, anomalies). Long-tail existing routes keep their current
  `roles:[]` checks (populating `effectivePermissions` is additive and must not regress them).
- **Owner-command dispatcher**: per-action permission check replaces the stub.
- **Denied actions** → `business_events` `access.denied` (route-handler) / `command.denied`
  (dispatcher), best-effort.
- **Permission changes** → durable in `tenant_user_permissions` (`created_by`, `reason`) +
  `business_events` history.

## 6. Boundaries / deferred
- Tenant-defined **custom roles** — deferred (backlog: "later if architecture permits"). The
  override layer is the pragmatic substitute.
- **Numeric limits** (discount %, "up to 5%") and the **approval workflow** are **§11's**
  job. §12 defines the approval *permission gates* (`APPROVE_LARGE_DISCOUNTS`,
  `APPROVE_REFUNDS`); §11 builds the flow that routes an action for approval and enforces
  thresholds. Documented seam.
- **Freshness**: overrides take effect on next resolution (WhatsApp = every message; HTTP =
  short-lived session); high-risk actions (refund) re-resolve rather than trust a stale set.

## 7. Data model
`tenant_user_permissions`: `id uuid pk`, `tenant_id uuid not null`,
`tenant_user_id uuid not null → tenant_users`, `permission text not null`,
`effect text` (grant|revoke), `reason text null`, `created_by uuid null`,
`created_at timestamptz`, `updated_at timestamptz`. Unique
`(tenant_id, tenant_user_id, permission)`. RLS tenant-scoped. No changes to
`tenant_users.role`. No data backfill (all users start at role defaults).

## 8. Testing
- Effective = role defaults ± overrides; composition order correct.
- Grant adds / revoke removes access; **grant + security-rule-deny → still denied**.
- Deleting an override row resets to role default.
- **Self/peer privilege expansion blocked** (grantor can't grant beyond own set).
- Owner protected from revocation; only `MANAGE_STAFF` may change perms.
- `set_staff_capability` writes override + emits `staff.permission_changed`.
- Denied action logged (`access.denied` / `command.denied`).
- High-risk route enforced (staff without `ISSUE_REFUNDS` denied a refund).
- capability→permission mapping correct for specs 2–3 actions.
- **Regression:** routes using only `roles:[]` unaffected after `effectivePermissions` is populated.
- Tenant isolation (RLS) on `tenant_user_permissions`.
- Test types: unit (composition, guards), integration (HTTP + WhatsApp enforcement, override
  write path), DB constraint (unique, RLS), permission (denial + regression).

## 9. Migrations & rollback
- Forward: `tenant_user_permissions` (+ unique index, RLS, grants). Paired `_rollback.sql`.
- Additive, no `tenant_users` change, no backfill → safe on live data.

## 10. Implementation order (for the plan)
1. Permission taxonomy constants + `ROLE_PERMISSION_MAP` updates.
2. Migration: `tenant_user_permissions` (+ RLS, unique, rollback).
3. `getEffectivePermissions` (enhanced ⊕ overrides, composition rule); wire onto HTTP auth
   context (`user.permissions`) and extend `identityResolver` to return `tenant_user_id`.
   *Compute only — no new enforcement yet.*
4. Guards (MANAGE_STAFF gate, owner protection, grant-within-own-set).
5. Wire owner-command dispatcher: capability → permission; replace stub.
6. `set_staff_capability` writes overrides + emits events.
7. Enforce `permissions:[]` on new + high-risk routes.
8. `access.denied` / `command.denied` logging.
9. Docs update.

Ship as small reviewable units; do not land all steps in one change set.
