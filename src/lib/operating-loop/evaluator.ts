import type {
  ObjectiveScore,
  OperatingBookingSignal,
  OperatingEnquirySignal,
  OperatingFollowUpSignal,
  OperatingLeadSignal,
  OperatingObjectiveDraft,
  OperatingObjectiveKind,
  OperatingSignals,
} from './types';

export type {
  ObjectiveScore,
  OperatingBookingSignal,
  OperatingEnquirySignal,
  OperatingFollowUpSignal,
  OperatingLeadSignal,
  OperatingObjectiveDraft,
  OperatingObjectiveKind,
  OperatingSignals,
} from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SCORE_BASE = 101;
const PERSISTED_PRIORITY_SCALE = 2;

type DerivedObjective = Omit<OperatingObjectiveDraft, 'tenantId'>;

function isoAt(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function deadlineScore(deadlineAt: number, nowAt: number): number {
  const millisecondsRemaining = deadlineAt - nowAt;
  if (millisecondsRemaining <= HOUR) return 100;
  if (millisecondsRemaining <= 4 * HOUR) return 80;
  if (millisecondsRemaining <= DAY) return 50;
  return 20;
}

function score(
  customerUrgency: number,
  revenueRisk: number,
  growthValue: number,
  deadline: number,
): ObjectiveScore {
  return {
    customerUrgency,
    revenueRisk,
    growthValue,
    deadline,
    total: encodePriorityScore(customerUrgency, revenueRisk, growthValue, deadline),
  };
}

/**
 * Packs four 0-100 score factors in their lexicographic order. Dividing the
 * base-101 value by two preserves that order while keeping the all-100 maximum
 * (52,030,200) below `NUMERIC(12,4)`'s 99,999,999.9999 maximum.
 */
export function encodePriorityScore(
  customerUrgency: number,
  revenueRisk: number,
  growthValue: number,
  deadline: number,
): number {
  const packed = (((customerUrgency * SCORE_BASE + revenueRisk) * SCORE_BASE + growthValue) * SCORE_BASE) + deadline;
  return packed / PERSISTED_PRIORITY_SCALE;
}

function draft(
  kind: OperatingObjectiveKind,
  recordId: string,
  title: string,
  explanation: string,
  evidence: Record<string, string>,
  amountAtRisk: number | null,
  expiresAt: string,
  objectiveScore: ObjectiveScore,
): DerivedObjective {
  return {
    kind,
    title,
    explanation,
    evidence,
    affectedRecordIds: [recordId],
    amountAtRisk,
    expiresAt,
    dedupeKey: `${kind}:${recordId}`,
    status: 'active',
    score: objectiveScore,
  };
}

function isCurrent(timestamp: string, nowAt: number): boolean {
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && value <= nowAt && value >= nowAt - DAY;
}

function enquiryObjective(enquiry: OperatingEnquirySignal, nowAt: number): DerivedObjective | null {
  if (!isCurrent(enquiry.receivedAt, nowAt)) return null;

  const receivedAt = new Date(enquiry.receivedAt).getTime();
  const expiresAtMilliseconds = receivedAt + HOUR;
  if (expiresAtMilliseconds <= nowAt) return null;

  const expiresAt = isoAt(expiresAtMilliseconds);
  const customerName = enquiry.customerName ?? 'this customer';

  if (enquiry.status === 'unanswered') {
    return draft(
      'reply_to_lead',
      enquiry.id,
      `Reply to ${customerName}`,
      `${customerName} is waiting for a reply.`,
      { enquiryId: enquiry.id, customerName },
      null,
      expiresAt,
      score(100, 0, 0, deadlineScore(expiresAtMilliseconds, nowAt)),
    );
  }

  if (enquiry.status === 'needs_qualification') {
    return draft(
      'qualify_lead',
      enquiry.id,
      `Qualify ${customerName}'s enquiry`,
      `${customerName} needs a recommendation before booking.`,
      { enquiryId: enquiry.id, customerName },
      null,
      expiresAt,
      score(75, 0, 30, deadlineScore(expiresAtMilliseconds, nowAt)),
    );
  }

  return null;
}

function leadObjective(lead: OperatingLeadSignal, nowAt: number): DerivedObjective | null {
  if (lead.status !== 'abandoned' || lead.intent !== 'high' || !isCurrent(lead.abandonedAt, nowAt)) return null;

  const abandonedAt = new Date(lead.abandonedAt).getTime();
  const customerName = lead.customerName ?? 'this customer';
  return draft(
    'recover_lead',
    lead.id,
    `Recover ${customerName}'s enquiry`,
    `${customerName} abandoned a high-intent enquiry.`,
    { leadId: lead.id, customerName, intent: lead.intent },
    lead.estimatedValue ?? null,
    isoAt(abandonedAt + DAY),
    score(0, 85, 35, deadlineScore(abandonedAt + DAY, nowAt)),
  );
}

function bookingObjective(booking: OperatingBookingSignal, nowAt: number): DerivedObjective | null {
  const startsAt = new Date(booking.startsAt).getTime();
  if (!Number.isFinite(startsAt) || startsAt <= nowAt) return null;

  const customerName = booking.customerName ?? 'this customer';
  const amountAtRisk = booking.amount ?? null;
  const deadline = deadlineScore(startsAt, nowAt);

  if (booking.status === 'unconfirmed') {
    return draft(
      'confirm_booking',
      booking.id,
      `Confirm ${customerName}'s booking`,
      `${customerName}'s booking needs confirmation before it starts.`,
      { bookingId: booking.id, customerName },
      amountAtRisk,
      isoAt(startsAt),
      score(0, 90, 0, deadline),
    );
  }

  if (booking.status === 'deposit_due') {
    return draft(
      'collect_deposit',
      booking.id,
      `Collect ${customerName}'s deposit`,
      `${customerName}'s booking is awaiting its deposit.`,
      { bookingId: booking.id, customerName },
      amountAtRisk,
      isoAt(startsAt),
      score(0, 80, 0, deadline),
    );
  }

  if (booking.status === 'at_risk') {
    return draft(
      'recover_booking',
      booking.id,
      `Recover ${customerName}'s booking`,
      `${customerName}'s booking needs recovery before it starts.`,
      { bookingId: booking.id, customerName },
      amountAtRisk,
      isoAt(startsAt),
      score(0, 85, 0, deadline),
    );
  }

  return null;
}

function followUpObjective(followUp: OperatingFollowUpSignal, nowAt: number): DerivedObjective | null {
  const dueAt = new Date(followUp.dueAt).getTime();
  const expiresAtMilliseconds = dueAt + DAY;
  // Follow-ups are actionable from one day before their due time through the
  // following day; once that window closes they cannot be selected again.
  if (!Number.isFinite(dueAt) || dueAt > nowAt + DAY || expiresAtMilliseconds <= nowAt) return null;

  const customerName = followUp.customerName ?? 'this customer';
  return draft(
    'follow_up',
    followUp.id,
    `Follow up with ${customerName}`,
    `${customerName} is due for a follow-up.`,
    { followUpId: followUp.id, customerName },
    null,
    isoAt(expiresAtMilliseconds),
    score(0, 0, 30, deadlineScore(dueAt, nowAt)),
  );
}

export function evaluateOperatingObjectives(input: OperatingSignals, now: Date): OperatingObjectiveDraft[] {
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt)) return [];

  const orderedCandidates = [
    ...input.enquiries.map((enquiry) => enquiryObjective(enquiry, nowAt)),
    ...input.leads.map((lead) => leadObjective(lead, nowAt)),
    ...input.bookings.map((booking) => bookingObjective(booking, nowAt)),
    ...input.followUps.map((followUp) => followUpObjective(followUp, nowAt)),
  ].filter((candidate): candidate is DerivedObjective => candidate !== null)
    .map((candidate) => ({ ...candidate, tenantId: input.tenantId }))
    .sort(compareCandidates);

  const seenDedupeKeys = new Set<string>();
  return orderedCandidates.filter((candidate) => {
    if (seenDedupeKeys.has(candidate.dedupeKey)) return false;
    seenDedupeKeys.add(candidate.dedupeKey);
    return true;
  });
}

function compareCandidates(left: OperatingObjectiveDraft, right: OperatingObjectiveDraft): number {
  return (
    right.score.total - left.score.total ||
    left.dedupeKey.localeCompare(right.dedupeKey)
  );
}

export function selectPrimaryObjective(candidates: OperatingObjectiveDraft[]): OperatingObjectiveDraft | null {
  return candidates
    .filter((candidate) => candidate.status === 'active')
    .sort(compareCandidates)[0] ?? null;
}
