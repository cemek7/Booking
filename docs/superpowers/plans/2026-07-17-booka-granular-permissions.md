# Booka Granular Permissions & Staff Accountability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the granular commerce/service permission taxonomy, a per-user override layer merged over the existing role→permission inheritance, and rewire specs 2–3's `capability` stub into real, enforced permissions with denied-action + permission-change auditing.

**Architecture:** Extend the existing layered permission system (`roles.ts` → `permissions.ts` → `enhanced-permissions.ts` → `unified-permissions.ts`). Effective permissions = role defaults ± per-user overrides, resolved once per request (HTTP: onto `user.permissions`) / per message (WhatsApp: standalone). Guards block privilege expansion.

**Tech Stack:** Next.js 16, Supabase, TypeScript, Jest. Spec: `docs/superpowers/specs/2026-07-17-booka-granular-permissions-design.md`.

## Global Constraints
- Extend, don't replace, the existing permission stack. Preserve `enhanced-permissions` inheritance; overrides are the outermost layer.
- Composition: `granted = (enhanced.granted OR grant) AND NOT revoke AND securityCheck.allowed`.
- Guards: only `MANAGE_STAFF` may change perms; **owner role protected** from revocation; **grantor can only grant within own effective set**; superadmin bypass unaffected.
- Override semantics: row present wins; **delete row = reset to role default**; unique `(tenant, user, permission)`.
- Numeric limits + approval workflow are §11; §12 defines only the approval permission gates.
- Depends on specs 2–3 (rewires their capability stub — consolidation §D checklist). Migrations after spec-3.

## File Structure
- `db/migrations/129_tenant_user_permissions.sql`(+rollback).
- `src/types/permissions.ts` (modify — add PERMISSIONS constants + ROLE_PERMISSION_MAP entries).
- `src/lib/permissions/effectivePermissions.ts` — `getEffectivePermissions(admin, tenantId, tenantUserId)`.
- `src/lib/permissions/overrides.ts` — `setPermissionOverride`, `resetPermissionOverride` (with guards).
- Modify: `src/lib/auth/server-auth.ts` (populate `user.permissions`), `src/lib/whatsapp/v2/identityResolver.ts` (return `tenant_user_id`), `src/lib/booking/capabilityMap.ts` (map capability→PERMISSION), `src/lib/booking/handlers/staff.ts` (`set_staff_capability` writes overrides), spec-2/3 dispatch + routes (enforce).

---

## Task 1: Migration + taxonomy
- [ ] **Step 1:** `129_tenant_user_permissions.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.tenant_user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_user_id uuid NOT NULL REFERENCES public.tenant_users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('grant','revoke')),
  reason text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tup_unique UNIQUE (tenant_id, tenant_user_id, permission)
);
ALTER TABLE public.tenant_user_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tup_service_role ON public.tenant_user_permissions;
CREATE POLICY tup_service_role ON public.tenant_user_permissions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
```
Rollback: `DROP TABLE IF EXISTS public.tenant_user_permissions CASCADE;`
- [ ] **Step 2:** In `src/types/permissions.ts`, add the 17 PERMISSIONS constants (VIEW_APPOINTMENTS … APPROVE_REFUNDS) and map them into `ROLE_PERMISSION_MAP` (owner=all; manager=ops+approvals+MANAGE_STAFF; staff=safe subset). Add a unit test asserting `ROLE_PERMISSION_MAP.staff` excludes `ISSUE_REFUNDS` and `owner` includes it.
- [ ] **Step 3:** Apply migration; run test PASS; **Commit** `feat(perms): permission taxonomy + tenant_user_permissions`.

---

## Task 2: Effective permissions + guards
**Interfaces:** `getEffectivePermissions(admin, tenantId, tenantUserId): Promise<Set<string>>`; `setPermissionOverride(admin, {tenantId, targetUserId, permission, effect, actorRole, actorPerms, actorUserId, reason})`; `resetPermissionOverride(...)`.

- [ ] **Step 1:** Test `getEffectivePermissions`: role defaults minus a `revoke` row, plus a `grant` row = expected set. Fixture the two queries (role from `tenant_users`, overrides from `tenant_user_permissions`).
- [ ] **Step 2:** Implement composition (role defaults via existing `getAllPermissionsForRole`, then apply overrides).
- [ ] **Step 3:** Test guards: setting an override without `MANAGE_STAFF` → throws; revoking from an owner → throws; granting a permission the actor lacks → throws; granting within own set → ok.
- [ ] **Step 4:** Implement `overrides.ts` with guards; emit `staff.permission_changed` (before/after) via `recordBusinessEvent`.
- [ ] **Step 5:** PASS; **Commit** `feat(perms): effective-permission resolution + guards`.

---

## Task 3: Wire into auth context + identity resolver
- [ ] **Step 1:** In `server-auth.ts`, after resolving the tenant user, populate `user.permissions = Array.from(await getEffectivePermissions(...))`. Add a test/regression: a route using only `roles:[]` still authorizes unchanged.
- [ ] **Step 2:** Extend `identityResolver.ts` to also return `tenant_user_id` (and `user_id`) alongside `role`. Update its tests.
- [ ] **Step 3:** PASS + typecheck; **Commit** `feat(perms): resolve effective permissions at auth + expose tenant_user_id`.

---

## Task 4: Rewire capability stub (consolidation §D)
- [ ] **Step 1:** In `capabilityMap.ts`, replace `hasCapability(role, cap)` with a mapping `CAP_TO_PERMISSION` and a `hasPermission(effective: Set<string>, permission)` check. Map refund→ISSUE_REFUNDS, discount→ISSUE_DISCOUNTS, adjust_stock→ADJUST_INVENTORY, manage_staff→MANAGE_STAFF, approve_anomalies→APPROVE_ANOMALIES, delete→per-action MANAGE_*.
- [ ] **Step 2:** Update the owner-command dispatcher (spec 2 Task 8) to resolve `effective = getEffectivePermissions(admin, tenantId, tenantUserId)` and gate on `hasPermission`. Enumerate every capability call site (dispatcher write handlers, `set_staff_capability`, spec-3 anomaly PATCH). Grep: `grep -rn "hasCapability\|capability:" src/lib/booking src/app/api/owner/anomalies`.
- [ ] **Step 3:** `set_staff_capability` now calls `setPermissionOverride`/`resetPermissionOverride`. Test "remove payment permissions from Chidi" writes a `revoke RECORD_PAYMENTS` row + emits event.
- [ ] **Step 4:** PASS; **Commit** `feat(perms): rewire commerce/anomaly capability stub to real permissions`.

---

## Task 5: Enforce on high-risk routes + denied logging
- [ ] **Step 1:** Add `permissions:[]` to payments record/refund routes, staff-management routes, and specs 1–3 owner routes (close-reports → VIEW_REVENUE; anomalies → APPROVE_ANOMALIES; per consolidation §G). Regression test: a `roles:[]`-only route unaffected.
- [ ] **Step 2:** In `route-handler.ts` permission-failure path and the dispatcher, emit `access.denied`/`command.denied` `business_events` (best-effort). Test a denied refund logs it.
- [ ] **Step 3:** PASS + typecheck; **Commit** `feat(perms): enforce granular permissions on high-risk routes + denied-action logging`.

---

## Self-Review
**Spec coverage:** taxonomy → Task 1; overrides+guards → Task 2; resolution/auth/identity → Task 3; rewire stub → Task 4; enforcement+audit → Task 5. **Placeholder scan:** clean (grep-guided rewire is concrete). **Type consistency:** `getEffectivePermissions`/`setPermissionOverride`/`CAP_TO_PERMISSION`/`hasPermission(Set,perm)` consistent. **Cross-spec:** §D rewire checklist enumerated in Task 4; §G route mapping in Task 5; owner protection + no-self-escalation enforced.
