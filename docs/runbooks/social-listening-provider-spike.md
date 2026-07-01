# Social Listening Provider Spike

**Date:** 2026-06-30  
**Status:** Completed enough to unblock architecture. Real adapter still pending provider contract.

## Recommendation

Use **Brandwatch** as the first real provider target if Booka decides to pay for an enterprise-grade listening source.

Why:
- The repo already needs a provider with a stable API surface, not just a dashboard product.
- Brandwatch publicly exposes a developer-API product and positions it around exporting and streaming conversation data, analysis, and inbox conversations.
- Brandwatch also explicitly positions itself as multi-network and enterprise-oriented, which fits Booka's tenant-by-tenant polling model better than a lightweight monitoring tool with unclear mention-ID guarantees.

This is a recommendation for the **adapter seam**, not a requirement to buy it immediately. The current MVP should stay on `StubProvider` until commercial approval is real.

## Compared Options

### 1. Brandwatch

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
- Likely overkill for very small tenants if Booka wants low-cost per-tenant margins.

### 2. Brand24

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

### 3. Social Searcher

What is known from the approved design spec:
- It is a reasonable lightweight candidate to compare on cost and public-mention coverage.

Fit for Booka:
- May be useful if the priority is low-cost polling over enterprise workflow depth.
- Weakest current confidence on:
  - mention identity stability
  - operational SLAs
  - tenant-safe rate limits
  - long-term contract suitability for an app feature

Tradeoffs:
- Should only be chosen if cost is overwhelmingly more important than integration certainty.

## Decision

**Pick Brandwatch for the first real adapter path.**

Reasoning:
- Official API surface is clearly advertised.
- Booka already has the product-side primitives:
  - `tenant_listening_config`
  - `social_mentions`
  - `buildListeningQuery`
  - dedup on `(tenant_id, provider, external_id)`
  - cron polling
  - notification + convert-to-lead workflow
- The remaining risk is operational/commercial, not architectural.

## Required Contract Checks Before Coding The Adapter

These must be confirmed with the chosen provider account team or docs before replacing `StubProvider`:

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
- `name`: stable provider slug, e.g. `brandwatch`
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

## Final Verdict

- **Architecture:** GO now
- **Provider adapter:** GO only after provider contract checks above
- **Best first target:** Brandwatch
- **Current production-safe fallback:** keep `StubProvider`
