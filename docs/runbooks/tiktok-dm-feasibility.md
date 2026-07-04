# TikTok DM Feasibility

**Date:** 2026-06-30 (updated 2026-07-04)
**Task:** #13
**Status:** DM path CONFIRMED IMPOSSIBLE (no public API). Permanent NO-GO for DMs.

## UPDATE 2026-07-04 — TikTok has no DM API at all

Verified against the live TikTok for Developers product catalog (developers.tiktok.com/doc/overview):

**There is NO direct-messaging API.** The available products are Login Kit, Content Posting API,
Display API, Research API, Data Portability API, Commercial Content API, and Green Screen Kit. TikTok
DMs are **in-app only** (TikTok app / Business Suite); there is no sanctioned third-party send/receive
surface. This is not "partner-gated" — the capability is simply absent. A "TikTok DM adapter" is
therefore **permanently NO-GO**.

**TikTok's only reachable surfaces for Booka** (not a front-desk inbox):
- **Content Posting API** → outbound marketing/publishing.
- **Lead Generation via the TikTok Ads/Business API** → lead forms into `leads`.

Neither is a conversational channel; both would be marketing/lead features, not a `ConvChannel`.
**Recommendation:** drop "TikTok DM" from the channel roadmap entirely; revisit only if TikTok ships
an official business-messaging API. (User deprioritized a TikTok content/lead adapter for now.)

---

### Original DM-framed verdict (superseded — kept for history)

**NO-GO for implementation right now.**

Reason:
- The repo can absorb another channel technically.
- We do not have verified sanctioned TikTok DM/business messaging access for Booka's exact use case in this session.
- TikTok access appears to be the kind of capability that may depend on product, region, or partner approval, which is enough reason not to build blind.

## What The Repo Already Gives Us

Reusable platform seam:
- provider abstraction
- inbound webhook pattern
- channel-aware v2 pipeline
- inbox/chat/message projections
- non-phone channel handling precedent via Instagram

If sanctioned access exists later, TikTok should follow the same pattern:
- add `tiktok` to the channel union
- implement provider client
- add webhook route
- map external identity into conversation state
- reuse the existing handoff/AI/opt-in pipeline carefully

## What Must Be Confirmed Before Any Code

1. Official business messaging path
- Is there an official TikTok capability for:
  - inbound messages
  - outbound replies
  - third-party SaaS integration

2. Access model
- open developer access vs partner-only access
- region availability
- account/business prerequisites

3. Auth + tenant mapping
- OAuth/token model
- account/page/business identity required for routing events to a tenant

4. Policy model
- message window constraints
- proactive outbound restrictions
- rate limits
- media restrictions

5. Webhook model
- signature verification
- retry behavior
- event consistency

6. Data model fit
- whether current non-phone chat identity reuse is sufficient
- whether provider secrets need more fields than the current shape

## Explicitly Out Of Scope Until GO

- no unofficial automation
- no scraping
- no “agent clicks inside TikTok web”
- no partial adapter
- no speculative migrations

## If TikTok Access Becomes Real

Then build in this order:
1. widen `ConvChannel`
2. implement provider client
3. wire credential/config storage
4. add webhook route
5. integrate identity routing
6. run the existing v2 pipeline with channel-specific policy checks

## Sign-Off Condition For GO

Implementation can begin only if:
- official TikTok documentation confirms the messaging path
- Booka can obtain the access legitimately
- the product/region limitations are acceptable
- webhook + outbound semantics are clear enough to implement safely

Until then:
- **Research complete enough**
- **Implementation remains blocked by platform authorization**
