# Legal & Compliance Pages Implementation Plan

**Goal:** Ship public-facing legal/compliance pages (Privacy, Terms ×2, Cookies, Refunds, Acceptable Use, UGC, DPA, Sub-processors) as brand-consistent Next.js routes, with the four resolved decisions baked in. Closes the Slice-1 follow-up (consent banner links to `/cookies`).

**Decisions baked in (from spec §3, resolved 2026-06-15):**
- Tenant is Merchant of Record; Boka facilitates payment only → booking/refund terms put fulfillment/refunds/disputes/tax on the tenant.
- AI credits = prepaid, non-refundable-for-cash, with expiry → stated in terms + refund policy.
- No EU Art. 27 representative yet → privacy policy states this, monitored.
- No health data at launch → no HIPAA/health claims.
- Comply to GDPR/UK GDPR + Nigeria NDPA.

**Status:** DRAFT — every page carries a visible "pending legal review" notice. These are solid first drafts, not final legal advice.

## Architecture
- `src/components/legal/LegalDocument.tsx` — shell: brand header, last-updated, draft-review banner, back link, prose container. Props `{ title, lastUpdated, children }`.
- `src/components/legal/LegalSection.tsx` — `{ heading, id?, children }` → styled `<section><h2>…`.
- `src/components/legal/LegalDocument.test.tsx` — renders title, draft banner, children.
- Pages (server components, each exports `metadata` + default): `/privacy`, `/terms`, `/cookies`, `/refunds`, `/acceptable-use`, `/ugc-policy`, `/dpa`, `/sub-processors`.
- Centralized constants in `src/lib/legal/constants.ts` (entity name, contact email, last-updated date, sub-processor list) so pages stay DRY.

## Tasks
1. Constants module (`src/lib/legal/constants.ts`).
2. `LegalSection` + `LegalDocument` components + TDD test for the shell.
3. Eight pages composing the shell.
4. Typecheck the new files; confirm consent banner `/cookies` link resolves.
5. Commit (new files only — never `git add -A`; the branch has unrelated WIP).

## Out of scope (later slices)
DSAR engineering, AI-interaction disclosure, Meta opt-in, email preference center, in-product surfacing of credit pricing.
