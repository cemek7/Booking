# Incident Response & Breach Notification Runbook

**Owner:** Engineering on-call + tenant/data-protection lead
**Scope:** Security incidents and personal-data breaches for Boka (multi-tenant booking platform).
**Status:** Draft — review with counsel for the notification-timeline specifics in your operating regions.

> Compliance context: Boka complies to GDPR/UK GDPR + Nigeria NDPA. Healthcare/HIPAA is
> NOT in scope at launch (see launch-readiness spec); if that changes, add the 60-day HIPAA
> breach-notification track.

---

## 1. Severity classification

| Sev | Definition | Examples |
|---|---|---|
| **SEV1** | Outage or confirmed personal-data breach | Platform down; DB/credential compromise; PII exfiltration |
| **SEV2** | Degraded service or suspected breach | Partial outage; suspicious access; a tenant seeing another tenant's data |
| **SEV3** | Minor, contained, no data exposure | Single failing job; isolated bug; rate-limit abuse |

A **personal-data breach** = accidental/unlawful destruction, loss, alteration, unauthorized
disclosure of, or access to personal data. Any suspected breach is **at least SEV2** until ruled out.

## 2. Detection sources

- **Sentry** — server/edge/client errors (PII-scrubbed; `sendDefaultPii: false`).
- **`/status` page** + **`/api/cron/status-check`** — health/readiness probes; alert on degraded/down via the AlertService (Telegram/Slack/email).
- **Supabase logs / RLS denials**, payment-provider alerts, customer/tenant reports.

## 3. Response steps

1. **Declare & assign.** On-call declares severity, opens an incident channel, assigns an incident lead.
2. **Contain.** Stop the bleeding: revoke compromised credentials/keys, disable the affected path/feature, block offending IPs, roll back a bad deploy.
3. **Assess scope.** What data, which tenants, how many data subjects, what time window. Record evidence (logs, timestamps) — do not destroy it.
4. **Eradicate & recover.** Patch the root cause; restore from backup if needed (Section 5). Verify integrity before reopening.
5. **Decide on notification** (Section 4) — start the clock at the moment of **awareness**.
6. **Post-incident review** within 5 business days: timeline, root cause, corrective actions, owners. File under `docs/runbooks/`.

## 4. Breach notification (start the clock at awareness)

> "Awareness" = when you have a reasonable degree of certainty a breach occurred. The 72-hour
> clock is **not** gated on completing the investigation.

- **GDPR / UK GDPR — supervisory authority:** notify **within 72 hours** of awareness unless the
  breach is unlikely to risk individuals' rights/freedoms. If >72h, document the reasons for delay.
- **GDPR — affected individuals:** notify **without undue delay** when the breach is likely to result
  in a **high risk** to them (e.g. exposed contact details + booking history at scale).
- **Nigeria NDPA:** notify the **NDPC** and affected data subjects per NDPA timelines (treat as
  prompt / without undue delay; confirm current statutory window with counsel).
- **Tenants (as controllers):** where Boka is the **processor** (tenant customer data — see DPA),
  notify the affected **tenant(s) without undue delay** so they can meet their own controller
  obligations. Provide: what happened, data/subjects involved, likely consequences, measures taken.
- **Payment data:** if card data is implicated, notify the payment processor (Stripe/Paystack) and
  follow PCI incident requirements. (Boka targets SAQ-A — card data should never touch our servers.)

**What a notification must contain:** nature of the breach, categories/approx. number of data
subjects and records, likely consequences, measures taken/proposed, and a contact point.

### Notification contacts (confirm before launch)
- Internal: incident lead, data-protection lead, counsel.
- External: supervisory authority (EU/UK), NDPC (Nigeria), affected tenants, processors.
- **TODO:** record the exact authority portals/emails and the data-protection lead before go-live.

## 5. Recovery & backups

- Restore from the most recent clean backup; verify data integrity and that the root cause is fixed
  before reopening access.
- **Database:** Supabase point-in-time recovery (PITR). **TODO:** confirm PITR/retention is enabled
  for the production project and document the RPO/RTO targets.
- After a data-integrity incident, run the **DSAR export** for affected customers if needed to assess
  exactly what data was held (`/api/tenants/[tenantId]/customers/[customerId]/dsar`).

## 6. Communications templates

**Authority (≤72h):** "We became aware on <date/time> of a personal-data breach affecting
<categories> of approximately <N> data subjects. Likely consequences: <…>. Measures taken: <…>.
Contact: <data-protection lead>."

**Affected individual (high risk):** "We're writing to let you know about an incident that may have
affected your personal information (<categories>). Here's what happened, what we've done, and what
you can do: <…>. Questions: <privacy contact>."

**Tenant:** "An incident affected data you control on Boka. Affected: <data/subjects>. Detected
<time>, contained <time>. As your processor we're notifying you so you can assess your own
notification obligations. Details + support: <…>."

## 7. Related
- Observability: Sentry config, `/status`, `/api/cron/status-check` (alerting).
- Data rights: DSAR export/erase routes; retention schedule (`/data-retention`).
- Privacy Policy / DPA / sub-processor list (`/privacy`, `/dpa`, `/sub-processors`).
