export type OperatingObjectiveKind =
  | 'reply_to_lead'
  | 'qualify_lead'
  | 'recover_lead'
  | 'collect_deposit'
  | 'confirm_booking'
  | 'recover_booking'
  | 'follow_up';

export type OperatingObjectiveStatus = 'active' | 'deferred' | 'dismissed' | 'expired';

export interface ObjectiveScore {
  customerUrgency: number;
  revenueRisk: number;
  growthValue: number;
  deadline: number;
  /**
   * Canonical priority for persistence in `operating_objectives.priority_score`.
   * It is a base-101 encoding of the factors, scaled by two so the maximum
   * remains exactly representable by PostgreSQL `NUMERIC(12,4)`.
   */
  total: number;
}

export interface OperatingObjectiveDraft {
  tenantId: string;
  kind: OperatingObjectiveKind;
  title: string;
  explanation: string;
  evidence: Record<string, string>;
  affectedRecordIds: string[];
  amountAtRisk: number | null;
  expiresAt: string;
  dedupeKey: string;
  status: OperatingObjectiveStatus;
  score: ObjectiveScore;
}

export interface OperatingEnquirySignal {
  id: string;
  receivedAt: string;
  status: 'unanswered' | 'needs_qualification' | 'answered';
  customerName?: string;
}

export interface OperatingLeadSignal {
  id: string;
  abandonedAt: string;
  status: 'abandoned' | 'open' | 'converted';
  intent: 'high' | 'medium' | 'low';
  estimatedValue?: number;
  customerName?: string;
}

export interface OperatingBookingSignal {
  id: string;
  startsAt: string;
  status: 'unconfirmed' | 'deposit_due' | 'at_risk' | 'confirmed';
  amount?: number;
  customerName?: string;
}

export interface OperatingFollowUpSignal {
  id: string;
  dueAt: string;
  customerName?: string;
}

export interface OperatingSignals {
  tenantId: string;
  enquiries: OperatingEnquirySignal[];
  leads: OperatingLeadSignal[];
  bookings: OperatingBookingSignal[];
  followUps: OperatingFollowUpSignal[];
}
