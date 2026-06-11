# Boka — Launch & Post-Launch Readiness Checklist

**Date:** 2026-06-11
**Status:** Draft for owner review
**Scope:** Compliance documents, billing/subscription compliance, observability tooling (Linear, PostHog, Sentry), paywall & payment QA, and operational must-haves needed to legally and safely operate Boka at launch.

> **Not legal advice.** This document is a structured engineering/ops checklist. Boka is GDPR-exposed, facilitates payments, and runs AI that messages real customers — the customer-facing legal documents (Privacy Policy, ToS, DPA, refund/subscription terms) should get a final pass from qualified counsel or a reputable policy generator (Termly / iubenda / Osano / TermsFeed). Items below are marked **⚖️ counsel** where professional review is strongly advised, **🛠️ build** where it's engineering work, and **📄 draft** where Claude can produce a solid first draft.

---

## 1. Operating context (decided)

- **Markets:** Nigeria / West Africa **+** EU / UK **+** global signups → comply to the **strictest standard (GDPR / UK GDPR)** and layer **Nigeria NDPR (NDPA 2023)** on top.
- **Billing:** Hybrid, three money flows:
  1. **Tenant subscription** to Boka (`subscription_charge`).
  2. **Prepaid AI credit wallet** with usage + overage billing (`wallet_topup`, `usage_charge`, `overage_charge`, `bonus_credit`).
  3. **Marketplace deposits** — end-customers pay tenants through the platform; funds split to tenant Paystack subaccounts (`payments/deposits`, `payments/subaccounts`, `payments/refund`). → **Boka is a payment facilitator.**
- **Output of this session:** the checklist/plan itself; execution is a later phase.

---

## 2. Ground-truth snapshot (verified in repo, 2026-06-11)

| Area | Status on the ground |
|---|---|
| Privacy Policy / ToS / Cookie / DPA | ❌ None exist (no legal pages anywhere) |
| Tenant subscription billing | 🟡 Ledger supports `subscription_charge`; UI at `src/app/dashboard/billing` |
| AI credit wallet / usage billing | ✅ `src/lib/billing/ai-wallet.ts`, `api/billing/wallet` |
| Marketplace payments | ✅ Stripe + Paystack; `deposits`, `subaccounts`, `refund` routes (facilitator confirmed) |
| Reviews / ratings (public UGC) | ✅ `api/public/[slug]/reviews` + `reviews/send-link`; **no moderation/takedown route** |
| Email service | ✅ `src/lib/integrations/email-service.ts`; **no unsubscribe / preference center** |
| WhatsApp opt-out | ✅ `src/lib/whatsapp/v2/optOut.ts` (pattern to extend to email) |
| GDPR data export / erasure (DSAR) | ❌ None |
| Consent / cookie banner | ❌ None |
| AI disclosure to end-customers | ❌ None (customers chat with an AI bot via WhatsApp/IG) |
| Healthcare/HIPAA | 🟡 `src/lib/compliance/hipaaCompliance.ts` exists — **scope unconfirmed** |
| Error tracking (Sentry) | 🟡 Env vars present but empty/commented — not wired |
| Product analytics (PostHog) | ❌ Greenfield |
| Issue tracking (Linear) | ❌ Not set up |

---

## 3. Open decisions needed before/while executing (owner + counsel input)

These block or reshape sections below — answer early:

1. **Merchant of Record (MoR):** For marketplace deposits, is *Boka* the MoR or is the *tenant*? Determines who owns refunds/chargebacks, tax/VAT collection, and whose name appears on the customer's statement. Paystack subaccount splits suggest tenant-as-merchant, but confirm with Paystack/Stripe contracts. **⚖️**
2. **Healthcare in scope?** Can tenants be clinics/medical/wellness providers storing health data? If yes → BAA program, PHI encryption-at-rest review, 60-day breach notification, and a dedicated HIPAA/health-data track (Section 7). If no → delete `hipaaCompliance.ts` or clearly gate it off. **⚖️🛠️**
3. **EU establishment / Art. 27 representative:** With EU users and no EU establishment, an EU (and UK) representative may be required. **⚖️**
4. **Credit/wallet model legal nature:** Are AI credits prepaid services (preferred framing) vs. stored value / e-money (heavier regulation)? Confirm credits are non-refundable-for-cash service credits, with clear expiry rules. **⚖️**

---

## 4. P0 — Launch blockers (cannot go live without)

Each item: **what · why · status · done-when**.

### 4.1 Privacy Policy 📄⚖️
- **Why:** Legally required (GDPR Art. 13/14, NDPA). Must name every sub-processor that touches personal data.
- **Sub-processors to enumerate:** Supabase (DB/auth/storage), Stripe, Paystack, SendGrid (or current email provider), Twilio, Evolution API / WhatsApp (Meta), Instagram (Meta), Google Calendar, PostHog (once added), Sentry, any LLM/OpenRouter provider used by the AI pipeline.
- **Done-when:** Public `/privacy` page; lists data collected, purposes, legal bases, retention, sub-processors, data-subject rights + how to exercise, contact, transfer mechanism (SCCs) for non-EU processing.

### 4.2 Terms of Service — two layers 📄⚖️
- **Tenant (business) ToS:** acceptable use, subscription + wallet billing terms, liability cap, termination, data ownership, that the tenant is the data **controller** of their customers.
- **End-customer booking terms:** booking/cancellation/refund rules, deposit handling, that Boka facilitates payment to the tenant, AI-interaction notice.
- **Done-when:** both linked at signup/checkout with affirmative acceptance logged (timestamp + version).

### 4.3 Data Processing Agreement (DPA) + sub-processor list 📄⚖️
- **Why:** Tenants are controllers; Boka is their processor (GDPR Art. 28). Required to lawfully onboard EU/UK business customers.
- **Done-when:** DPA available (click-accept or downloadable); public sub-processor list page with change-notification commitment.

### 4.4 Cookie consent + analytics gating 🛠️📄
- **Why:** GDPR/PECR — PostHog, session replay, and any non-essential cookies **must not fire before consent** for EU/UK visitors.
- **Done-when:** Consent banner (accept/reject/granular); analytics + replay initialize only post-consent; cookie policy page; consent state persisted and auditable.

### 4.5 DSAR — data export & erasure 🛠️
- **Why:** GDPR Arts. 15/17 + NDPA. Currently **nothing exists**.
- **Done-when:** Authenticated user (and tenant-on-behalf-of-customer) can request **export** (machine-readable) and **deletion**; documented SLA (≤30 days); deletion cascades across DB + storage + downstream (email lists, WhatsApp records) with audit log. Define what is retained for legal/financial reasons (e.g. transaction records).

### 4.6 AI interaction disclosure + human handoff 🛠️📄
- **Why:** Customers message an automated AI agent over WhatsApp/IG. Transparency expected under GDPR + emerging AI rules + Meta platform policy. Avoids "deceptive bot" exposure.
- **Done-when:** First-contact disclosure that they're talking to an automated assistant; a path to reach a human; documented in privacy policy.

### 4.7 WhatsApp / Meta & Instagram platform-policy compliance 🛠️⚖️
- **Why:** **Account-ban / shutdown risk**, not just legal. Meta requires verifiable opt-in, 24-hour customer-care window rules, approved message templates outside the window, and IG messaging-policy adherence.
- **Done-when:** Opt-in is captured & stored with proof; outbound respects 24h window / uses approved templates; opt-out (`optOut.ts`) honored end-to-end; review against current Meta Business & WhatsApp Commerce policies.

### 4.8 Subscription & auto-renewal disclosure + cancellation 📄🛠️
- **Why:** FTC "click-to-cancel" / EU consumer law / auto-renewal disclosure statutes apply to the tenant subscription and any auto-reload on the wallet.
- **Done-when:** Pre-purchase disclosure of price/renewal cadence/how to cancel; **cancel is as easy as subscribe** (self-serve); renewal reminder for annual plans; auto top-up (if any) is opt-in with clear terms.

### 4.9 Refund & cancellation policy (consumer + subscription) 📄⚖️
- **Why:** Required for payments; reduces chargebacks; `payments/refund` route exists but no published policy.
- **Done-when:** Published policy covering booking deposits (who refunds — tenant vs Boka, tied to MoR decision), subscription refunds, and AI-credit (non-refundable-for-cash) terms.

### 4.10 Payment / PCI posture confirmation 🛠️⚖️
- **Why:** As facilitator. Confirm card data never touches Boka servers (Stripe Elements / Paystack hosted) → **PCI SAQ-A** scope.
- **Done-when:** Verified no PAN handling; SAQ-A documented; webhook signature verification confirmed on `payments/webhook`.

---

## 5. P1 — Operational must-haves (week 1)

### 5.1 Email compliance — unsubscribe + preference center 🛠️📄
- CAN-SPAM + GDPR + NDPA: physical sender address, working one-click unsubscribe in **marketing** mail, separation of **transactional vs marketing**, marketing-consent capture. Extend the existing `optOut.ts` pattern to email. Confirm sender-domain auth (SPF/DKIM/DMARC).

### 5.2 UGC moderation + notice-and-takedown 🛠️📄
- Reviews are public → defamation, fake-review, and abusive-content exposure. Build: report/flag on reviews, tenant + admin moderation queue, takedown workflow, and a UGC policy (no unlawful/abusive content, Boka's right to remove, DMCA-style notice contact). Inbound WhatsApp/IG media also counts as UGC.

### 5.3 Sentry (error tracking) — wire it 🛠️
- Env scaffold exists; configure DSN, source maps, release tracking, server + client + edge, PII scrubbing (don't log customer data / tokens), alert routing.

### 5.4 PostHog (product analytics + session replay) 🛠️
- Install behind consent gate (4.4). Define core events (signup, onboarding steps, booking created, payment success/fail, subscription start/cancel, wallet top-up, AI conversation handled). Mask PII in replays. Decide EU data residency (PostHog EU cloud) given GDPR.
- Decision: **PostHog for product analytics + replay; keep Sentry for errors.** (PostHog error tracking is newer; Sentry is already scaffolded — don't duplicate.)

### 5.5 Linear — issue tracking 🛠️
- Set up workspace/teams, projects, triage workflow, GitHub integration (link PRs/branches like `feat/instagram-channel`), bug intake template, and a post-launch "incidents" project. Define severity labels + SLA.

### 5.6 Uptime + alerting + status page 🛠️
- External uptime monitor on `/api/health` + `/api/ready`; on-call alert channel (memory notes a deferred Telegram alert wiring — candidate); public/internal status page. Define incident severities.

### 5.7 Acceptable Use Policy 📄
- Platform-wide AUP (prohibited uses, spam via WhatsApp/email, illegal bookings, scraping). Referenced by both ToS layers.

### 5.8 Age / minors statement 📄
- State minimum age (16 for EU/GDPR default, or 13 with safeguards). Bookings made by/for minors handled by the adult tenant/guardian.

---

## 6. P2 — Fast-follow (month 1)

- **Accessibility (WCAG 2.1 AA)** statement + audit of public booking pages — raise priority if any EU public-sector tenants.
- **Backup / restore runbook + DR** — verify Supabase PITR; document restore drill; RPO/RTO targets. (Memory references a deferred R2 SigV4 backup — fold in here.)
- **Incident-response & breach-notification runbook** — GDPR 72h authority notification; NDPA notification; (HIPAA 60-day if §7 applies). Roles, comms templates, regulator contacts.
- **Rate limiting / abuse protection** on public booking + review endpoints (bot/spam review prevention ties to 5.2).
- **Data retention schedule** — per-data-type retention + automated purge (transactions kept for tax/accounting; chat logs trimmed; review against NDPA/GDPR minimization).
- **Vendor/sub-processor DPAs on file** — countersigned DPAs from Supabase, Stripe, Paystack, Meta, email/SMS providers, PostHog.

---

## 7. Conditional — Healthcare track (only if Decision #2 = yes)

If clinics/medical tenants are in scope:
- **BAA** offered to/from Boka and required of sub-processors that touch PHI (Supabase BAA, etc.). **⚖️**
- PHI **encryption at rest + in transit** audit; access controls; audit logging (verify `hipaaCompliance.ts` actually enforces vs. is a stub).
- **Breach notification ≤60 days** added to the incident runbook.
- Restrict which AI/LLM providers may process PHI (some prohibit it).
- Health data is "special category" under GDPR Art. 9 → explicit consent + heightened safeguards even outside the US.

If **no**: remove or hard-gate `hipaaCompliance.ts` to avoid implying capabilities you don't support.

---

## 8. Paywall & payment QA matrix (verification before/at launch)

Test each across **both** Stripe and Paystack, and relevant currencies:

| Scenario | Expected |
|---|---|
| New tenant subscribe (happy path) | Charge succeeds, access granted, invoice/receipt sent |
| Subscription gate enforcement | Locked features blocked for free/expired tenants |
| Trial start → expiry | Access downgrades cleanly at expiry |
| Upgrade / downgrade | Proration correct, entitlements update immediately |
| Failed payment / dunning | Retry + grace period, then lockout; recovery on success |
| Cancellation (self-serve) | Access persists to period end, no re-charge, confirmation |
| Wallet top-up | Credits added, ledger entry correct, balance UI updates |
| AI usage → overage | `usage_charge`/`overage_charge` deducts correctly; low-balance warning fires at threshold |
| Wallet exhausted | AI gracefully falls back (memory: L1-only fallback) — verify customer-facing behavior |
| Marketplace deposit (consumer pays) | Funds captured, split to tenant subaccount, booking confirmed |
| Refund (deposit + subscription) | Refund processes, ledger + reservation status update, customer notified |
| Webhook signature verification | Forged/replayed webhooks rejected |
| Consent gate | Analytics/replay do **not** fire pre-consent (EU) |
| DSAR export/erasure | Export complete & accurate; deletion cascades + audit logged |

---

## 9. Domain index (so nothing is lost)

- **Legal/Compliance:** 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.9, 5.1, 5.2, 5.7, 5.8, 6 (retention, breach), 7
- **Billing/Payments:** 4.8, 4.9, 4.10, §8
- **Platform policy (Meta):** 4.7
- **Observability/Tooling:** 5.3 (Sentry), 5.4 (PostHog), 5.5 (Linear), 5.6 (uptime/status)
- **Security/Ops:** 4.10, 6 (backup/DR, rate-limit, incident response)
- **QA:** §8

---

## 10. Suggested execution order

1. **Decisions** in §3 (unblocks everything).
2. **P0 legal docs** (4.1–4.3, 4.9) — start drafts in parallel with engineering.
3. **P0 engineering**: consent gate (4.4) → DSAR (4.5) → AI disclosure (4.6) → Meta opt-in/templates (4.7) → subscription cancel/disclosure (4.8) → PCI confirm (4.10).
4. **P1 tooling**: Sentry (5.3), PostHog (5.4), Linear (5.5) — fast, unblock observability before heavy traffic.
5. **P1 remaining**: email compliance (5.1), UGC moderation (5.2), uptime/status (5.6), AUP/age (5.7/5.8).
6. **QA matrix (§8)** as a launch gate.
7. **P2** fast-follow after launch.
