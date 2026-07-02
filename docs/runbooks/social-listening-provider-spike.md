# Social Listening Provider Spike

**Date:** 2026-07-02  
**Status:** Updated after a lower-friction provider pass. Real adapter still pending contract/API validation.

## Recommendation

Use **Social Searcher** as the **first spike target**, and keep **Brandwatch** as the enterprise fallback if the low-friction path proves too weak.

Why:
- It is the lowest-friction candidate we found that does not immediately force a sales/demo workflow.
- Its public site explicitly positions itself as a free social-media search and monitoring tool, which makes it the fastest path to a real-world adapter spike.
- The repo already has the hard parts built:
  - config
  - query model
  - dedup
  - cron polling
  - notify
  - convert-to-lead
- So the best next decision is not “buy the biggest tool,” it is “validate the cheapest workable integration surface.”

This is a recommendation for the **first adapter experiment**, not yet the final provider-of-record decision. The current MVP should stay on `StubProvider` until the spike proves usable search semantics and stable mention identity.

## Compared Options

### 1. Social Searcher

Observed from official pages:
- Public site is accessible without enterprise gating.
- The site explicitly describes itself as a free social-media search engine and monitoring tool.
- This makes it the best immediate candidate for a technical spike, even though its API and operational guarantees still need validation.

Fit for Booka:
- Best candidate for a **quick proof of integration**.
- Most attractive when the goal is:
  - fast validation
  - low-friction onboarding
  - testing whether Booka's current query/ingest/dedup model works against a real provider

Tradeoffs:
- Still weaker confidence than Brandwatch on:
  - stable mention IDs
  - pagination guarantees
  - API maturity
  - rate-limit clarity
  - long-term contract predictability

Use it to answer: “Can we make social listening work end-to-end now without enterprise procurement?”

### 2. Brandwatch

Observed from official pages:
- The plans page is enterprise/demo-led rather than self-serve pricing.
- The API page exposes multiple APIs, including:
  - analysis
  - data upload
  - consumer research export/streaming
  - measure
  - publish
  - engage
- The same site also positions Brandwatch as covering major networks and centralizing social conversations.

Fit for Booka:
- Best fit for `ListeningProvider.search(query)` because Booka needs a predictable integration contract more than a consumer UI.
- Better long-term fit for:
  - stable mention export
  - pagination
  - platform normalization
  - rate-limit aware polling
  - future escalation from mentions into support/customer workflows

Tradeoffs:
- Enterprise sales cycle.
- Pricing not transparent on the public page.
- Not the fastest path if the real need is immediate validation rather than enterprise procurement.

### 3. Brand24

What is known from the current plan/spec and public product positioning:
- It is a real social listening product and is already on the shortlist in the approved design spec.
- It appears operationally closer to a monitoring app than a documented integration platform in the material we could confirm during this session.

Fit for Booka:
- Plausibly good for alerting/monitoring use cases.
- Less confidence right now on:
  - API maturity
  - streaming/export shape
  - stable dedup IDs for `UNIQUE (tenant_id, provider, external_id)`
  - contract details we can safely build against without a direct provider review

Tradeoffs:
- Needs direct validation before adapter work.
- If the API delivers only presentation-oriented mention records, dedup and replay safety could become fragile.

## Decision

**Pick Social Searcher for the first adapter spike.**

Reasoning:
- It avoids the biggest immediate blocker: enterprise form-gating.
- Booka needs a real provider test now more than it needs a final enterprise vendor decision.
- Booka already has the product-side primitives:
  - `tenant_listening_config`
  - `social_mentions`
  - `buildListeningQuery`
  - dedup on `(tenant_id, provider, external_id)`
  - cron polling
  - notification + convert-to-lead workflow
- If Social Searcher fails on API quality or dedup semantics, the next move is to escalate to Brand24 or Brandwatch, not to undo the architecture.

## Required Contract Checks Before Coding The Adapter

These must be confirmed with the chosen provider docs or account before replacing `StubProvider`:

1. Query model
- Can we search by:
  - business name
  - handles
  - keywords
  - platform filters
  - since timestamp

2. Stable mention identity
- We need an identifier stable enough to store as `external_id`.
- If the provider only gives transient IDs, we need a fallback digest strategy before build.

3. Pagination + replay
- Need deterministic pagination.
- Need confidence that re-running the same `since` window does not create unstable duplicates.

4. Rate limits
- Need enough quota to poll all enabled tenants on a cron.
- Need retry/backoff guidance for rate-limit and transient provider failures.

5. Platform coverage
- Confirm exactly which of these are supported for public listening:
  - Instagram
  - Facebook
  - LinkedIn
  - TikTok
  - X/Twitter

6. Commercial model
- Confirm whether pricing is:
  - seat-based
  - query-based
  - mention-volume based
  - workspace based
- Booka needs an internal cost model before enabling this for all tenants.

## Adapter Notes For This Repo

The adapter should plug into the existing seam, not invent a new one.

Implement against:
- `src/lib/listening/types.ts`
- `src/lib/listening/provider.ts`
- `src/lib/listening/query.ts`
- `src/lib/listening/ingest.ts`
- `src/app/api/cron/social-listening/route.ts`

Expected adapter behavior:
- `name`: stable provider slug, e.g. `social_searcher`
- `search(query)`: returns `RawMention[]`
- normalize each mention to:
  - `externalId`
  - `platform`
  - `author`
  - `url`
  - `content`
  - `matchedTerm`

Do not bypass the current ingest path.

## Verification Checklist Before Swapping Out `StubProvider`

- A single tenant config returns mentions for at least one tracked term.
- The same provider result run twice does not duplicate rows.
- `last_polled_at` windows behave predictably.
- A newly inserted mention triggers notification.
- A mention can be converted to a lead with captured contact details.
- Cron failures fail closed and do not corrupt polling state.

## Recommended Execution Order

1. **Spike Social Searcher first**
- goal: prove end-to-end viability fast
- stop quickly if IDs/pagination/rate limits are weak

2. **If Social Searcher fails, test Brand24**
- likely the next best non-enterprise path

3. **Escalate to Brandwatch only if needed**
- use when stronger API guarantees matter more than procurement speed

## Final Verdict

- **Architecture:** GO now
- **Provider spike:** GO now with Social Searcher first
- **Enterprise fallback:** Brandwatch
- **Current production-safe fallback:** keep `StubProvider`
