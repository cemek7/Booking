# LinkedIn DM Feasibility

**Date:** 2026-06-30  
**Task:** #12  
**Status:** Gate-0 only. No adapter build approved.

## Verdict

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
