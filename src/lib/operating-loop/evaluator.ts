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
    total: customerUrgency + revenueRisk + growthValue + deadline,
  };
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
): OperatingObjectiveDraft {
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

function enquiryObjective(enquiry: OperatingEnquirySignal, nowAt: number): OperatingObjectiveDraft | null {
  if (!isCurrent(enquiry.receivedAt, nowAt)) return null;

  const receivedAt = new Date(enquiry.receivedAt).getTime();
  const expiresAt = isoAt(receivedAt + HOUR);
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
      score(100, 0, 0, deadlineScore(receivedAt + HOUR, nowAt)),
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
      score(75, 0, 30, deadlineScore(receivedAt + HOUR, nowAt)),
    );
  }

  return null;
}

function leadObjective(lead: OperatingLeadSignal, nowAt: number): OperatingObjectiveDraft | null {
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

function bookingObjective(booking: OperatingBookingSignal, nowAt: number): OperatingObjectiveDraft | null {
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

function followUpObjective(followUp: OperatingFollowUpSignal, nowAt: number): OperatingObjectiveDraft | null {
  const dueAt = new Date(followUp.dueAt).getTime();
  if (!Number.isFinite(dueAt) || dueAt > nowAt + DAY || dueAt < nowAt - DAY) return null;

  const customerName = followUp.customerName ?? 'this customer';
  return draft(
    'follow_up',
    followUp.id,
    `Follow up with ${customerName}`,
    `${customerName} is due for a follow-up.`,
    { followUpId: followUp.id, customerName },
    null,
    isoAt(nowAt + DAY),
    score(0, 0, 30, deadlineScore(nowAt + DAY, nowAt)),
  );
}

export function evaluateOperatingObjectives(input: OperatingSignals, now: Date): OperatingObjectiveDraft[] {
  const nowAt = now.getTime();
  if (!Number.isFinite(nowAt)) return [];

  return [
    ...input.enquiries.map((enquiry) => enquiryObjective(enquiry, nowAt)),
    ...input.leads.map((lead) => leadObjective(lead, nowAt)),
    ...input.bookings.map((booking) => bookingObjective(booking, nowAt)),
    ...input.followUps.map((followUp) => followUpObjective(followUp, nowAt)),
  ].filter((candidate): candidate is OperatingObjectiveDraft => candidate !== null)
    .sort(compareCandidates);
}

function compareCandidates(left: OperatingObjectiveDraft, right: OperatingObjectiveDraft): number {
  return (
    right.score.customerUrgency - left.score.customerUrgency ||
    right.score.revenueRisk - left.score.revenueRisk ||
    right.score.growthValue - left.score.growthValue ||
    right.score.deadline - left.score.deadline ||
    right.score.total - left.score.total ||
    left.dedupeKey.localeCompare(right.dedupeKey)
  );
}

export function selectPrimaryObjective(candidates: OperatingObjectiveDraft[]): OperatingObjectiveDraft | null {
  return candidates
    .filter((candidate) => candidate.status === 'active')
    .sort(compareCandidates)[0] ?? null;
}
