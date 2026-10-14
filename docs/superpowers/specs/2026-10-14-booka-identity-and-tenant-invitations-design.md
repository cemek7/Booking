# Booka Identity and Tenant Invitations Design

**Date:** 2026-10-14  
**Status:** Approved design; implementation not started  
**Scope:** Supabase email identity, tenant staff invitations, login-email changes, and the associated email templates  
**Out of scope:** Password authentication, social login, MFA implementation, and production deployment

## 1. Outcome

Supabase remains Booka's only identity provider. Booka owns tenant membership because a verified Supabase identity does not, by itself, identify which tenant the person may join or which role that tenant granted.

The completed system must:

- let an owner invite a manager or staff member;
- let a manager invite staff only;
- authenticate invitees through the existing Supabase email flow;
- grant a tenant role only when the authenticated email matches a valid invitation;
- make invitations opaque, hashed at rest, single-use, revocable, and valid for seven days;
- let an authenticated user request a login-email change;
- require confirmation from both the old and new email addresses;
- synchronize the confirmed Auth email to Booka membership records;
- keep staging callbacks on staging and production callbacks on production;
- provide branded, working templates for every enabled Supabase email flow.

## 2. Existing Problems

### 2.1 Staff invitation acceptance is incomplete

`POST /api/tenants/[tenantId]/invites` inserts a raw UUID into the legacy `invites` table and sends a Resend email pointing to `/accept-invite?token=...`. No `/accept-invite` page or acceptance API exists. The endpoint returns the raw token and URL to the browser, sends email in an unawaited promise, and can report `email_sent: true` when delivery failed.

The legacy table has only `token`, `tenant_id`, `email`, `role`, and `created_at`. It has no expiry, accepted state, revocation state, inviter, or accepted identity.

### 2.2 API role enforcement is weaker than the UI

The staff modal hides the manager option from managers, but the endpoint accepts an arbitrary lower-cased role string. A caller must never gain a role that the server did not authorize.

### 2.3 Login-email changes do not exist

No settings control or API calls `supabase.auth.updateUser({ email })`. Booka therefore has no supported way to change the address used for passwordless sign-in. `tenant_users.email` can also drift from `auth.users.email` after an identity change.

### 2.4 Email links have two incompatible paths

The shared Supabase project serves staging and production. `{{ .ConfirmationURL }}` currently loses the requested callback path in this project, while direct GET verification of the PKCE-shaped hash fails. Booka now has a server callback capable of exchanging `token_hash`; templates must send hashes to that Booka callback instead of directly to Supabase `/verify`.

## 3. Architecture Decision

Use a hybrid invitation flow:

- Supabase proves identity and email ownership.
- Booka stores the pending tenant authorization.
- A service-role-only database function atomically validates and consumes the invitation while granting membership.

Rejected alternatives:

1. **Supabase Invite template alone.** It creates or authenticates an identity but cannot safely and atomically grant a Booka tenant role. Existing Supabase users also need to accept invitations.
2. **Booka-only authentication.** It duplicates token verification, sessions, and account security already provided by Supabase.
3. **Client-side membership insertion.** It exposes tenant authorization to browser state and is not acceptable.

## 4. Canonical Invitation Data

Migration `161_secure_tenant_invitations.sql` creates `tenant_invitations`; the legacy `invites` table remains untouched but becomes unused.

`tenant_invitations` contains:

- `id uuid primary key default gen_random_uuid()`;
- `tenant_id uuid not null references tenants(id) on delete cascade`;
- `email text not null` stored trimmed and lower-case;
- `role text not null check (role in ('manager', 'staff'))`;
- `token_hash text not null unique` containing lowercase SHA-256 hex only;
- `invited_by uuid not null`;
- `accepted_by uuid null`;
- `created_at timestamptz not null default now()`;
- `expires_at timestamptz not null` set to exactly seven days after creation;
- `accepted_at timestamptz null`;
- `revoked_at timestamptz null`.

Indexes support lookup by token hash and tenant/email. A partial unique index permits at most one unconsumed, unrevoked invitation for a tenant/email pair. Resending first revokes the prior pending row, including an expired row, then creates a new row.

RLS is enabled with no browser-write policy. The application accesses invitations through service-role server code. The raw token is never stored, returned to the inviter, logged, or placed in analytics.

Migration `161_secure_tenant_invitations_verify.sql` verifies columns, constraints, indexes, grants, function ownership, and RLS. The owner applies and verifies the migration; agents never apply it to a real Supabase project.

## 5. Invitation Creation

The existing tenant invite endpoint remains the entry point.

Server rules:

1. Normalize the requested email.
2. Confirm the caller belongs to the target tenant.
3. Owners may invite `manager` or `staff`; managers may invite `staff` only.
4. Apply the tenant's allowed-domain and invitation-enable settings server-side.
5. Reject an existing active membership for the same tenant/email.
6. Generate 32 random bytes and expose only the base64url raw token in the email.
7. Store `sha256(rawToken)` with the invitation and seven-day expiry.
8. Build the invite URL from the request's trusted public origin, so staging and production cannot cross.
9. Await Resend delivery. Return success only when the provider accepts the message.
10. Return `{ ok: true, email_sent: true, expires_at }`; never return the raw token or URL.

If email delivery fails, the new invitation is revoked and the endpoint returns an error. A resend revokes the old row and creates a new token. The response does not reveal whether the email owns an account in Supabase.

## 6. Invitation Opening and Sign-In

The email links to `/api/invitations/open?token=<raw-token>`.

The open route:

1. Hashes the raw token and finds an unaccepted, unrevoked, unexpired invitation.
2. Stores the raw token in an `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` cookie with a seven-day maximum age.
3. Responds with `Referrer-Policy: no-referrer` and redirects to `/accept-invite`, removing the token from the visible URL.
4. Returns the same generic invalid-link page for missing, unknown, expired, accepted, or revoked tokens.

`/accept-invite` requests invitation status from a server route. It may show tenant name, role, expiry, and a masked invited email. It never returns the full invited email before authentication.

If there is no Supabase session, the page sends the user through the existing Booka magic-link form with `next=/accept-invite`. The invitation cookie survives the cross-site Supabase verification redirect. The user must open the magic link in the same browser.

## 7. Atomic Invitation Acceptance

`POST /api/invitations/accept` requires an authenticated Supabase user and the invitation cookie.

The route gets the user from the verified server session, hashes the cookie token, and calls a service-role-only SQL function. The function locks the invitation row and atomically:

1. rejects missing, expired, accepted, or revoked invitations;
2. compares lower-cased `auth.users.email` with the invitation email;
3. revalidates the role constraint;
4. rejects a conflicting active membership;
5. inserts or activates `tenant_users` for the authenticated `user_id`;
6. records `accepted_at` and `accepted_by`;
7. returns the tenant ID and role.

The function has a fixed `search_path`, revokes execution from `PUBLIC`, `anon`, and `authenticated`, and grants execution only to `service_role`. The route clears the invitation cookie on success and redirects to the role-appropriate dashboard. Repeated acceptance cannot create a second membership or change a role.

Email mismatch returns a safe message instructing the user to sign out and use the invited address. It never changes either account.

## 8. Login-Email Change

Add an Account Email card to the Security settings tab for the signed-in user. This is an identity setting, not a tenant setting, and is available to owner, manager, and staff roles.

The flow:

1. Display the current login email from the verified Supabase user.
2. Accept and normalize a different valid email.
3. Call a protected server endpoint with the user's bearer/cookie session.
4. The endpoint invokes user-scoped `supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo })`; it never uses `admin.updateUserById`, which would bypass confirmation.
5. `emailRedirectTo` uses the request's public origin and `/booka/auth/callback?finalize=1&next=/dashboard/settings?tab=security`.
6. Supabase Secure Email Change must remain enabled so both old and new addresses confirm.
7. Until both confirmations complete, the old login email remains authoritative.
8. After the callback returns a session containing the new email, Booka updates every `tenant_users.email` row for that `user_id` through the admin client.
9. The UI reports that confirmations were sent to both addresses without claiming the change is complete.

The endpoint rate-limits repeated requests and returns generic conflict errors. Auth remains keyed by immutable Supabase `user_id`; the email sync only updates denormalized display and lookup fields.

## 9. Supabase Email Templates

Only enabled flows receive production-ready templates.

### 9.1 Magic Link and Confirm Signup

Both templates use the same Booka callback target:

```html
{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email
```

Both remove `{{ .ConfirmationURL }}` completely. Their button and fallback anchor use the callback above. The visible fallback is a short label, not a raw security URL.

### 9.2 Change Email

The branded Change Email template identifies `{{ .OldEmail }}` and `{{ .NewEmail }}` and uses:

```html
{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email_change
```

### 9.3 Supabase Invite and Recovery

Booka does not call `inviteUserByEmail`; tenant invitations use the Booka flow above. Booka is passwordless and has no password-recovery flow. These templates remain unused and must not be treated as release gates. If either feature is later enabled, its template and callback receive a separate test before release.

## 10. Environment Separation

All browser-initiated callback URLs use `window.location.origin`. All server-generated URLs derive from validated forwarded host/protocol headers or the environment's `APP_PUBLIC_URL`; a production-valued `NEXT_PUBLIC_APP_URL` never overrides a real staging request host.

Allowed Supabase redirect URLs retain exact callback entries and the path-scoped globstar entries:

- `https://staging.app.techclave.cloud/booka/auth/callback**`
- `https://app.techclave.cloud/booka/auth/callback**`

No wildcard may span arbitrary hosts.

## 11. Error Handling and Observability

- Invitation errors use stable codes: `invite_invalid`, `invite_expired`, `invite_consumed`, `invite_email_mismatch`, and `invite_membership_conflict`.
- Security logs include invitation ID, tenant ID, actor user ID, action, and outcome; they never include raw tokens or full callback URLs.
- Resend failures are awaited and surfaced.
- Email-change failures do not modify Booka membership emails.
- Callback errors return to the originating host's Booka sign-in page.

## 12. Testing and Release Gates

Automated tests cover:

- owner-to-manager and owner-to-staff invitation creation;
- manager-to-staff allowed and manager-to-manager rejected;
- domain restrictions and disabled invitations;
- raw token absent from database, API response, and logs;
- invalid, expired, revoked, accepted, and replayed invitation links;
- wrong-email acceptance rejected;
- concurrent acceptance grants one membership exactly once;
- existing Supabase users and first-time users;
- staging callback remains on staging;
- dual-confirmation email-change initiation;
- membership email sync only after confirmed Auth change;
- callback token types `email` and `email_change`;
- Magic Link, Confirm Signup, and Change Email template links.

Staging manual gates:

1. Existing user accepts a staff invite.
2. New user accepts a staff invite through email sign-in.
3. Wrong account cannot accept another email's invite.
4. Used and expired links cannot be replayed.
5. Owner changes login email and confirms both messages.
6. Old email stops signing in; new email signs in and retains every tenant membership.

Production promotion remains blocked until these gates and the existing Paystack Part A gates pass.

## 13. Rollout and Rollback

Rollout order:

1. Apply and verify migration 161 on the shared Booking Supabase project.
2. Deploy callback, invitation, and email-change code to staging.
3. Install the three enabled Supabase templates.
4. Run the staging gates.
5. Promote through the existing staging-to-main process only after approval.

Rollback disables invitation creation and email-change UI first, then rolls application code back. The additive table remains. Pending invitations can be revoked without deleting audit state. No rollback changes `auth.users` automatically.

## 14. Repository Rules

- Preserve `docs/runbooks/staging-owner-smoke-handoff-2026-09-15.md` untouched.
- Never modify migration 160.
- Agents do not apply migrations or change Supabase, Paystack, or VPS settings.
- Use explicit file staging; never `git add .` or `git add -A`.
- Use throwaway worktrees for cross-branch staging work and fast-forward pushes only.
- Do not promote to production until the owner approves all staging gates.
