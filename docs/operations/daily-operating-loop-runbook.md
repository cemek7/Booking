# Daily Operating Loop runbook

## Safety model

The Daily Operating Loop is an owner-only, tenant-flagged dashboard module. It
does not replace bookings, sales, inbox, or reporting. A customer-facing action
is queued only after an owner executes an eligible, active policy. The governed
delivery worker records `sent`, `held`, `retry`, or `dead_letter`; a missing
provider message ID must never complete an objective.

## Immediate pause

1. Use the owner Policies control (`PUT /api/operating-loop/policies`) with
   `automationPaused: true`.
2. Confirm `GET /api/operating-loop/policies` reports `automationPaused: true`.
3. Check the next worker result. Existing queued rows will be held by delivery
   governance rather than sent as a bypass.

Do not delete objectives, actions, outbox rows, or evidence as a pause method.
Those records are the audit trail required to diagnose the incident.

## Diagnose an objective

1. Fetch `GET /api/operating-loop` as the tenant owner.
2. Record the objective ID, source fingerprint, evidence, expiry, affected
   record IDs, and policy state. Do not copy customer message bodies or phone
   numbers into tickets.
3. For a wrong or obsolete objective, use the owner action endpoint:
   `POST /api/operating-loop/:objectiveId/defer` with a future timestamp, or
   `POST /api/operating-loop/:objectiveId/dismiss` with a concise reason.
4. If the source facts have materially changed, re-run evaluator persistence;
   its source fingerprint allows new work to reopen without resurrecting an
   exact suppressed item.

## Queue failure or delivery ambiguity

1. Verify the protected worker route has a valid `CRON_SECRET`; never expose
   the worker without its bearer requirement.
2. Inspect `operating_delivery_outbox` status and the linked action audit.
3. `held` means an existing sender safeguard (consent, opt-out, service window,
   template, number quality, or send governor) blocked the action. Resolve the
   underlying safeguard; do not replay it through an inbound queue.
4. `retry` is only for an unambiguous pre-provider failure and has bounded
   backoff. `dead_letter` needs manual diagnosis. An ambiguous provider result
   remains held so Booka cannot duplicate a customer message.

## Rollback

1. Disable the tenant flag with the owner-only rollout control:
   `PUT /api/operating-loop/rollout` with `{ "enabled": false }`.
2. Verify the owner dashboard no longer renders **Today’s Front Desk**.
3. Pause automation separately if any policy is active. Disabling the UI flag
   must not be assumed to cancel already queued work.
4. Do not delete tenant records or database volumes. Rollback is reversible:
   the flag can be re-enabled after reviewing the audit trail.

## Onboarding draft

Sources and interview answers live in `onboarding_evidence` as draft evidence.
They are not published or used to enable automation until the owner explicitly
approves a complete front-desk summary. A skipped question is visible in the
summary and prevents launch readiness.
