// Pure domain module — questions, types, and evidence-derivation logic.
// Safe to import from client components. Supabase-backed wiring lives in
// ./operating-draft.server so `next/headers` never leaks into the client bundle.

export const OPERATING_DRAFT_QUESTIONS = [
  {
    id: 'business_profile',
    prompt: 'In one sentence, what should Booka say your business is known for?',
  },
  {
    id: 'offer',
    prompt: 'What do customers usually buy or book from you?',
  },
  {
    id: 'handoff',
    prompt: 'When should Booka bring you or a teammate into a conversation?',
  },
  {
    id: 'deposit',
    prompt: 'When should Booka ask for a deposit or payment before confirming?',
  },
  {
    id: 'confirmation',
    prompt: 'How should Booka confirm bookings and follow up when a customer goes quiet?',
  },
] as const;

export type OperatingDraftQuestionId = (typeof OPERATING_DRAFT_QUESTIONS)[number]['id'];
export type OnboardingEvidenceSourceType =
  | 'website'
  | 'instagram'
  | 'google_listing'
  | 'whatsapp_export'
  | 'price_list'
  | 'owner_answer'
  | 'other';

export interface OnboardingEvidence {
  sourceType: OnboardingEvidenceSourceType;
  sourceReference: string | null;
  extractedFields: Record<string, unknown>;
  ownerEdits: Record<string, unknown>;
  approvalStatus: 'draft' | 'approved' | 'rejected';
}

export interface OperatingDraftEvidenceStore {
  list(): Promise<OnboardingEvidence[]>;
  append(row: OnboardingEvidence & { approvedBy?: string; approvedAt?: string }): Promise<void>;
}

export type OperatingDraftAnswer =
  | { status: 'unanswered' }
  | { status: 'skipped' }
  | { status: 'answered'; answer: string };

export interface OperatingDraftView {
  answers: Record<OperatingDraftQuestionId, OperatingDraftAnswer>;
  nextQuestion: (typeof OPERATING_DRAFT_QUESTIONS)[number] | null;
  readiness: { answered: number; skipped: number; total: number; percent: number };
  launch: { ready: boolean; approvalRequired: boolean };
}

function isQuestionId(value: unknown): value is OperatingDraftQuestionId {
  return typeof value === 'string' && OPERATING_DRAFT_QUESTIONS.some((question) => question.id === value);
}

function answerFromEvidence(row: OnboardingEvidence): { questionId: OperatingDraftQuestionId; answer: OperatingDraftAnswer } | null {
  const questionId = row.ownerEdits.questionId;
  if (!isQuestionId(questionId)) return null;

  if (row.ownerEdits.skipped === true) return { questionId, answer: { status: 'skipped' } };
  const answer = row.ownerEdits.answer;
  if (typeof answer === 'string' && answer.trim()) {
    return { questionId, answer: { status: 'answered', answer: answer.trim() } };
  }
  return null;
}

/**
 * Builds an owner-reviewable operating draft from append-only evidence. Source
 * references are deliberately not treated as verified facts: an investigator
 * may add extracted fields later, but only owner answers fill this v1 interview.
 */
export function deriveOperatingDraft(evidence: OnboardingEvidence[]): OperatingDraftView {
  const answers = Object.fromEntries(
    OPERATING_DRAFT_QUESTIONS.map((question) => [question.id, { status: 'unanswered' }]),
  ) as Record<OperatingDraftQuestionId, OperatingDraftAnswer>;
  let explicitlyApproved = false;

  for (const row of evidence) {
    const answer = answerFromEvidence(row);
    if (answer) answers[answer.questionId] = answer.answer;
    if (row.approvalStatus === 'approved' && row.ownerEdits.operatingDraftApproval === true) {
      explicitlyApproved = true;
    }
  }

  const values = Object.values(answers);
  const answered = values.filter((answer) => answer.status === 'answered').length;
  const skipped = values.filter((answer) => answer.status === 'skipped').length;
  const total = OPERATING_DRAFT_QUESTIONS.length;
  const allAnswered = answered === total;
  const nextQuestion = OPERATING_DRAFT_QUESTIONS.find((question) => answers[question.id].status === 'unanswered') ?? null;

  return {
    answers,
    nextQuestion,
    readiness: { answered, skipped, total, percent: Math.round((answered / total) * 100) },
    launch: { ready: allAnswered && explicitlyApproved, approvalRequired: !explicitlyApproved },
  };
}

export function isOperatingDraftQuestionId(value: unknown): value is OperatingDraftQuestionId {
  return isQuestionId(value);
}

export function createOperatingDraftService({ store }: { store: OperatingDraftEvidenceStore }) {
  async function currentDraft(): Promise<OperatingDraftView> {
    return deriveOperatingDraft(await store.list());
  }

  async function appendAndRead(row: OnboardingEvidence & { approvedBy?: string; approvedAt?: string }) {
    await store.append(row);
    return currentDraft();
  }

  return {
    getDraft: currentDraft,

    recordAnswer: async ({ questionId, answer }: { questionId: OperatingDraftQuestionId; answer: string }) => {
      const normalized = answer.trim();
      if (!normalized) throw new Error('An answer is required');
      return appendAndRead({
        sourceType: 'owner_answer',
        sourceReference: `operating-draft:${questionId}`,
        extractedFields: {},
        ownerEdits: { questionId, answer: normalized },
        approvalStatus: 'draft',
      });
    },

    skipQuestion: async ({ questionId }: { questionId: OperatingDraftQuestionId }) =>
      appendAndRead({
        sourceType: 'owner_answer',
        sourceReference: `operating-draft:${questionId}`,
        extractedFields: {},
        ownerEdits: { questionId, skipped: true },
        approvalStatus: 'draft',
      }),

    addSource: async ({ sourceType, sourceReference }: {
      sourceType: Exclude<OnboardingEvidenceSourceType, 'owner_answer'>;
      sourceReference: string;
    }) => {
      const normalized = sourceReference.trim();
      if (!normalized) throw new Error('A source reference is required');
      return appendAndRead({
        sourceType,
        sourceReference: normalized,
        extractedFields: {},
        ownerEdits: {},
        approvalStatus: 'draft',
      });
    },

    approve: async ({ actorId }: { actorId: string }) => {
      const draft = await currentDraft();
      if (draft.readiness.answered !== draft.readiness.total) {
        throw new Error('Complete the front-desk interview before approving it');
      }
      return appendAndRead({
        sourceType: 'owner_answer',
        sourceReference: 'operating-draft:approval',
        extractedFields: {},
        ownerEdits: { operatingDraftApproval: true },
        approvalStatus: 'approved',
        approvedBy: actorId,
        approvedAt: new Date().toISOString(),
      });
    },
  };
}
