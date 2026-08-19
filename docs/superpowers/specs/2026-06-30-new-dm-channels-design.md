# New DM Channels (LinkedIn #12, TikTok #13) — Design + Plan

**Date:** 2026-06-30 · **Tasks:** #12, #13 · **Status:** Feasibility-gated design. **Do not build the adapter until Gate 0 passes.**

## Repo reality (verified) — the channel pattern is proven

Adding a channel is a known shape here (WhatsApp + Instagram already ship):
- `type ConvChannel = 'whatsapp' | 'instagram'` (`src/lib/whatsapp/v2/conversationState.ts`).
- Provider adapters: `src/lib/whatsapp/providers/{evolution,instagram,meta,waha}.ts` + `index.ts` + `types.ts` + `providerSelection.ts`; resolved via `getTenantChannelProviderClient(tenantId, channel)`.
- Inbound webhooks: `src/app/api/webhooks/{whatsapp,instagram}/route.ts` → into `processMessageV2(externalId, tenantId, message, messageId, channel)`.
- Outbound: `client.sendTextMessage(externalId, text)`; the pipeline is already channel-threaded.

So **architecturally**, LinkedIn/TikTok = extend `ConvChannel`, add a provider adapter implementing the `types.ts` client interface, add an inbound webhook, register in `providerSelection`. Same as Instagram.

## The blocker is platform access, not architecture

- **LinkedIn:** no general third-party DM-send API. Messaging is gated to Partner Programs / specific products (e.g. Conversations API is partner-restricted). Automating member DMs otherwise **violates LinkedIn ToS → account-ban risk.** Likely **not feasible** without an approved partnership.
- **TikTok:** DM/messaging access is limited, partner-gated, and region-restricted (TikTok Business Messaging via approved partners). Feasibility + coverage vary by region.

## Gate 0 — feasibility spike (REQUIRED before any code)

For each platform, produce `docs/runbooks/<platform>-dm-feasibility.md` answering:
1. Is there a **sanctioned** DM-send + inbound-webhook API for third-party apps? Which program, and are we eligible?
2. Auth model (OAuth scopes), rate limits, message-window rules, template requirements.
3. Regions supported; pricing/partnership cost.
4. Verdict: **GO** (sanctioned access obtainable) / **NO-GO** (no official path → do not build; never automate unofficially).

**If NO-GO, the task stops here** — record the verdict and close. No unofficial automation.

## Plan (per platform, ONLY after a GO verdict)

Mirror the Instagram adapter exactly:

**T1 — extend the channel type.** `ConvChannel = 'whatsapp' | 'instagram' | 'linkedin' | 'tiktok'`. Fix the resulting exhaustiveness errors (TypeScript will flag switch/branch sites — that's the to-do list). Test: existing v2 suite stays green.

**T2 — provider adapter.** `src/lib/whatsapp/providers/<platform>.ts` implementing the client interface in `providers/types.ts` (`sendTextMessage`, config resolution). Register in `providers/index.ts` + `providerSelection.ts`. Unit-test the adapter against a mocked HTTP client (verify auth header + endpoint + payload mapping) — verify the SDK/endpoint against the platform's current docs first (repo dependency rule).

**T3 — config + secrets.** Per-tenant `<platform>` config (token/page id) stored like the Instagram/Meta config; env vars for app id/secret + webhook verify token. Mirror `INSTAGRAM_*` in `env.example`.

**T4 — inbound webhook.** `src/app/api/webhooks/<platform>/route.ts`: GET verify handshake + POST signature-verify → map payload to `(externalId, tenantId, message, messageId, channel)` → `processMessageV2`. Mirror the Instagram webhook; test reject-unsigned / accept-signed.

**T5 — identity + outbound.** Ensure `identityResolver` keys on the platform's scoped user id (like IGSID); outbound routes through `getTenantChannelProviderClient(tenantId, '<platform>')`. Existing pipeline (disclosure, opt-in, handoff, takeover) works unchanged once the channel is registered.

## Out of scope
Platform-specific rich media beyond text in v1; growth/marketing features. Brand/identity per channel reuses the existing `brandIdentity`/outbound branding.

## Self-review / known gaps
- **Feasibility is the whole risk.** The plan's first deliverable is the Gate-0 verdict, not code. Treat #12/#13 as **research tasks** until GO.
- **ConvChannel exhaustiveness:** widening the union will surface every non-exhaustive `switch (channel)` — that's intended (compiler-driven checklist), but T1 must budget for touching multiple branch sites (`brandIdentity`, `resolveProviderConfig`, webhooks, `ensureConversation` phone-vs-id handling — IG already handles null phone, reuse that path).
- **Message-window/template rules** differ per platform (like WhatsApp's 24h window + templates); the opt-in/consent + template machinery (`messaging_consents`, deliverability templates) should be reused, not reinvented.
- **No code should be written against unofficial endpoints under any circumstance.**
