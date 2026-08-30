# Booka Meta Pilot Readiness

**Date:** 2026-08-30
**Status:** Approved in chat; awaiting written-spec review

## Objective

Make staging ready for a controlled, Booka-managed beauty-business pilot across
WhatsApp and Instagram while Meta Advanced Access and WhatsApp Embedded Signup
approval are pursued in parallel.

Business verification is already complete. It does not by itself authorize
Booka to onboard arbitrary third-party Meta assets. The first pilot therefore
uses accounts Booka owns or manages. Public tenant self-onboarding remains gated
by the relevant Meta approvals.

## Scope

### 1. SQL Editor release bundle

Create `db/releases/2026-08-30-booka-revenue-pilot.sql` as the single script the
operator pastes into the staging Supabase SQL Editor.

The bundle will:

- fail early if the prerequisite `public.sias_outcome_attributions` table is
  absent;
- apply the schema from migrations `122_booka_revenue_requests.sql` and
  `123_revenue_attribution_verification.sql` in one transaction;
- preserve their idempotent `IF NOT EXISTS` behavior;
- run the structural checks from both verification scripts before commit;
- roll back the entire bundle if any statement or verification fails;
- avoid inserting test data or creating disposable-database roles.

The original migrations remain authoritative. A small generator will assemble
the release file from the two migrations and two verification scripts while
removing their individual transaction wrappers. A regression test will ensure
the committed bundle is reproducible and contains the required guards.

### 2. Current Meta Graph API version

Replace the remaining WhatsApp `v18.0` defaults and Embedded Signup SDK version
with one server-controlled Graph API version, defaulting to `v25.0`, matching
the current Instagram transport.

The browser will receive the non-secret version through the existing
authenticated Embedded Signup configuration response. No Meta app secret,
access token, or verify token will be exposed to client code.

Staging and production environment examples will explicitly set
`WHATSAPP_API_VERSION=v25.0`.

### 3. Meta pilot-readiness checker

Add an operator-run script that checks configuration presence without printing
secret values. It will report separate WhatsApp and Instagram readiness states.

WhatsApp checks:

- app ID and app secret;
- webhook verify token;
- WABA ID, phone-number ID, and access token for a directly managed pilot;
- Embedded Signup Configuration ID as a separate public-onboarding capability;
- current Graph API version;
- HTTPS webhook URL.

Instagram checks:

- Instagram app ID and app secret;
- webhook verify token;
- OAuth state secret and exact redirect URI;
- HTTPS webhook URL;
- Graph API version.

The checker will distinguish:

- `controlled_pilot_ready`: managed accounts can be tested;
- `public_onboarding_configured`: required Embedded Signup configuration is
  present, without claiming that Meta has granted Advanced Access;
- `not_ready`: one or more required settings are missing.

It will never make Meta mutations, register numbers, subscribe WABAs, or print
credentials. Those external operations remain explicit operator steps.

### 4. Meta dashboard and live-test runbook

Update the existing Meta setup documentation with two tracks:

1. Controlled pilot using Meta assets Booka owns or manages.
2. Public onboarding after Advanced Access and Embedded Signup approval.

The runbook will include:

- exact staging OAuth and webhook URLs;
- WhatsApp permissions: `business_management`,
  `whatsapp_business_management`, and `whatsapp_business_messaging`;
- Instagram permissions: `instagram_business_basic` and
  `instagram_business_manage_messages`;
- WABA subscription and phone registration checks;
- Instagram professional-account and customer-initiated conversation rules;
- approved-template requirements for proactive WhatsApp sends;
- inbound, reply, booking, deposit, reminder, recovery, and attribution tests;
- evidence to capture for Meta App Review.

## Existing architecture retained

No new channel subsystem will be introduced. The work uses the existing:

- WhatsApp Embedded Signup route and settings UI;
- Instagram OAuth start/callback routes;
- WhatsApp and Instagram webhook handlers;
- encrypted per-tenant provider-secret storage;
- channel-aware AI pipeline and inbox;
- Meta deliverability governor, templates, metering, and health reporting.

## Security boundaries

- Secrets remain server-side and are never committed or returned to browsers.
- The release SQL keeps `booka_revenue_requests` service-role-only with RLS.
- Webhook signature verification remains mandatory for both channels.
- Readiness output contains booleans and public callback URLs only.
- The implementation will not modify live Meta settings or Supabase data without
  a separate explicit operator action.

## Verification

Automated verification will include:

- deterministic SQL bundle generation test;
- SQL content/guard checks;
- Embedded Signup configuration response and SDK-version tests;
- readiness-checker tests for missing, controlled-pilot, and public-onboarding
  configurations;
- existing WhatsApp/Instagram webhook, OAuth, provider, and channel tests;
- changed-file lint, CI typecheck, and the full Jest suite.

Manual staging verification will include:

1. Run the combined SQL bundle in the Supabase SQL Editor.
2. Run the readiness checker in the deployed environment.
3. Verify both webhook challenge handshakes.
4. Connect one managed WhatsApp number and one Instagram professional account.
5. Complete one inbound-to-booking-and-payment journey on each channel.
6. Confirm the resulting conversations, booking, payment, and revenue
   attribution in Booka.

## Launch boundary

Passing the controlled pilot checklist authorizes a supervised 14-day pilot on
accounts Booka owns or manages. It does not authorize unrestricted tenant
self-onboarding. That boundary moves only after Meta grants the required
Advanced Access and Embedded Signup capability and the same live tests pass with
a tenant-owned account.
