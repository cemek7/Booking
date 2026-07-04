# Social Listening Provider Spike

**Date:** 2026-07-02 (updated 2026-07-04)
**Status:** Provider pivoted. `google_pse` is DISCONTINUED — the new implemented spike path is `serpapi`.

## UPDATE 2026-07-04 — `google_pse` is dead; use `serpapi`

Verified against live docs (developers.google.com/custom-search/v1/overview):
- **The Google Custom Search JSON API is closed to new customers and shuts down 2027-01-01.**
  Booka cannot obtain a new key, and the surface disappears in ~6 months. `google_pse` is no
  longer a viable spike path — it is retained in code for any pre-existing key only.

**New first spike path: SerpApi (`serpapi`).** Verified (serpapi.com/search-api):
- Self-serve signup (no enterprise gate), documented Google Search API.
- Supports the same advanced operators the existing query builder emits (`site:`, `OR`, quoted
  terms), plus `tbs` freshness windows and `start` pagination.
- Returns `organic_results[]` with `link` / `title` / `snippet` / `displayed_link`, so the URL
  stays the dedup `external_id` — cross-provider canonicalization is unchanged.
- Tradeoff is identical to `google_pse`: a SERP scraper, not a firehose. Escalation path is
  unchanged (Brand24 → Brandwatch).

**Implemented:** `src/lib/listening/providers/serpApi.ts` (`SerpApiProvider`), wired into
`createListeningProvider()` as `case 'serpapi'`. Envs: `SOCIAL_LISTENING_PROVIDER=serpapi`,
`SERPAPI_API_KEY` (required), `SERPAPI_RESULT_LIMIT` / `SERPAPI_HL` / `SERPAPI_GL` (optional).
Unit-tested with an injected fetch. **Before production:** confirm the live `organic_results`
field mapping with a real key, and validate the "Required Contract Checks" below against SerpApi.

---

### Original (superseded) recommendation
The section below recommended `google_pse` first; it is kept for history only. Read the UPDATE
above for the current decision.

## Recommendation

Use **Google Programmable Search (`google_pse`)** as the **first implemented spike path**, and keep **Brandwatch** as the enterprise fallback if the low-friction path proves too weak.

Why:
- It gives Booka a documented, no-enterprise-gate API surface.
- Google documents a free quota of 100 queries/day for the Custom Search JSON API, which is enough for a controlled spike.
- The repo already has the hard parts built:
  - config
  - query model
  - dedup
  - cron polling
  - notify
  - convert-to-lead
- So the best next decision is not “buy the biggest tool,” it is “validate the cheapest workable integration surface.”

This is a recommendation for the **first adapter experiment**, not yet the final provider-of-record decision. The current MVP can now move from `StubProvider` to `google_pse` when envs are supplied.

## Compared Options

### 1. Google Programmable Search (`google_pse`)

Observed from official docs:
- Google documents the Custom Search JSON API and its query parameters publicly.
- Google documents a free tier of 100 search queries/day, then paid usage.
- Relevant parameters exposed in the official docs include:
  - `cx`
  - `q`
  - `num`
  - `dateRestrict`
  - `sort`

Fit for Booka:
- Best candidate for a **quick proof of integration**.
- Most attractive when the goal is:
  - fast validation
  - low-friction onboarding
  - testing whether Booka's current query/ingest/dedup model works against a documented provider

Tradeoffs:
- This is still search-index-based, not a dedicated social firehose.
- Result freshness and platform coverage will be weaker than enterprise listening platforms.
- URLs are used as external IDs, so cross-provider canonicalization still matters later.

Use it to answer: “Can we make social listening work end-to-end now without enterprise procurement or brittle HTML scraping?”

### 2. Social Searcher

Observed from public pages:
- Social Searcher is accessible without enterprise gating and positions itself as free social-media search/monitoring.
- Its public search experience appears to be Google-backed rather than a clean, documented API surface.

Fit for Booka:
- Useful as a signal that the low-friction path is viable.
- Helpful as a product benchmark for query semantics and platform coverage.

Tradeoffs:
- The public path is not the contract we want to build the adapter against.
- This is why the implemented spike uses `google_pse` instead of Social Searcher HTML parsing.

### 3. Brandwatch

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

### 4. Brand24

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

**Pick `google_pse` for the first adapter spike.**

Reasoning:
- It avoids both enterprise form-gating and brittle HTML-backed scraping.
- Booka needs a real provider test now more than it needs a final enterprise vendor decision.
- Booka already has the product-side primitives:
  - `tenant_listening_config`
  - `social_mentions`
  - `buildListeningQuery`
  - dedup on `(tenant_id, provider, external_id)`
  - cron polling
  - notification + convert-to-lead workflow
- If `google_pse` fails on freshness, coverage, or cost, the next move is to escalate to Brand24 or Brandwatch, not to undo the architecture.

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
- `name`: stable provider slug, e.g. `google_pse`
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

1. **Spike `google_pse` first**
- goal: prove end-to-end viability fast
- stop quickly if result freshness/coverage/cost are weak

2. **If `google_pse` fails, test Brand24**
- likely the next best non-enterprise path

3. **Escalate to Brandwatch only if needed**
- use when stronger API guarantees matter more than procurement speed

## Final Verdict

- **Architecture:** GO now
- **Provider spike:** GO now with `google_pse` first
- **Enterprise fallback:** Brandwatch
- **Current production-safe fallback:** keep `StubProvider`
