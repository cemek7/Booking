# Meta Controlled Pilot Runbook

Use this runbook to connect one WhatsApp Business number and one Instagram
professional account that Booka owns or manages to the staging environment.

This runbook does **not** authorize public tenant self-onboarding. Meta Business
verification is complete, but accounts Booka does not own or manage remain gated
by Advanced Access and, for WhatsApp, a released Embedded Signup configuration.

## 1. Launch gates

The controlled 14-day pilot can begin only when all of these are true:

- the combined Booka revenue SQL release completed without an error;
- `npm run meta:pilot:check` reports `controlled_pilot_ready` for WhatsApp and
  Instagram in the deployed staging environment;
- both Meta webhook challenge handshakes pass;
- one Booka-managed WhatsApp number and one Booka-managed Instagram
  professional account are connected;
- the end-to-end checks in section 7 pass and their evidence is saved;
- a human operator is named for escalation during the supervised pilot.

`publicOnboardingConfigured: true` means only that the environment contains an
Embedded Signup configuration ID. The checker deliberately reports
`metaApprovalVerified: false` because environment variables cannot prove Meta
has granted Advanced Access or released the configuration.

## 2. Exact staging endpoints

| Meta setting | Staging value |
|---|---|
| WhatsApp webhook callback | `https://staging.app.techclave.cloud/api/webhooks/whatsapp/meta` |
| Instagram webhook callback | `https://staging.app.techclave.cloud/api/webhooks/instagram` |
| Instagram OAuth redirect | `https://staging.app.techclave.cloud/api/auth/instagram/callback` |
| Booka health check | `https://staging.app.techclave.cloud/api/health` |

Do not substitute the marketing-site domain, the Instagram OAuth callback for a
webhook callback, or a localhost URL.

## 3. Staging environment

Populate `deployment/env/.env.staging` from the committed example. Do not paste
secret values into tickets, chat, screenshots, or this repository.

Required for the managed WhatsApp pilot:

```text
APP_URL
META_APP_ID
META_APP_SECRET
WHATSAPP_APP_SECRET
WHATSAPP_WEBHOOK_VERIFY_TOKEN
WHATSAPP_BUSINESS_ACCOUNT_ID
WHATSAPP_PHONE_NUMBER_ID
WHATSAPP_ACCESS_TOKEN
WHATSAPP_API_VERSION=v25.0
```

`META_APP_SECRET` and `WHATSAPP_APP_SECRET` may contain the same Meta app secret,
but both names are retained because existing Booka routes consume them in
different contexts.

Required for the managed Instagram pilot:

```text
INSTAGRAM_APP_ID
INSTAGRAM_APP_SECRET
INSTAGRAM_WEBHOOK_VERIFY_TOKEN
INSTAGRAM_OAUTH_REDIRECT_URI=https://staging.app.techclave.cloud/api/auth/instagram/callback
INSTAGRAM_OAUTH_STATE_SECRET
```

After updating and restarting staging, run inside the deployed app environment:

```bash
npm run meta:pilot:check
```

The output may show missing variable names and public callback URLs. It must
never show an access token, app secret, verify token, or OAuth state secret.

## 4. WhatsApp dashboard setup

### Controlled-pilot access

1. In Meta App Dashboard, use the verified Booka business portfolio and the app
   that owns or manages the pilot WABA.
2. Add the WhatsApp product and select the Booka-managed WABA and phone number.
3. Confirm the phone number is registered for Cloud API use, its display name is
   approved where required, and its status is connected.
4. Configure the callback URL from section 2 and enter exactly the value stored
   in `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
5. Subscribe the app to the WABA and subscribe to the message and message-status
   webhook fields required by the Cloud API.
6. Confirm `GET /{WABA-ID}/subscribed_apps` shows the Booka Meta app. Do not put
   the access token into evidence screenshots.
7. In Booka, use the superadmin-only direct connection path to provide the WABA
   ID, phone-number ID, and access token. That path validates the phone, confirms
   WABA ownership, subscribes the WABA, and stores the token encrypted.
8. Send a customer message to the number and confirm Booka receives and replies
   before enabling autonomous handling for the pilot tenant.

### Messaging rules

- Free-form replies are limited to the customer-service window opened by a
  customer message.
- Proactive reminders, recovery messages, and re-engagement outside that window
  must use an approved WhatsApp template and the required customer opt-in.
- Record delivered status from Meta webhooks; an accepted API request alone is
  not proof of delivery.
- Test with low-value transactions and an internal/test customer before inviting
  a pilot business.

### Permissions for public onboarding later

Prepare App Review for:

- `business_management` — access the business assets selected in onboarding;
- `whatsapp_business_management` — manage the selected WABA and phone assets;
- `whatsapp_business_messaging` — send and receive Cloud API messages.

Meta's official Embedded Signup collection states that release requires App
Review and Advanced Access for `business_management` and
`whatsapp_business_management`. Booka also needs messaging permission for its
actual send/receive feature. Until those approvals and a released Embedded
Signup configuration are confirmed, keep tenant self-onboarding disabled.

## 5. Instagram dashboard setup

1. Use an Instagram professional business or creator account that Booka owns or
   manages and add its operator as an app role/tester while the app is in
   Development mode.
2. Add **Instagram API with Instagram Login** to the Meta app. Use its
   Instagram-scoped App ID and App Secret in the staging environment.
3. Add the exact OAuth redirect URI from section 2 under Business Login.
4. Configure the Instagram webhook callback and enter exactly the value in
   `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.
5. Subscribe to `messages` and `messaging_postbacks` when available.
6. Request `instagram_business_basic` and
   `instagram_business_manage_messages` in the login flow.
7. In Booka Settings → Channels, connect Instagram and confirm the callback
   returns `instagram=connected` without exposing the token.
8. From a separate tester/customer account, send the first DM. The Instagram
   user must initiate the conversation before Booka can reply through Send API.

Standard Access is appropriate only for professional accounts Booka owns or
manages and has added in the App Dashboard. Advanced Access is required before
Booka serves professional accounts it does not own or manage.

Instagram is not a general-purpose re-engagement channel. Keep automated replies
inside the allowed messaging window opened by the customer's interaction. Route
later lifecycle outreach to an opted-in channel such as WhatsApp using an
approved template.

## 6. Webhook handshake and security checks

For each channel:

1. Click **Verify and Save** in Meta and confirm Meta receives the matching
   `hub.challenge` response.
2. Send one valid signed webhook payload and confirm it is accepted.
3. Replay the same event and confirm it is treated as a duplicate rather than
   creating a second conversation, booking, charge, or attribution.
4. Send a payload with an invalid `X-Hub-Signature-256` and confirm Booka rejects
   it without processing the message.
5. Confirm logs contain event IDs and tenant/channel context but no message-token,
   app-secret, access-token, verify-token, or customer payment details.

## 7. End-to-end pilot evidence matrix

Use an internal beauty-business tenant and low-value/test payment configuration.
Save timestamps, redacted screenshots, conversation/event IDs, booking IDs, and
attribution IDs for each row. Do not claim a result that the evidence does not
show.

| Journey | WhatsApp | Instagram | Required evidence |
|---|---:|---:|---|
| Customer initiates an enquiry | Required | Required | Signed inbound webhook and Booka inbox conversation |
| Booka answers price/service question | Required | Required | Reply content and delivered/sent status |
| Booka recommends an appropriate service/product | Required | Required | Recommendation tied to the customer's stated need |
| First choice unavailable; Booka offers alternatives | Required | Required | Availability lookup and accepted alternative |
| Customer becomes a booking | Required | Required | Booking ID linked to the conversation |
| Deposit/payment link is requested or collected | Required | Required where supported | Transaction/reference and payment-webhook result |
| Enquiry is abandoned and followed up | Approved template if outside service window | Only while policy permits | Policy/window decision and resulting customer response |
| Booking reminder is sent | Approved template when required | Not a proactive default | Template name, send record, and delivery status |
| Cancellation/no-show recovery | Approved template when required | Only while policy permits | Recovered booking or explicit lost outcome |
| Repeat booking/re-engagement | Opted-in approved template | Do not initiate outside allowed window | Consent/template proof and booking ID |
| Human handoff | Required | Required | Automation pauses and operator can reply safely |
| Revenue attribution | Required | Required | `direct`, `influenced`, or `recovered` type, amount/currency, verification state, and evidence link |
| Owner report | Required | Required | Enquiries, bookings, sales, influenced/recovered revenue, and abandoned enquiries with no double counting |

Pilot success means measurable, verified additional business under the agreed
baseline. Conversation volume or an AI-generated estimate alone is not proof of
additional revenue.

## 8. App Review evidence pack

Create a separate, short screencast for each permission. Start from a reviewer
login, show the permission being used inside Booka, and show the resulting Meta
or customer-side outcome. Narrate why the permission is necessary.

| Permission | Evidence to show |
|---|---|
| `business_management` | Business Login/Embedded Signup selecting the business asset Booka will manage |
| `whatsapp_business_management` | Selected WABA/phone validation, app subscription, and management action used by Booka |
| `whatsapp_business_messaging` | Customer sends WhatsApp message, Booka receives it, Booka replies, customer receives reply |
| `instagram_business_basic` | Professional account authorizes Booka and Booka reads the connected account identity needed for routing |
| `instagram_business_manage_messages` | Customer initiates Instagram DM, Booka receives and replies, customer receives reply |

The submission pack must also contain:

- a stable reviewer URL and working reviewer credentials with no MFA dead end;
- numbered reviewer instructions matching the screencast exactly;
- `https://app.techclave.cloud/privacy` as the published privacy-policy URL;
- a public data-deletion instructions URL or compliant callback before public
  App Review submission; the current controlled pilot does not waive this;
- a redacted webhook-handshake and signed-event proof;
- a clear explanation that Booka stores per-tenant tokens encrypted and supports
  disconnect/revocation;
- no production customer messages, credentials, or payment data in evidence.

## 9. Go/no-go record

Record the date, operator, pilot tenant, connected public IDs, checker output,
test-matrix result, and known limitations. Store secrets nowhere in the record.

- **GO — controlled pilot:** both channels report `controlled_pilot_ready`, all
  required matrix rows pass, and a supervised operator is assigned.
- **NO-GO:** either channel is `not_ready`, a webhook/signature/idempotency test
  fails, attribution cannot be verified, or required messaging would violate a
  channel window/template rule.
- **NO-GO — public onboarding:** Advanced Access or released Embedded Signup has
  not been confirmed with a tenant-owned external account, even if the managed
  pilot passes.

## Official reference material

- Meta WhatsApp Business Platform, Embedded Signup “Get Started” collection:
  `https://www.postman.com/meta/whatsapp-business-platform/folder/1bczlus/get-started`
- Meta Instagram API official collection:
  `https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api`
