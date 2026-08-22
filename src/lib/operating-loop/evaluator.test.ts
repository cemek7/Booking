import {
  evaluateOperatingObjectives,
  selectPrimaryObjective,
  type OperatingObjectiveDraft,
  type OperatingSignals,
} from './evaluator';

const now = new Date('2026-08-22T09:00:00.000Z');

function signals(overrides: Partial<OperatingSignals> = {}): OperatingSignals {
  return {
    tenantId: 'tenant-1',
    enquiries: [],
    leads: [],
    bookings: [],
    followUps: [],
    ...overrides,
  };
}

describe('evaluateOperatingObjectives', () => {
  test('prioritizes an unanswered current enquiry ahead of a revenue-risk booking', () => {
    const candidates = evaluateOperatingObjectives(signals({
      enquiries: [{
        id: 'enquiry-1',
        receivedAt: '2026-08-22T08:50:00.000Z',
        status: 'unanswered',
        customerName: 'Ada',
      }],
      bookings: [{
        id: 'booking-1',
        startsAt: '2026-08-22T11:00:00.000Z',
        status: 'unconfirmed',
        amount: 45000,
        customerName: 'Fatima',
      }],
    }), now);

    expect(selectPrimaryObjective(candidates)).toMatchObject({
      kind: 'reply_to_lead',
      affectedRecordIds: ['enquiry-1'],
      evidence: { enquiryId: 'enquiry-1', customerName: 'Ada' },
      amountAtRisk: null,
      dedupeKey: 'reply_to_lead:enquiry-1',
    });
  });

  test('prioritizes an imminent unconfirmed booking ahead of an ordinary follow-up', () => {
    const candidates = evaluateOperatingObjectives(signals({
      bookings: [{
        id: 'booking-1',
        startsAt: '2026-08-22T11:00:00.000Z',
        status: 'unconfirmed',
        amount: 45000,
        customerName: 'Fatima',
      }],
      followUps: [{
        id: 'follow-up-1',
        dueAt: '2026-08-22T10:00:00.000Z',
        customerName: 'Chidi',
      }],
    }), now);

    expect(selectPrimaryObjective(candidates)).toMatchObject({
      kind: 'confirm_booking',
      affectedRecordIds: ['booking-1'],
      evidence: { bookingId: 'booking-1', customerName: 'Fatima' },
      amountAtRisk: 45000,
      dedupeKey: 'confirm_booking:booking-1',
    });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'follow_up', dedupeKey: 'follow_up:follow-up-1' }),
    ]));
  });

  test('derives a sales-recovery objective for an abandoned high-intent lead', () => {
    const candidates = evaluateOperatingObjectives(signals({
      leads: [{
        id: 'lead-1',
        status: 'abandoned',
        intent: 'high',
        estimatedValue: 85000,
        abandonedAt: '2026-08-21T16:00:00.000Z',
        customerName: 'Ifeoma',
      }],
    }), now);

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'recover_lead',
        affectedRecordIds: ['lead-1'],
        evidence: { leadId: 'lead-1', customerName: 'Ifeoma', intent: 'high' },
        amountAtRisk: 85000,
        dedupeKey: 'recover_lead:lead-1',
      }),
    ]));
  });

  test('excludes expired and dismissed candidates when selecting the primary objective', () => {
    const candidates: OperatingObjectiveDraft[] = [
      {
        kind: 'reply_to_lead',
        title: 'Reply to Ada',
        explanation: 'Ada is waiting for a reply.',
        evidence: { enquiryId: 'enquiry-dismissed' },
        affectedRecordIds: ['enquiry-dismissed'],
        amountAtRisk: null,
        expiresAt: '2026-08-22T10:00:00.000Z',
        dedupeKey: 'reply_to_lead:enquiry-dismissed',
        status: 'dismissed',
        score: { customerUrgency: 100, revenueRisk: 0, growthValue: 0, deadline: 100, total: 200 },
      },
      {
        kind: 'confirm_booking',
        title: 'Confirm Fatima',
        explanation: 'Fatima has an imminent booking.',
        evidence: { bookingId: 'booking-expired' },
        affectedRecordIds: ['booking-expired'],
        amountAtRisk: 45000,
        expiresAt: '2026-08-22T08:00:00.000Z',
        dedupeKey: 'confirm_booking:booking-expired',
        status: 'expired',
        score: { customerUrgency: 0, revenueRisk: 95, growthValue: 0, deadline: 100, total: 195 },
      },
      {
        kind: 'follow_up',
        title: 'Follow up with Chidi',
        explanation: 'Chidi is due for a follow-up.',
        evidence: { followUpId: 'follow-up-active' },
        affectedRecordIds: ['follow-up-active'],
        amountAtRisk: null,
        expiresAt: '2026-08-23T09:00:00.000Z',
        dedupeKey: 'follow_up:follow-up-active',
        status: 'active',
        score: { customerUrgency: 0, revenueRisk: 0, growthValue: 20, deadline: 20, total: 40 },
      },
    ];

    expect(selectPrimaryObjective(candidates)).toMatchObject({
      kind: 'follow_up',
      dedupeKey: 'follow_up:follow-up-active',
    });
  });
});
