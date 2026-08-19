# Independent Social Listening Hedge

**Date:** 2026-07-02  
**Purpose:** Define what it would take for Booka to own more of the listening stack instead of depending entirely on third-party aggregators.

## Short Answer

Yes, Booka can hedge toward a more independent implementation.

No, that does **not** mean “we can cheaply replace enterprise listening products ourselves.”

What we can realistically own:
- query orchestration
- provider abstraction
- ingest
- dedup
- mention normalization
- ranking/filtering
- notification
- convert-to-lead/support routing

What we usually cannot own cheaply:
- unrestricted access to platform firehoses
- sanctioned private-network data access
- broad historical archives
- cross-platform compliance/legal coverage

## The Right Hedge Model

Do **not** think in terms of “replace providers.”

Think in terms of:
- **Booka owns the listening control plane**
- providers become swappable data sources

That means the repo should continue treating `ListeningProvider` as a data-source boundary while all business logic stays inside Booka.

Booka-owned layers:
1. tenant config
2. polling schedules
3. query generation
4. dedup + replay safety
5. mention enrichment
6. relevance scoring
7. routing to:
   - mentions feed
   - leads
   - support
   - customer inbox

## What An Independent Implementation Would Require

### 1. Source strategy

You need to decide where mentions come from:
- official APIs
- approved partner feeds
- web search/index APIs
- manual/imported mentions
- owned connectors per platform

The hard truth:
- official APIs are uneven
- some platforms are closed
- some are partner-gated
- some permit public search but not rich monitoring

So “independent” usually means **multi-source**, not single-source.

### 2. A normalized internal mention model

Booka already started this correctly with:
- `social_mentions`
- `tenant_listening_config`
- `RawMention`
- `ListeningProvider`

To hedge well, keep expanding the normalized internal model rather than depending on vendor-specific payloads.

Recommended future additions:
- provider metadata blob
- confidence / relevance score
- author handle / author URL
- first_seen_at / ingested_at split
- canonical fingerprint for cross-provider dedup

### 3. Cross-provider dedup

This is one of the hardest parts if Booka ever mixes sources.

Current dedup:
- `(tenant_id, provider, external_id)`

That is correct for one provider at a time.

If Booka later runs multiple sources, add a second-level canonical fingerprint:
- normalized URL
- platform + author + content hash
- or provider URL canonicalization

Without this, one public mention collected from two sources becomes two Booka mentions.

### 4. Relevance filtering

A lot of “independent listening” work is not collection, it is false-positive removal.

Booka would need:
- tenant name matching
- handle matching
- keyword weighting
- fuzzy alias matching
- likely location-aware rules
- spam suppression

This is where the real moat can live.

### 5. Scheduling + cost controls

If Booka owns orchestration, it also owns cost.

Need:
- polling windows
- provider budgets
- retry/backoff
- tenant quotas
- event priority
- stale-job handling

The current cron route is a fine base, but long term this should likely become queued jobs rather than a single loop.

### 6. Compliance and platform risk management

This is the non-technical tax.

An independent stack needs explicit policy around:
- allowed sources
- robots/ToS boundaries
- storage retention
- PII handling
- region-specific restrictions

Without that, a cheap data source can become an expensive legal risk.

## What Booka Should Own Next

If the goal is hedging, the next internal investments should be:

1. **Multi-provider selection**
- choose provider per tenant or per plan

2. **Provider health scoring**
- success rate
- rate-limit frequency
- mention freshness
- duplicate rate

3. **Canonical mention fingerprinting**
- for future multi-source dedup

4. **Relevance scoring**
- score and suppress weak matches before user-facing feed insertion

5. **Queue-based polling**
- move beyond one cron loop if volume grows

## What Booka Should Not Try To Own Immediately

- full cross-network social firehose
- unofficial scraping-based DM or private-message capture
- historical archive parity with enterprise vendors
- sentiment/analytics platform parity before the raw ingest is stable

That is not hedge engineering. That is rebuilding a category.

## Recommended Hedge Strategy

### Phase 1
- keep current provider abstraction
- spike Social Searcher
- prove end-to-end utility

### Phase 2
- add canonical mention fingerprinting
- add provider health metrics
- support one fallback provider

### Phase 3
- support mixed-source ingestion
- add ranking/filtering layer
- move polling to queue-driven orchestration

### Phase 4
- decide whether proprietary source connectors are worth building for specific high-value networks

## Final Verdict

Independent implementation is viable only if Booka defines it correctly:

- **Booka-owned control plane:** yes, strongly recommended
- **Booka-owned data acquisition for every network:** no, not as an immediate goal

The hedge is:
- own the model
- own the workflow
- own the dedup
- own the routing
- keep data providers replaceable
