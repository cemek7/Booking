# LinkedIn DM Feasibility

**Date:** 2026-06-30 (updated 2026-07-04)
**Task:** #12
**Status:** DM path CONFIRMED IMPOSSIBLE. Reframed to a listening/lead adapter (partner-gated).

## UPDATE 2026-07-04 — there is no LinkedIn DM API; reframe the channel

Verified against the live LinkedIn Marketing API catalog (learn.microsoft.com/en-us/linkedin/marketing/):

**There is NO member/business direct-messaging (1:1 inbox) API.** The full product set is
Advertising, Event Management, Community Management, Lead Sync, Matched Audiences, Audience
Insights, Media Planning, Conversions, Company Intelligence. The only messaging-shaped product is
**Conversation Ads** — a sponsored-message *ad* format, not a two-way support inbox. So a "LinkedIn
DM adapter" for the AI Front Desk is **permanently NO-GO** (not just access-gated — the capability
does not exist).

**However, LinkedIn IS reachable for Booka's actual strategy (listening + lead capture)** via the
partner-gated **Community Management API**:
- **"Monitor Mentions of Your Brand"** + **Social Stream** → brand-mention listening. This maps onto
  the SAME `src/lib/listening/*` seam as the social-listening spike (it becomes a `ListeningProvider`
  named e.g. `linkedin_community`, returning `RawMention[]`), NOT a `ConvChannel`.
- **Lead Sync API** → pull LinkedIn Lead Gen Form submissions into `leads` (the existing lead-capture
  table), feeding the recovery/follow-up engine.

**Reframed verdict:** build LinkedIn as a **listening/lead source**, never a DM channel. This aligns
with the AI Front Desk moat (data + lead recovery) without any unsanctioned automation.

**Gate before building the LinkedIn listening/lead adapter:** it requires LinkedIn Marketing
Developer Platform access + app review (Community Management + Lead Sync are partner-gated), OAuth
with organization/page scopes, and confirming rate limits + mention identity stability for
`external_id` dedup. Until that access is granted, this stays design-only.

---

### Original DM-framed verdict (superseded — kept for history)

**NO-GO for implementation right now.**

Reason:
- The repo is technically ready for another DM channel.
- We do **not** have confirmed sanctioned third-party access for Booka's exact LinkedIn DM use case in this session.
- Without that proof, building a provider, webhook, or browser automation path would be the wrong move.

## What The Repo Already Gives Us

The codebase is not the blocker.

Reusable pieces:
- channel-aware v2 pipeline
- provider abstraction + provider selection
- webhook ingestion pattern
- inbox/chat/message model
- non-phone channel precedent from Instagram
- tenant-scoped credential/config pattern

In practice, a sanctioned LinkedIn adapter would fit the same shape as Instagram:
- widen `ConvChannel`
- add provider client
- add inbound webhook route
- map platform recipient identity into chat/conversation state
- route through `processMessageV2(...)`

## What Must Be Confirmed Before Any Code

1. Sanctioned API access
- Is there an official LinkedIn API that allows:
  - inbound business/customer message events
  - outbound replies or sends
  - app-level integration for a SaaS product like Booka

2. Program eligibility
- Is the capability open to normal developers, or only to approved partners?
- What application review or contractual gate applies?

3. Auth + scopes
- OAuth model
- token refresh behavior
- page/account scope model

4. Identity model
- What identifier maps the customer thread?
- Can it cleanly replace the current `customer_phone` reuse pattern for non-phone channels?

5. Message policy
- reply-window rules
- business-initiated messaging rules
- rate limits
- content restrictions

6. Webhook model
- delivery guarantees
- signature verification
- idempotency keys

## Explicitly Out Of Scope Until GO

- no unofficial automation
- no scraping
- no headless-browser messaging
- no DOM-driving a LinkedIn inbox
- no webhook/provider code
- no schema changes just to “prepare” for a channel we cannot legally ship

## If LinkedIn Access Becomes Real

Then the build order should be:
1. widen `ConvChannel`
2. add LinkedIn provider client
3. add secret/config storage if current provider-secret shape is insufficient
4. add inbound webhook
5. thread customer identity into `chats` / `whatsapp_conversations`
6. run the existing v2 pipeline unchanged wherever possible

## Sign-Off Condition For GO

Implementation can start only if all are true:
- official LinkedIn documentation explicitly supports the target messaging flow
- Booka is eligible for that access
- webhook + send APIs are available
- terms allow this SaaS use case
- cost and operational limits are acceptable

Until then:
- **Research complete enough**
- **Implementation remains blocked by platform authorization**
