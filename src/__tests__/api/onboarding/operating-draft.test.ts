import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const definitions: Array<{ method: string; options: { auth?: boolean; roles?: string[] } }> = [];
const getOperatingDraft = jest.fn();
const recordOperatingDraftAnswer = jest.fn();
const skipOperatingDraftQuestion = jest.fn();
const addOperatingDraftSource = jest.fn();
const approveOperatingDraft = jest.fn();

jest.mock('@/lib/error-handling/route-handler', () => ({
  createHttpHandler: (handler: (ctx: unknown) => unknown, method: string, options: { auth?: boolean; roles?: string[] }) => {
    definitions.push({ method, options });
    return handler;
  },
  getVerifiedTenantId: (ctx: { user?: { tenantId?: string } }) => {
    if (!ctx.user?.tenantId) throw new Error('tenant context missing');
    return ctx.user.tenantId;
  },
}));

jest.mock('@/lib/onboarding/operating-draft', () => ({
  getOperatingDraft,
  recordOperatingDraftAnswer,
  skipOperatingDraftQuestion,
  addOperatingDraftSource,
  approveOperatingDraft,
}));

import { GET, POST } from '@/app/api/onboarding/operating-draft/route';

function context(body?: unknown) {
  return {
    request: { json: async () => body },
    user: { id: 'owner-1', email: 'owner@booka.test', role: 'owner', tenantId: 'tenant-1' },
    supabase: {},
  } as never;
}

describe('Operating draft onboarding API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOperatingDraft.mockResolvedValue({ readiness: { percent: 0 } });
    recordOperatingDraftAnswer.mockResolvedValue({ readiness: { percent: 20 } });
    skipOperatingDraftQuestion.mockResolvedValue({ readiness: { percent: 0, skipped: 1 } });
    addOperatingDraftSource.mockResolvedValue({ readiness: { percent: 0 } });
    approveOperatingDraft.mockResolvedValue({ launch: { ready: true } });
  });

  it('returns the draft only for the server-verified owner tenant', async () => {
    await expect(GET(context())).resolves.toEqual({ readiness: { percent: 0 } });
    expect(getOperatingDraft).toHaveBeenCalledWith('tenant-1');
  });

  it('records a natural-language answer against the owner tenant and question', async () => {
    await expect(POST(context({
      action: 'answer',
      questionId: 'offer',
      answer: 'We sell braids and take weekend appointments.',
    }))).resolves.toEqual({ readiness: { percent: 20 } });

    expect(recordOperatingDraftAnswer).toHaveBeenCalledWith({
      tenantId: 'tenant-1', actorId: 'owner-1', questionId: 'offer',
      answer: 'We sell braids and take weekend appointments.',
    });
  });

  it('records a skipped question without accepting unrecognized fields', async () => {
    await POST(context({ action: 'skip', questionId: 'deposit' }));
    expect(skipOperatingDraftQuestion).toHaveBeenCalledWith({
      tenantId: 'tenant-1', actorId: 'owner-1', questionId: 'deposit',
    });

    await expect(POST(context({ action: 'skip', questionId: 'deposit', launch: true }))).rejects.toBeDefined();
    expect(skipOperatingDraftQuestion).toHaveBeenCalledTimes(1);
  });

  it('accepts source references as draft-only evidence and reserves approval for an explicit action', async () => {
    await POST(context({ action: 'add_source', sourceType: 'website', sourceReference: 'https://example.test' }));
    expect(addOperatingDraftSource).toHaveBeenCalledWith({
      tenantId: 'tenant-1', actorId: 'owner-1', sourceType: 'website', sourceReference: 'https://example.test',
    });

    await POST(context({ action: 'approve' }));
    expect(approveOperatingDraft).toHaveBeenCalledWith({ tenantId: 'tenant-1', actorId: 'owner-1' });
  });

  it('registers both draft endpoints as authenticated owner-only routes', () => {
    expect(definitions).toHaveLength(2);
    for (const definition of definitions) {
      expect(definition.options).toEqual(expect.objectContaining({ auth: true, roles: ['owner'] }));
    }
  });
});
