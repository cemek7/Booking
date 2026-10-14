# Booka Identity and Tenant Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Complete Booka's secure tenant invitation and login-email-change flows while keeping Supabase as the identity provider and Booka as the tenant authorization authority.

**Architecture:** Store only SHA-256 invitation token hashes in a new RLS-protected table. Open raw-token links through a server route that moves the token into an HttpOnly cookie, then atomically validate identity and grant membership through a service-role-only PostgreSQL function. Initiate login-email changes through the signed-in user's Supabase session, and synchronize denormalized membership emails only after Supabase confirms the new identity email.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth/Postgres, `@supabase/ssr`, Zod, Resend, Jest, Testing Library, PostgreSQL SQL migrations.

**Spec:** `docs/superpowers/specs/2026-10-14-booka-identity-and-tenant-invitations-design.md`

## Global Constraints

- Preserve `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md` untouched.
- Do not modify migration 160 or any existing migration.
- Do not apply migrations or change Supabase, Paystack, GitHub, or VPS settings as an agent.
- Never log, return, persist, or expose a raw invitation token outside its email link and HttpOnly cookie.
- Never use `git add .` or `git add -A`; stage only named files.
- Keep staging and production origins separate.
- Use a throwaway worktree for cross-branch staging work and fast-forward-only pushes.
- Complete every automated and manual gate before production promotion.

---

## Task 1: Add the Secure Invitation Schema and Atomic Acceptance Function

**Files:**

- Create: `db/migrations/161_secure_tenant_invitations.sql`
- Create: `db/migrations/161_secure_tenant_invitations_verify.sql`
- Test: `src/lib/auth/tenant-invitation-migration.test.ts`

- [ ] **Step 1: Write a failing migration contract test**

Create `src/lib/auth/tenant-invitation-migration.test.ts`. Read both SQL files as text and assert the contract before the files exist:

```ts
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(process.cwd(), 'db/migrations/161_secure_tenant_invitations.sql');
const verifyPath = path.join(process.cwd(), 'db/migrations/161_secure_tenant_invitations_verify.sql');

describe('secure tenant invitation migration', () => {
  const migration = () => fs.readFileSync(migrationPath, 'utf8');
  const verifier = () => fs.readFileSync(verifyPath, 'utf8');

  it('stores only a constrained SHA-256 token hash', () => {
    expect(migration()).toMatch(/token_hash text not null unique/i);
    expect(migration()).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/i);
    expect(migration()).not.toMatch(/\btoken\s+text/i);
  });

  it('limits roles and protects the table with RLS', () => {
    expect(migration()).toMatch(/role in \('manager', 'staff'\)/i);
    expect(migration()).toMatch(/enable row level security/i);
  });

  it('restricts the acceptance function to service_role', () => {
    expect(migration()).toMatch(/revoke execute.*public/i);
    expect(migration()).toMatch(/revoke execute.*authenticated/i);
    expect(migration()).toMatch(/grant execute.*service_role/i);
  });

  it('ships a verifier for schema, RLS, indexes, and grants', () => {
    expect(verifier()).toMatch(/tenant_invitations/i);
    expect(verifier()).toMatch(/rowsecurity/i);
    expect(verifier()).toMatch(/service_role/i);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
npm test -- src/lib/auth/tenant-invitation-migration.test.ts --runInBand
```

Expected: FAIL because migration 161 does not exist.

- [ ] **Step 3: Create the additive migration**

Create `public.tenant_invitations` with these exact fields:

```sql
create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email <> ''),
  role text not null check (role in ('manager', 'staff')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check ((accepted_at is null and accepted_by is null) or
         (accepted_at is not null and accepted_by is not null))
);
```

Add:

- a lookup index on `token_hash`;
- a tenant/email history index;
- a partial unique index on `(tenant_id, email)` where `accepted_at is null and revoked_at is null`;
- RLS enabled and forced;
- no browser policies or table grants;
- `service_role` table privileges only.

Create `public.accept_tenant_invitation(p_token_hash text, p_user_id uuid, p_user_email text)` as `security invoker` with `set search_path = ''` and fully qualified relation names. The service role already bypasses RLS, so definer privileges are unnecessary. The function must:

1. lock the matching invitation using `for update`;
2. return stable error codes for missing, expired, accepted, revoked, mismatch, and membership conflict;
3. compare `lower(btrim(p_user_email))` with the stored email;
4. allow only `manager` or `staff`;
5. insert a new `tenant_users` row or attach a matching email-based roster row whose `user_id` is null, without changing an existing authenticated member's role;
6. set `accepted_at` and `accepted_by` in the same transaction;
7. return `tenant_id`, `role`, and `invitation_id`;
8. revoke execute from `PUBLIC`, `anon`, and `authenticated`;
9. grant execute only to `service_role`.

Do not query `auth.users` inside the function. The route supplies identity data obtained from a verified Supabase session.

- [ ] **Step 4: Create the owner-run verification script**

Make `161_secure_tenant_invitations_verify.sql` fail with `raise exception` unless all required columns, checks, indexes, RLS flags, function properties, and grants exist. Include a rollback-safe transaction for fixture checks and end it with `rollback`.

- [ ] **Step 5: Run the migration contract test**

Run:

```bash
npm test -- src/lib/auth/tenant-invitation-migration.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit the schema slice**

```bash
git add db/migrations/161_secure_tenant_invitations.sql db/migrations/161_secure_tenant_invitations_verify.sql src/lib/auth/tenant-invitation-migration.test.ts
git commit -m "feat(auth): add secure tenant invitation schema"
```

## Task 2: Build Invitation Token, Origin, and Policy Helpers

**Files:**

- Create: `src/lib/auth/tenant-invitations.ts`
- Create: `src/lib/http/public-origin.ts`
- Create: `src/lib/auth/tenant-invitations.test.ts`
- Create: `src/lib/http/public-origin.test.ts`
- Modify: `src/app/api/auth/callback/route.ts`

- [ ] **Step 1: Write failing helper tests**

Test these public contracts:

```ts
generateInvitationToken(): { rawToken: string; tokenHash: string }
hashInvitationToken(rawToken: string): string
normalizeInvitationEmail(email: string): string
maskInvitationEmail(email: string): string
assertInvitationRoleAllowed(actorRole: string, invitedRole: string): void
assertInvitationDomainAllowed(email: string, allowedDomains: string[]): void
getPublicOrigin(request: Pick<NextRequest, 'url' | 'headers'>): string
buildPublicUrl(request: NextRequest, path: string): URL
getConfiguredPublicOrigin(): string
```

Assertions must cover:

- 32 random bytes encoded as base64url;
- lowercase 64-character SHA-256 hashes;
- deterministic hashing;
- trimmed lowercase email normalization;
- masking that never returns the full local part;
- owner to manager/staff allowed;
- manager to staff allowed;
- manager to manager and every staff invitation rejected;
- exact and subdomain domain matching, without suffix tricks such as `evil-example.com`;
- staging forwarded host remains staging even when production environment URLs exist;
- CR/LF, ports, credentials, and untrusted protocols are rejected;
- internal container hosts fall back to a configured public origin.
- background jobs resolve one validated origin from `APP_PUBLIC_URL` and reject missing or unsafe values.

- [ ] **Step 2: Run tests and confirm failures**

```bash
npm test -- src/lib/auth/tenant-invitations.test.ts src/lib/http/public-origin.test.ts --runInBand
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement the helpers**

Use Node's `randomBytes(32)`, `createHash('sha256')`, and `timingSafeEqual` where comparisons contain fixed-length hashes. Keep stable error codes on a typed `InvitationError`:

```ts
export type InvitationErrorCode =
  | 'invite_invalid'
  | 'invite_expired'
  | 'invite_consumed'
  | 'invite_email_mismatch'
  | 'invite_membership_conflict'
  | 'invite_forbidden';
```

Allow only `https` outside local development. Trust the first `x-forwarded-host` and `x-forwarded-proto` value after strict host validation. Do not let `NEXT_PUBLIC_APP_URL` override a valid external request host.

- [ ] **Step 4: Replace callback-local origin helpers**

Import `getPublicOrigin` and `buildPublicUrl` into `src/app/api/auth/callback/route.ts`. Preserve `normalizeInternalPath` and all current redirects. Add a regression test to the existing callback test suite, or create `src/app/api/auth/callback/route.test.ts`, proving staging remains staging.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- src/lib/auth/tenant-invitations.test.ts src/lib/http/public-origin.test.ts src/app/api/auth/callback/route.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit the helper slice**

```bash
git add src/lib/auth/tenant-invitations.ts src/lib/auth/tenant-invitations.test.ts src/lib/http/public-origin.ts src/lib/http/public-origin.test.ts src/app/api/auth/callback/route.ts src/app/api/auth/callback/route.test.ts
git commit -m "refactor(auth): centralize secure public origins"
```

## Task 3: Centralize Secure Invitation Issuance and Delivery

**Files:**

- Modify: `src/app/api/tenants/[tenantId]/invites/route.ts`
- Create: `src/app/api/tenants/[tenantId]/invites/route.test.ts`
- Create: `src/lib/auth/issue-tenant-invitation.ts`
- Create: `src/lib/auth/issue-tenant-invitation.test.ts`
- Modify: `src/lib/integrations/email-service.ts`
- Modify: `src/__tests__/lib/integrations/email-service.test.ts`
- Modify: `src/components/staff/StaffInviteModal.tsx`
- Create: `src/components/staff/StaffInviteModal.test.tsx`

- [ ] **Step 1: Write failing route tests**

Test the server-only `issueTenantInvitation` service independently, then mock it
from the HTTP route. Cover:

- owner invites manager and staff;
- manager invites staff;
- manager inviting manager is forbidden server-side;
- staff cannot invite;
- invalid roles fail Zod validation;
- disabled invitation setting fails;
- allowed-domain mismatch fails;
- an active membership fails;
- a prior pending invitation is revoked before resend;
- inserted data contains `token_hash`, never raw `token`;
- expiry is seven days;
- response is exactly `{ ok: true, email_sent: true, expires_at }`;
- response and structured logs exclude raw token and invite URL;
- failed Resend delivery revokes the newly inserted invitation and returns an error;
- staging requests create staging links.

The service input is explicit and channel-independent:

```ts
type IssueTenantInvitationInput = {
  tenantId: string;
  actorUserId: string;
  actorRole: 'owner' | 'manager';
  actorEmail: string | null;
  invitedEmail: string;
  invitedRole: 'manager' | 'staff';
  publicOrigin: string;
  source: 'dashboard' | 'owner_api' | 'manager_api' | 'whatsapp_v2';
};
```

- [ ] **Step 2: Write failing email and modal tests**

Email tests must assert the link is escaped in HTML, the plain-text alternative exists, and `sendTenantInviteEmail` returns the provider result. Modal tests must assert success says `Invitation sent` and never renders `json.url`.

- [ ] **Step 3: Run focused tests and confirm failures**

```bash
npm test -- 'src/app/api/tenants/[tenantId]/invites/route.test.ts' src/__tests__/lib/integrations/email-service.test.ts src/components/staff/StaffInviteModal.test.tsx --runInBand
```

Expected: FAIL against the legacy flow.

- [ ] **Step 4: Replace the legacy creation flow**

Change the request schema to:

```ts
const InviteBodySchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  role: z.enum(['manager', 'staff']).default('staff'),
});
```

Implement the database, policy, token, audit, and email work in
`issueTenantInvitation`. Use the admin client for all `tenant_invitations`
writes. Keep authorization checks server-side. Treat
`disablePublicInvites === true` or `allowInvitesFromStaffPage === false` as
disabled. Revoke an existing pending row, generate a fresh token, store its
hash, and await `sendTenantInviteEmail`. The dashboard route validates the
request and delegates to this service; it must not duplicate issuance logic.

Build this URL from the request origin:

```ts
const inviteUrl = buildPublicUrl(
  ctx.request,
  `/api/invitations/open?token=${encodeURIComponent(rawToken)}`
).toString();
```

If the mail result is not successful, or the call throws, set `revoked_at` on the new row and return a stable delivery failure. Log only invitation ID, tenant ID, actor ID, action, and outcome.

- [ ] **Step 5: Update email delivery and UI**

Make `sendTenantInviteEmail` await and return `sendTransactionalEmail`. Keep the invited address out of logs beyond the existing masked transport output. Change the modal success toast to `Invitation sent to ${value}` without reading any URL or token from JSON.

- [ ] **Step 6: Run focused tests**

```bash
npm test -- src/lib/auth/issue-tenant-invitation.test.ts 'src/app/api/tenants/[tenantId]/invites/route.test.ts' src/__tests__/lib/integrations/email-service.test.ts src/components/staff/StaffInviteModal.test.tsx --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit the creation slice**

```bash
git add 'src/app/api/tenants/[tenantId]/invites/route.ts' 'src/app/api/tenants/[tenantId]/invites/route.test.ts' src/lib/auth/issue-tenant-invitation.ts src/lib/auth/issue-tenant-invitation.test.ts src/lib/integrations/email-service.ts src/__tests__/lib/integrations/email-service.test.ts src/components/staff/StaffInviteModal.tsx src/components/staff/StaffInviteModal.test.tsx
git commit -m "feat(auth): issue secure tenant invitations"
```

## Task 4: Route Every Alternative and In-Chat Invite Through the Secure Service

**Files:**

- Modify: `src/app/api/owner/staff/route.ts`
- Modify: `src/app/api/manager/team/route.ts`
- Modify: `src/lib/services/owner-staff-service.ts`
- Modify: `src/lib/services/manager-team-service.ts`
- Create: `src/app/api/owner/staff/route.test.ts`
- Create: `src/app/api/manager/team/route.test.ts`
- Modify: `src/lib/booking/action-validator.ts`
- Modify: `src/lib/booking/capabilityMap.ts`
- Modify: `src/lib/ai/context-builder.ts`
- Modify: `src/lib/whatsapp/v2/flows/ownerCommands.ts`
- Modify: `src/lib/whatsapp/v2/flows/ownerCommands.test.ts`

- [ ] **Step 1: Write failing alternate-API tests**

Assert that owner `action: invite` and manager `action: invite-member` call
`issueTenantInvitation`. They must never insert inactive `tenant_users` rows.
Owners may invite manager or staff. Managers may invite staff only. Both return
delivery state without tokens or URLs.

- [ ] **Step 2: Write failing WhatsApp v2 tests**

Add a distinct `invite_staff` AI action. Cover:

- it requires `name` and a valid `email`;
- role defaults to `staff` and only accepts `manager` or `staff`;
- it is a write action requiring confirmation and idempotency;
- it maps to `MANAGE_STAFF` in the capability map;
- owner may invite manager or staff;
- manager may invite staff but not manager;
- staff is denied even if the model proposes the action;
- an actor without a linked Supabase `user_id` receives a safe instruction to use the dashboard;
- it calls `issueTenantInvitation` with source `whatsapp_v2` and the configured environment origin;
- it awaits email delivery before saying the invitation was sent;
- the existing v2 action-log idempotency gate prevents a retry from issuing a second token;
- no chat response, action log, or business event contains the raw token or invite URL;
- the existing `add_staff` action still creates roster-only workers and never grants login access.

- [ ] **Step 3: Run tests and confirm failures**

```bash
npm test -- src/app/api/owner/staff/route.test.ts src/app/api/manager/team/route.test.ts src/lib/whatsapp/v2/flows/ownerCommands.test.ts --runInBand
```

- [ ] **Step 4: Delegate alternate APIs to the issuance service**

Remove invitation inserts from `inviteStaffMember` and `inviteTeamMember`.
Either make both thin wrappers around `issueTenantInvitation`, or call the
service from their routes and delete the unused invite methods. Preserve list,
update, active-status, and removal behavior.

- [ ] **Step 5: Implement the v2 in-chat invitation action**

Add `invite_staff` to `AIAction`, validation, the owner-command prompt schema,
write-action classification, and `capabilityMap`. Extend execution context to
carry the resolved actor's true role and Supabase user ID. Call
`issueTenantInvitation` only after existing confirmation and permission gates.

Do not replace `add_staff`: it creates bookable roster records during onboarding
and operations. `invite_staff` grants a Booka login after email verification.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/app/api/owner/staff/route.test.ts src/app/api/manager/team/route.test.ts src/lib/whatsapp/v2/flows/ownerCommands.test.ts --runInBand
git add src/app/api/owner/staff/route.ts src/app/api/owner/staff/route.test.ts src/app/api/manager/team/route.ts src/app/api/manager/team/route.test.ts src/lib/services/owner-staff-service.ts src/lib/services/manager-team-service.ts src/lib/booking/action-validator.ts src/lib/booking/capabilityMap.ts src/lib/ai/context-builder.ts src/lib/whatsapp/v2/flows/ownerCommands.ts src/lib/whatsapp/v2/flows/ownerCommands.test.ts
git commit -m "feat(auth): secure v2 in-chat staff invites"
```

## Task 5: Move Invite Tokens into an HttpOnly Cookie

**Files:**

- Create: `src/app/api/invitations/open/route.ts`
- Create: `src/app/api/invitations/open/route.test.ts`
- Create: `src/app/invitation-invalid/page.tsx`
- Create: `src/lib/auth/invitation-cookie.ts`
- Create: `src/lib/auth/invitation-cookie.test.ts`

- [ ] **Step 1: Write failing cookie and open-route tests**

Use one constant cookie name, `booka_tenant_invitation`. Assert:

- missing, malformed, unknown, expired, accepted, and revoked tokens all redirect to the same generic invalid page;
- valid tokens set an HttpOnly, Secure-in-production, SameSite=Lax, Path=/ cookie;
- cookie maximum age is no more than seven days and no longer than the invitation's remaining life;
- successful redirect is `/accept-invite` on the request origin;
- every response sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store`;
- redirect locations never contain the raw token;
- no log contains the raw token.

- [ ] **Step 2: Run tests and confirm failures**

```bash
npm test -- src/lib/auth/invitation-cookie.test.ts src/app/api/invitations/open/route.test.ts --runInBand
```

- [ ] **Step 3: Implement cookie helpers and the open route**

The route hashes the query token immediately, queries `tenant_invitations` by `token_hash`, and uses a single generic invalid redirect for every invalid state. Do not reflect an error reason into the URL. Set the raw token cookie only after database validation.

- [ ] **Step 4: Add the generic invalid-link page**

Render a short message: `This invitation link is invalid or no longer available.` Provide a link to `/booka/auth/signin`. Do not distinguish expired, consumed, revoked, or unknown invitations.

- [ ] **Step 5: Run focused tests and commit**

```bash
npm test -- src/lib/auth/invitation-cookie.test.ts src/app/api/invitations/open/route.test.ts --runInBand
git add src/lib/auth/invitation-cookie.ts src/lib/auth/invitation-cookie.test.ts src/app/api/invitations/open/route.ts src/app/api/invitations/open/route.test.ts src/app/invitation-invalid/page.tsx
git commit -m "feat(auth): secure invitation links in cookies"
```

## Task 6: Expose Safe Invitation Status

**Files:**

- Create: `src/app/api/invitations/status/route.ts`
- Create: `src/app/api/invitations/status/route.test.ts`

- [ ] **Step 1: Write failing status-route tests**

Assert that a valid cookie returns:

```ts
{
  valid: true,
  tenant: { id: string, name: string },
  role: 'manager' | 'staff',
  masked_email: string,
  expires_at: string,
  authenticated: boolean,
  email_matches: boolean | null
}
```

Assert the response never contains the full invite email or token. Invalid states return `{ valid: false }` with the same status and shape. Set `Cache-Control: no-store`.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- src/app/api/invitations/status/route.test.ts --runInBand
```

- [ ] **Step 3: Implement the route**

Read and hash the cookie server-side. Join only the tenant display name. Detect the current Supabase user through the server session. Return `email_matches: null` when signed out and a boolean when signed in.

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- src/app/api/invitations/status/route.test.ts --runInBand
git add src/app/api/invitations/status/route.ts src/app/api/invitations/status/route.test.ts
git commit -m "feat(auth): expose safe invitation status"
```

## Task 7: Accept Invitations Atomically

**Files:**

- Create: `src/app/api/invitations/accept/route.ts`
- Create: `src/app/api/invitations/accept/route.test.ts`

- [ ] **Step 1: Write failing acceptance tests**

Use `createHttpHandler` with `{ auth: true, requireTenantMembership: false }`. Test:

- signed-out request is rejected;
- missing cookie returns `invite_invalid`;
- route hashes the cookie and never passes the raw token to RPC;
- RPC receives the verified user ID and session email;
- wrong email returns `invite_email_mismatch`;
- expired, revoked, consumed, and membership-conflict codes are mapped safely;
- successful acceptance returns a role-specific redirect;
- cookie is cleared on success;
- replay does not change membership or role;
- two concurrent RPC calls produce one membership and one consumed result;
- logs never contain token or full callback URL.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- src/app/api/invitations/accept/route.test.ts --runInBand
```

- [ ] **Step 3: Implement the route**

Call the admin client's `rpc('accept_tenant_invitation', ...)`. Use `/dashboard/staff-dashboard` for staff and `/dashboard` for manager. Return JSON with `ok`, `tenant_id`, `role`, and `redirect_to`; never return invitation details or tokens.

For PostgreSQL exceptions, map only recognized stable codes. Return `invite_invalid` for unknown database details to avoid leaking internals.

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- src/app/api/invitations/accept/route.test.ts --runInBand
git add src/app/api/invitations/accept/route.ts src/app/api/invitations/accept/route.test.ts
git commit -m "feat(auth): accept tenant invitations atomically"
```

## Task 8: Build the Invite Acceptance Page and Resume Sign-In

**Files:**

- Create: `src/app/accept-invite/page.tsx`
- Create: `src/components/auth/AcceptInvitation.tsx`
- Create: `src/components/auth/AcceptInvitation.test.tsx`
- Modify: `src/components/AuthMagicLinkForm.tsx`
- Modify: `src/components/__tests__/AuthMagicLinkForm.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Cover:

- valid signed-out invite shows tenant, role, masked email, and `Sign in to accept`;
- the sign-in link/form carries `next=/accept-invite`;
- signed-in matching account shows `Accept invitation`;
- signed-in mismatched account shows a safe sign-out/use-invited-address message;
- acceptance disables repeated clicks and navigates to the returned internal path;
- invalid status shows the generic invalid message;
- no rendered HTML contains the raw token or full invited email.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- src/components/auth/AcceptInvitation.test.tsx --runInBand
```

- [ ] **Step 3: Implement the page and resume behavior**

Fetch `/api/invitations/status` with `cache: 'no-store'`. Reuse the existing magic-link request. Ensure its `emailRedirectTo` contains:

```text
/booka/auth/callback?finalize=1&next=/accept-invite
```

Keep the invitation cookie untouched through the Supabase round trip. Submit acceptance only after the callback creates a valid session.

- [ ] **Step 4: Run focused tests and commit**

```bash
npm test -- src/components/auth/AcceptInvitation.test.tsx src/components/__tests__/AuthMagicLinkForm.test.tsx --runInBand
git add src/app/accept-invite/page.tsx src/components/auth/AcceptInvitation.tsx src/components/auth/AcceptInvitation.test.tsx src/components/AuthMagicLinkForm.tsx src/components/__tests__/AuthMagicLinkForm.test.tsx
git commit -m "feat(auth): complete staff invitation acceptance"
```

## Task 9: Add Confirmed Login-Email Changes

**Files:**

- Create: `src/app/api/account/email/route.ts`
- Create: `src/app/api/account/email/route.test.ts`
- Modify: `src/app/api/auth/callback/route.ts`
- Modify: `src/app/api/auth/callback/route.test.ts`
- Modify: `src/lib/auth/email-callback.ts`
- Modify: `src/lib/auth/email-callback.test.ts`

- [ ] **Step 1: Write failing initiation tests**

Test that the protected endpoint:

- works for owner, manager, and staff without a role restriction;
- validates and normalizes a different email;
- rate-limits repeated requests using the project's existing rate-limit facility;
- calls the user-scoped `ctx.supabase.auth.updateUser`, never admin auth;
- sends `emailRedirectTo` to the request origin at `/booka/auth/callback?finalize=1&next=/dashboard/settings?tab=security`;
- returns a neutral `confirmation_sent` response;
- does not update `tenant_users` during initiation.

- [ ] **Step 2: Write failing callback synchronization tests**

Cover `type=email_change`, successful verified sessions, and admin updates of every `tenant_users` row for the immutable user ID. Assert:

- sync happens only after token verification returns a session;
- sync uses `session.user.id` and normalized `session.user.email`;
- verification failure performs no sync;
- database sync failure returns a safe callback error and is logged without security tokens;
- staging callbacks remain on staging;
- unsupported token types remain rejected.

- [ ] **Step 3: Run focused tests and confirm failures**

```bash
npm test -- src/app/api/account/email/route.test.ts src/app/api/auth/callback/route.test.ts src/lib/auth/email-callback.test.ts --runInBand
```

- [ ] **Step 4: Implement initiation**

Use:

```ts
await ctx.supabase.auth.updateUser(
  { email: normalizedEmail },
  { emailRedirectTo: callbackUrl.toString() }
);
```

Use `{ auth: true, requireTenantMembership: false }`. Never use `auth.admin.updateUserById`.

- [ ] **Step 5: Implement post-confirmation synchronization**

After verified `email_change`, update `tenant_users.email` for every row matching `session.user.id`. Do this before classification and redirect. Add a structured success/failure event without old/new confirmation URLs or tokens.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/app/api/account/email/route.test.ts src/app/api/auth/callback/route.test.ts src/lib/auth/email-callback.test.ts --runInBand
git add src/app/api/account/email/route.ts src/app/api/account/email/route.test.ts src/app/api/auth/callback/route.ts src/app/api/auth/callback/route.test.ts src/lib/auth/email-callback.ts src/lib/auth/email-callback.test.ts
git commit -m "feat(auth): add confirmed login email changes"
```

## Task 10: Add the Account Email Settings UI

**Files:**

- Create: `src/components/settings/AccountEmailSection.tsx`
- Create: `src/components/settings/AccountEmailSection.test.tsx`
- Modify: `src/components/settings/SettingsWorkspace.tsx`
- Modify: `src/components/settings/SettingsWorkspace.test.tsx`

- [ ] **Step 1: Write failing component tests**

Cover:

- current verified email is displayed;
- submit rejects blank, invalid, or unchanged email;
- successful response says both old and new addresses must confirm;
- no success message claims the email changed immediately;
- server errors remain safe and actionable;
- controls work for staff, manager, and owner;
- the card renders on the Security tab independently from tenant security controls.

- [ ] **Step 2: Run tests and confirm failure**

```bash
npm test -- src/components/settings/AccountEmailSection.test.tsx src/components/settings/SettingsWorkspace.test.tsx --runInBand
```

- [ ] **Step 3: Implement the card**

Use the current Supabase user from the existing authenticated client/context. POST `{ email }` to `/api/account/email`. Clear the proposed email after success. Use copy such as:

```text
Check both your current and new inboxes. Your login email changes only after both links are confirmed.
```

- [ ] **Step 4: Add it to Security settings**

Render `AccountEmailSection` before tenant-level `SecuritySettingsSection` when `active.key === 'security'`. Do not store login email in tenant settings.

- [ ] **Step 5: Run tests and commit**

```bash
npm test -- src/components/settings/AccountEmailSection.test.tsx src/components/settings/SettingsWorkspace.test.tsx --runInBand
git add src/components/settings/AccountEmailSection.tsx src/components/settings/AccountEmailSection.test.tsx src/components/settings/SettingsWorkspace.tsx src/components/settings/SettingsWorkspace.test.tsx
git commit -m "feat(settings): add login email change flow"
```

## Task 11: Add Copy-Paste Supabase Templates and Owner Runbook

**Files:**

- Create: `docs/runbooks/booka-supabase-auth-templates.md`
- Create: `src/lib/auth/supabase-template-contract.test.ts`

- [ ] **Step 1: Write a failing documentation contract test**

Read the runbook and assert:

- complete HTML sections exist for Magic Link, Confirm Signup, and Change Email;
- Magic Link and Confirm Signup use `{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email`;
- Change Email uses `type=email_change`;
- enabled templates contain no `{{ .ConfirmationURL }}`;
- fallback text is a labeled anchor, not a printed raw URL;
- the runbook states Supabase Invite and Recovery are unused;
- the exact staging and production globstar callback allow-list entries appear;
- Secure Email Change is explicitly enabled;
- no secret values appear.

- [ ] **Step 2: Run the test and confirm failure**

```bash
npm test -- src/lib/auth/supabase-template-contract.test.ts --runInBand
```

- [ ] **Step 3: Write the owner runbook**

Include complete copy-paste HTML for all three enabled templates. Use both a primary button and a short fallback label. Include dashboard steps for:

1. Authentication → URL Configuration;
2. Authentication → Email Templates;
3. Authentication → Providers → Email → Secure Email Change;
4. a staging-only link inspection before clicking;
5. rollback to the prior saved template text.

State clearly that agents do not perform these dashboard changes.

- [ ] **Step 4: Run the contract test and commit**

```bash
npm test -- src/lib/auth/supabase-template-contract.test.ts --runInBand
git add docs/runbooks/booka-supabase-auth-templates.md src/lib/auth/supabase-template-contract.test.ts
git commit -m "docs(auth): add Supabase email templates"
```

## Task 12: Run Automated Verification and Security Regression Checks

**Files:**

- Modify only files required by failures in Tasks 1–11

- [ ] **Step 1: Run all focused auth and invitation tests**

```bash
npm test -- src/lib/auth/tenant-invitation-migration.test.ts src/lib/auth/tenant-invitations.test.ts src/lib/auth/issue-tenant-invitation.test.ts src/lib/auth/invitation-cookie.test.ts src/lib/auth/email-callback.test.ts src/lib/auth/supabase-template-contract.test.ts src/lib/http/public-origin.test.ts src/app/api/auth/callback/route.test.ts src/app/api/account/email/route.test.ts src/app/api/invitations/open/route.test.ts src/app/api/invitations/status/route.test.ts src/app/api/invitations/accept/route.test.ts 'src/app/api/tenants/[tenantId]/invites/route.test.ts' src/app/api/owner/staff/route.test.ts src/app/api/manager/team/route.test.ts src/lib/whatsapp/v2/flows/ownerCommands.test.ts src/components/auth/AcceptInvitation.test.tsx src/components/__tests__/AuthMagicLinkForm.test.tsx src/components/staff/StaffInviteModal.test.tsx src/components/settings/AccountEmailSection.test.tsx src/components/settings/SettingsWorkspace.test.tsx src/__tests__/lib/integrations/email-service.test.ts --runInBand
```

Expected: PASS.

- [ ] **Step 2: Search for legacy and leaked invite behavior**

```bash
rg -n "from\('invites'\)|json\.url|token: tokenValue|/accept-invite\?token=|\.ConfirmationURL|is_active: false" src docs/runbooks/booka-supabase-auth-templates.md
```

Expected: no active legacy invite writes, no raw token responses, and no `.ConfirmationURL` in enabled templates. Test fixtures may mention forbidden patterns only to assert their absence.

- [ ] **Step 3: Run lint, typecheck, full tests, and diff checks**

```bash
npx eslint src/lib/auth src/lib/http/public-origin.ts src/app/api/auth/callback/route.ts src/app/api/account/email src/app/api/invitations 'src/app/api/tenants/[tenantId]/invites' src/components/auth/AcceptInvitation.tsx src/components/staff/StaffInviteModal.tsx src/components/settings/AccountEmailSection.tsx src/components/settings/SettingsWorkspace.tsx
npm run typecheck:ci
npm test -- --runInBand
git diff --check
git status --short
```

Expected: all commands pass. `git status --short` may show the preserved owner file, but no unintended modifications.

- [ ] **Step 4: Perform a security-focused review**

Verify manually from the diff:

- every raw token path ends at the invite email and HttpOnly cookie;
- tenant role authorization occurs on the server and again in SQL;
- only `service_role` can execute the acceptance function;
- callback `next` values remain internal paths;
- untrusted hosts cannot control public URLs;
- email changes use user-scoped Auth APIs;
- logs omit raw tokens, full callback URLs, and security codes;
- invitation and email-change responses do not disclose Supabase account existence.

- [ ] **Step 5: Commit any verification fixes explicitly**

Stage only named corrected files and use:

```bash
git commit -m "fix(auth): close invitation security gaps"
```

Skip this commit when no fixes were needed.

## Task 13: Owner-Run Staging Deployment and Manual Gates

**Files:**

- Modify: `docs/superpowers/plans/2026-10-05-paystack-setup-handoff.md`
- Modify: `docs/superpowers/specs/2026-10-14-booka-identity-and-tenant-invitations-design.md`
- Do not modify: `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md`

- [ ] **Step 1: Present the migration gate to the owner**

Ask the owner to run migration 161 and its verifier in the shared Booking Supabase project. Do not continue deployment until the owner confirms both completed without exceptions.

- [ ] **Step 2: Present the Supabase configuration gate**

Ask the owner to install the three templates, retain these callback allow-list entries, and enable Secure Email Change:

```text
https://staging.app.techclave.cloud/booka/auth/callback**
https://app.techclave.cloud/booka/auth/callback**
```

Do not ask for secret values or screenshots containing tokens.

- [ ] **Step 3: Push staging through a throwaway worktree**

Fetch first, confirm staging can fast-forward to the tested commit, then push fast-forward only. Do not merge from the current feature worktree.

```bash
git fetch origin
git merge-base --is-ancestor origin/staging HEAD
```

If the ancestor check fails, stop and reconcile in a throwaway worktree without force-pushing.

- [ ] **Step 4: Confirm CI and immutable image deployment**

Verify the GitHub workflow passes, the staging image is published, the VPS refresh service finishes, and `/api/version` reports the expected commit. Do not change VPS secrets during this task.

- [ ] **Step 5: Run the staging identity gates**

Have the owner test, in order:

1. an existing user accepts a staff invite;
2. a new user accepts a staff invite through email sign-in;
3. a wrong signed-in account cannot accept another address's invite;
4. used and expired links cannot be replayed;
5. an owner issues an in-chat v2 staff invite and the recipient accepts it;
6. a manager's in-chat manager invite is denied while a staff invite succeeds;
7. an owner confirms a login-email change from both inboxes;
8. the old email stops signing in and the new email retains every membership.

Record pass/fail only. Never paste live invite or confirmation links into documentation or chat.

- [ ] **Step 6: Resume the Paystack Part A gates**

After all identity gates pass, continue the existing Paystack staging checklist from `Remaining work — Part A`. Keep production promotion blocked until both sets of gates pass.

- [ ] **Step 7: Update handoff state**

Update the design status from `Approved design; implementation not started` to the verified state actually reached. Update the Paystack handoff with commit IDs, CI run, deployed version, migration/template confirmations, identity gate results, and the next incomplete Paystack step.

- [ ] **Step 8: Commit documentation state**

```bash
git add docs/superpowers/plans/2026-10-05-paystack-setup-handoff.md docs/superpowers/specs/2026-10-14-booka-identity-and-tenant-invitations-design.md
git commit -m "docs(auth): record staging identity verification"
```

## Definition of Done

- [ ] No application path writes to the legacy `invites` table.
- [ ] Raw invitation tokens are absent from database rows, API responses, logs, and visible post-open URLs.
- [ ] Tenant roles are granted only by the atomic service-role SQL function.
- [ ] Owner and manager invitation permissions are enforced server-side.
- [ ] Dashboard, alternate APIs, and WhatsApp v2 all use one issuance service.
- [ ] `invite_staff` issues login access while `add_staff` remains roster-only.
- [ ] Existing and first-time Supabase users can accept valid invitations.
- [ ] Wrong-email, replayed, expired, and revoked invitations are rejected safely.
- [ ] All roles can request a dual-confirmed login-email change.
- [ ] Confirmed Auth email changes synchronize every membership row.
- [ ] Staging and production callbacks stay on their requesting host.
- [ ] Magic Link, Confirm Signup, and Change Email templates are branded and tested.
- [ ] Focused tests, full tests, lint, typecheck, CI, and staging gates pass.
- [ ] Production remains unchanged until explicit owner approval.
