# Social Listening — Design Spec

**Date:** 2026-06-30
**Status:** Approved design — ready for implementation plan.
**Task:** #14 (new feature workstream). Separate from launch-readiness.

## Goal

When a tenant's business is mentioned on social platforms, surface it so the tenant can engage
and upsell. A detected mention is stored, the tenant is notified, and the mention can be
**converted to a lead** (reusing the existing `leads` follow-up workflow).

## Decisions (resolved 2026-06-30)

1. **Detection = decide after a spike.** Native platform APIs (X/IG/TikTok/LinkedIn) are mostly
   closed/expensive. A short spike compares 2–3 aggregators (Brand24 / Mentionlytics / Social
   Searcher / Brandwatch) on coverage, price, API quality. The build is **provider-agnostic** behind
   a `ListeningProvider` interface so the chosen provider drops in.
2. **Match scope = tenant-confirmed name + handle(s) + keywords.** Reduces false positives for
   generic names ("Glow Salon").
3. **Action = create a lead + notify.** Realized via **model A**: `social_mentions` is the source of
   truth; the tenant is notified on every new mention; a mention is **promoted to a `leads` row only
   when contact info is captured** (keeps `leads.phone NOT NULL` intact). Model B (relax `leads.phone`
   for `source='social'`, auto-create) is the rejected alternative.

## Architecture

Pluggable provider + scheduled poll + dedup + store + notify + convert.

```
cron (CRON_SECRET) ──> for each enabled tenant:
  buildListeningQuery(config) ──> ListeningProvider.search() ──> RawMention[]
    ──> ingest: dedup by (tenant, provider, external_id), insert new
    ──> notify owner of new mentions
dashboard mentions feed ──> engage / dismiss / convert-to-lead
```

The provider seam is the only thing the spike blocks; everything else is buildable now against a
mock provider.

## Data model (migration `120_social_listening.sql`)

- **`tenant_listening_config`**: `tenant_id` (PK, FK), `business_name`, `handles[]`, `keywords[]`,
  `platforms[]`, `enabled` (default false), `last_polled_at`, timestamps.
- **`social_mentions`**: `id`, `tenant_id` (FK), `provider`, `external_id`, `platform`, `author`,
  `url`, `content`, `matched_term`, `status` (`new|engaged|dismissed|converted`, default `new`),
  `created_at`. **`UNIQUE (tenant_id, provider, external_id)`** for dedup. Index
  `(tenant_id, status, created_at DESC)`.

## Components / files

| File | Responsibility |
|---|---|
| `src/lib/listening/types.ts` | `RawMention`, `ListeningQuery`, `TenantListeningConfig` types |
| `src/lib/listening/provider.ts` | `ListeningProvider` interface + `StubProvider` (returns []) until spike |
| `src/lib/listening/query.ts` | `buildListeningQuery(config, since?)` — pure |
| `src/lib/listening/config.ts` | `getEnabledListeningConfigs(admin)` |
| `src/lib/listening/ingest.ts` | `ingestMentions(admin, config, provider)` — dedup + insert, returns new |
| `src/lib/listening/notify.ts` | `notifyNewMentions(tenant, mentions)` — owner alert (reuse AlertService/WhatsApp) |
| `src/lib/listening/convert.ts` | `convertMentionToLead(admin, {mentionId, tenantId, contact})` |
| `src/app/api/cron/social-listening/route.ts` | CRON_SECRET; iterate enabled tenants → ingest → notify |
| `src/app/api/listening/mentions/route.ts` | GET list (owner/manager, tenant-scoped, ?status) |
| `src/app/api/listening/mentions/[id]/route.ts` | POST `{status}` engage/dismiss |
| `src/app/api/listening/mentions/[id]/convert/route.ts` | POST contact → lead (source='social') |
| `src/components/listening/MentionsFeed.tsx` | dashboard feed: engage/dismiss/convert |
| `src/app/dashboard/mentions/page.tsx` | mounts the feed (owner/manager) |

## Build sequence

1. **Provider spike** (operator/research; outcome = chosen aggregator + adapter notes). NOT code.
2. Provider-agnostic core (types, provider stub, query, config, ingest) — TDD, buildable now.
3. Cron + notify.
4. API routes (list/status/convert) + dashboard feed.
5. Real provider adapter (after spike) implementing `ListeningProvider`.

## Out of scope (v1)

Sentiment analysis, competitor monitoring, auto-reply to mentions, analytics dashboards. The provider
adapter itself (post-spike) is a follow-up plan once the aggregator is chosen.

## Open items

- **Provider choice** — resolved by the spike; until then `StubProvider` returns `[]` so the pipeline
  is inert but deployable.
- **Notify channel** — owner WhatsApp vs dashboard-only vs email; default to the existing AlertService
  + an owner WhatsApp message; confirm during build.
