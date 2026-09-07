import {
  deriveOperatingDraft,
  type OnboardingEvidence,
} from './operating-draft';

const evidence = (questionId: string, answer: string): OnboardingEvidence => ({
  sourceType: 'owner_answer',
  sourceReference: `operating-draft:${questionId}`,
  extractedFields: {},
  ownerEdits: { questionId, answer },
  approvalStatus: 'draft',
});

describe('deriveOperatingDraft', () => {
  it('uses the owner’s plain-language answer as evidence for the matching front-desk field', () => {
    const draft = deriveOperatingDraft([
      evidence('offer', 'We sell braids and take weekend hair appointments.'),
    ]);

    expect(draft.answers.offer).toEqual({
      status: 'answered',
      answer: 'We sell braids and take weekend hair appointments.',
    });
    expect(draft.readiness).toEqual({ answered: 1, skipped: 0, total: 5, percent: 20 });
    expect(draft.nextQuestion?.id).toBe('business_profile');
  });

  it('keeps a skipped question visible in the final summary without treating it as launch-ready', () => {
    const draft = deriveOperatingDraft([
      ...['offer', 'handoff', 'deposit', 'confirmation'].map((questionId) =>
        evidence(questionId, `Answer for ${questionId}`),
      ),
      {
        sourceType: 'owner_answer',
        sourceReference: 'operating-draft:business_profile',
        extractedFields: {},
        ownerEdits: { questionId: 'business_profile', skipped: true },
        approvalStatus: 'draft',
      },
    ]);

    expect(draft.answers.business_profile).toEqual({ status: 'skipped' });
    expect(draft.readiness).toEqual({ answered: 4, skipped: 1, total: 5, percent: 80 });
    expect(draft.nextQuestion).toBeNull();
    expect(draft.launch).toEqual({ ready: false, approvalRequired: true });
  });

  it('requires an explicit owner approval after every required interview answer before launch is ready', () => {
    const answers = ['business_profile', 'offer', 'handoff', 'deposit', 'confirmation'].map((questionId) =>
      evidence(questionId, `Answer for ${questionId}`),
    );

    expect(deriveOperatingDraft(answers).launch).toEqual({ ready: false, approvalRequired: true });

    const approved = deriveOperatingDraft([
      ...answers,
      {
        sourceType: 'owner_answer',
        sourceReference: 'operating-draft:approval',
        extractedFields: {},
        ownerEdits: { operatingDraftApproval: true },
        approvalStatus: 'approved',
      },
    ]);

    expect(approved.launch).toEqual({ ready: true, approvalRequired: false });
  });
});
