# Instagram Messaging — Meta App Setup Guide

> For connecting Booka's Instagram channel. Uses **"Instagram API with Instagram Login"**
> (the newer path) — does **not** require a Facebook Page linked per tenant the way
> WhatsApp Cloud API does. Reuse the existing WhatsApp Meta app or create a new one.
>
> **Canonical base URL:** `https://booka.techclave.cloud` (dedicated subdomain).
> No Next.js `basePath` / code change is needed for a subdomain — routes resolve at the
> root. (A subpath like `techclave.cloud/booka` would 404 unless you add `basePath: '/booka'`
> to `next.config.ts` or strip the prefix in nginx — so we use a subdomain instead.)
>
> ⚠️ Meta renames menus and bumps the Graph API version often. Treat labels as
> "find the thing that does X". Adapter targets Graph API `v25.0`.

## THE TWO URLs — do not mix them up

They go in **different Meta fields** and do **different jobs**. Both routes already exist
in Booka (committed, tested).

| Meta field | URL to paste | Booka route | Handles |
|---|---|---|---|
| **Business login → Redirect URI** | `https://booka.techclave.cloud/api/auth/instagram/callback` | `/api/auth/instagram/callback` | the connect flow: receives `?code&state`, stores the token |
| **Webhooks → Callback URL** | `https://booka.techclave.cloud/api/webhooks/instagram` | `/api/webhooks/instagram` | receives DMs **and** the `hub.challenge` verification |

The `hub.verify_token` / `hub.challenge` handshake hits the **webhook** URL only. The OAuth
callback never sees it — don't cross them.

## The verify token

A **secret string you invent** (NOT an email), e.g. `booka_ig_verify_2026`. It must equal
`INSTAGRAM_WEBHOOK_VERIFY_TOKEN` in Booka's server env byte-for-byte. The webhook's GET
handler compares them and echoes the challenge.

`localhost` / `127.0.0.1` can never work — Meta calls from the public internet. For
pre-deploy testing, ngrok works but its free URL changes on restart (re-register each time),
so deploying to the subdomain once is less painful.

## Server env vars (Vercel project or VPS .env)

```
APP_URL=https://booka.techclave.cloud
INSTAGRAM_APP_ID=<Instagram app id>            # Instagram-scoped, not the WhatsApp app id
INSTAGRAM_APP_SECRET=<Instagram app secret>    # Instagram-scoped
INSTAGRAM_WEBHOOK_VERIFY_TOKEN=booka_ig_verify_2026
INSTAGRAM_OAUTH_REDIRECT_URI=https://booka.techclave.cloud/api/auth/instagram/callback
INSTAGRAM_OAUTH_STATE_SECRET=<openssl rand -hex 32>
```

## Exact sequence

1. **DNS + nginx:** point `booka.techclave.cloud` at the Booka app; issue a TLS cert.
   Verify with `https://booka.techclave.cloud/api/health` — Booka's backend should answer.
2. **Set the env vars** above.
3. **Apply migrations** (Supabase SQL editor): `079_whatsapp_message_queue_channel.sql`
   and `082_instagram_provider_secrets.sql`.
4. **Deploy.**
5. **Meta dashboard — app + product:** My Apps → your app → Add Product → Instagram →
   Set up → **Instagram API with Instagram Login**. Note the **Instagram App ID** and
   **Instagram App Secret** (Instagram-scoped — different from the WhatsApp ones).
6. **Meta — Webhooks:** Callback URL = `https://booka.techclave.cloud/api/webhooks/instagram`,
   Verify token = `booka_ig_verify_2026`, subscribe to **`messages`** (+ `messaging_postbacks`
   if offered). Click **Verify and Save** → Meta GETs the webhook → it echoes the challenge → ✅.
7. **Meta — Business login → Redirect URIs:** add
   `https://booka.techclave.cloud/api/auth/instagram/callback`.
   Request scopes **`instagram_business_basic`** + **`instagram_business_manage_messages`**.
8. **Test connect:** log into Booka as owner → Settings → Channels → **Connect Instagram**
   → authorize → you land back on `…/settings?instagram=connected`; the token is stored.
9. **Test inbound:** DM the IG account from a test user → webhook fires → AI replies (within
   the 24-hour window).

## Test account (the ≤25 rule)

Need an **Instagram professional account** (IG app → Settings → Account type → Switch to
professional). In Development mode, only app roles/testers can message it — up to **25**
test users before App Review. Add the test IG account under **App Roles → Roles →
Instagram Testers** and accept the invite from inside that IG account.

## App Review (later — only to go public)

To message real customers beyond testers, submit `instagram_business_manage_messages` for
**App Review** with a screencast of the booking flow. Not needed for the ≤25-user pilot.

## Architecture notes (already built, WhatsApp-safe)

- **No routing code needed for Instagram.** Unlike the WhatsApp `wa.me/...?text=TENANT123`
  model, the webhook tells you which IG business account received the DM
  (`entry[].id` = `recipient.id`). Booka maps that account id → tenant via
  `findTenantByInstagramId`. The Instagram account **is** the tenant identifier.
- **Send API:** `POST https://graph.instagram.com/v25.0/<IG_ID>/messages`, bearer token,
  body `{recipient:{id:IGSID},message:{text}}`.
- **24-hour messaging window** → IG = enquiry/booking capture; WhatsApp stays the
  lifecycle/reminders channel (IG forbids proactive sends outside 24h).
- **Token lifecycle:** the callback exchanges code → short-lived (1h) → long-lived (60d)
  token, stored in `whatsapp_provider_secrets` (provider='instagram') with `token_expires_at`.
  A refresh cron is not built yet (re-connect before 60 days, or add the refresh job).
- **Signature:** the webhook verifies `X-Hub-Signature-256` = HMAC-SHA256(rawBody,
  `INSTAGRAM_APP_SECRET`).
