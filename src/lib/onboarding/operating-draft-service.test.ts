import {
  createOperatingDraftService,
  type OnboardingEvidence,
  type OperatingDraftEvidenceStore,
} from './operating-draft';

function memoryStore(): OperatingDraftEvidenceStore & { rows: OnboardingEvidence[] } {
  const rows: OnboardingEvidence[] = [];
  return {
    rows,
    list: async () => rows,
    append: async (row) => { rows.push(row); },
  };
}

describe('Operating draft evidence service', () => {
  it('records a plain-language owner answer as draft evidence, never as an approval', async () => {
    const store = memoryStore();
    const service = createOperatingDraftService({ store });

    const draft = await service.recordAnswer({
      questionId: 'offer',
      answer: 'We sell braids and take weekend appointments.',
    });

    expect(store.rows).toEqual([expect.objectContaining({
      sourceType: 'owner_answer',
      sourceReference: 'operating-draft:offer',
      ownerEdits: { questionId: 'offer', answer: 'We sell braids and take weekend appointments.' },
      approvalStatus: 'draft',
    })]);
    expect(draft.launch).toEqual({ ready: false, approvalRequired: true });
  });

  it('retains a skipped question and rejects approval until every interview answer is present', async () => {
    const store = memoryStore();
    const service = createOperatingDraftService({ store });
    await service.skipQuestion({ questionId: 'deposit' });

    await expect(service.approve({ actorId: 'owner-1' })).rejects.toThrow('Complete the front-desk interview before approving it');
    expect(store.rows).toEqual([expect.objectContaining({ ownerEdits: { questionId: 'deposit', skipped: true } })]);
  });

  it('adds a source reference as unverified evidence and only becomes launch-ready after explicit approval', async () => {
    const store = memoryStore();
    const service = createOperatingDraftService({ store });
    await service.addSource({ sourceType: 'website', sourceReference: 'https://glow.example' });

    for (const questionId of ['business_profile', 'offer', 'handoff', 'deposit', 'confirmation'] as const) {
      await service.recordAnswer({ questionId, answer: `Answer for ${questionId}` });
    }
    const approved = await service.approve({ actorId: 'owner-1' });

    expect(store.rows[0]).toEqual(expect.objectContaining({
      sourceType: 'website',
      sourceReference: 'https://glow.example',
      extractedFields: {},
      approvalStatus: 'draft',
    }));
    expect(approved.launch).toEqual({ ready: true, approvalRequired: false });
  });
});
