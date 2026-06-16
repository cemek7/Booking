# Instagram Messaging — Meta App Setup Guide

> For connecting Booka's Instagram channel. Uses **"Instagram API with Instagram Login"**
> (the newer path) — does **not** require a Facebook Page linked per tenant the way
> WhatsApp Cloud API does. You can reuse the existing WhatsApp Meta app or create a new one.
>
> ⚠️ Meta renames menus and bumps the Graph API version often. Treat labels as
> "find the thing that does X". Confirm the **current Graph API version** in your
> dashboard — the adapter currently targets `v25.0` (easy to bump in
> `src/lib/whatsapp/providers/instagram.ts`).

## 1. App + product
1. developers.facebook.com → My Apps → (existing WhatsApp app is fine) → **Add Product →
   Instagram → Set up**, choosing **Instagram API with Instagram Login** (not the older
   "Facebook Login for Business / Pages" path).
2. Under **Instagram → API setup with Instagram login**, note the **Instagram App ID**
   and **Instagram App Secret** (these are *Instagram-scoped* and differ from your main
   App ID/Secret — grab the Instagram ones).

## 2. OAuth redirect
3. **Business login settings → OAuth redirect URIs**, add:
   - `https://YOUR_DOMAIN/api/auth/instagram/callback`
   - For local testing also add your tunnel URL, e.g. `https://xxxx.ngrok-free.app/api/auth/instagram/callback`
4. Request scopes: **`instagram_business_basic`** + **`instagram_business_manage_messages`**
   (confirm exact names in the panel).

## 3. Webhook
5. **Instagram → Webhooks** (or **App → Webhooks → Instagram object**):
   - **Callback URL:** `https://YOUR_DOMAIN/api/webhooks/instagram`
   - **Verify token:** pick a strong random string and save it → goes in env as
     `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
   - **Subscribe to fields:** `messages` (+ `messaging_postbacks` if offered).
   - The callback won't verify until `/api/webhooks/instagram` exists (Task 3) and is
     deployed/tunnelled. Build/deploy the route first, then verify.

## 4. Test account (the ≤25 rule)
6. Need an **Instagram professional account** (Business or Creator — IG app: Settings →
   Account type → Switch to professional).
7. In **Development mode**, only app roles/testers can message it — up to **25** test
   users before App Review. Add the test IG account under **App Roles → Roles →
   Instagram Testers** and accept the invite from inside that IG account.

## 5. App Review (later — only to go public)
8. To message real customers beyond testers, submit `instagram_business_manage_messages`
   for **App Review** with a screencast of the booking flow. Not needed for the ≤25-user pilot.

## What the build needs back from the dashboard
- **Instagram App ID** + **Instagram App Secret**
- the **verify token** chosen above (`INSTAGRAM_WEBHOOK_VERIFY_TOKEN`)
- deployed **domain** (or ngrok URL for testing)
- the **Graph API version** the app shows (confirm/bump from `v25.0`)

## Sequencing
The webhook callback can't verify until `/api/webhooks/instagram` (Task 3) exists.
Efficient order: build Task 3 (webhook) + Phase 3 (OAuth/token storage) first — none of
that code needs the secrets at *write* time, only at *run* time — then paste the callback
URL and it verifies on the first try.

## Technical context (already built, WhatsApp-safe)
- Send API: `POST https://graph.instagram.com/v25.0/<IG_ID>/messages`, bearer token,
  body `{recipient:{id:IGSID},message:{text}}`.
- 24-hour messaging window → **IG = enquiry/booking capture**, WhatsApp stays the
  lifecycle/reminders channel (IG forbids proactive sends outside 24h).
- Data model: `whatsapp_conversations.channel` + `external_id` (IGSID for IG); WhatsApp
  rows unchanged. Token storage planned in `whatsapp_provider_secrets` (channel='instagram').
- Adapter: `src/lib/whatsapp/providers/instagram.ts`; selected when `provider==='instagram'`.
