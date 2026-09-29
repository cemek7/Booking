import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiError } from '@/lib/error-handling/api-error';

const mockClearHumanHandling = jest.fn();
const mockAdmin = jest.fn();

jest.mock('@/lib/whatsapp/v2/humanTakeover', () => ({
  clearHumanHandling: (...args: unknown[]) => mockClearHumanHandling(...args),
}));
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => mockAdmin(),
}));

import { POST } from '@/app/api/chats/[id]/release/route';

function adminFor(chat: Record<string, unknown> | null, threadId = 'thread-1') {
  const builder = {
    from: jest.fn(() => builder), select: jest.fn(() => builder), eq: jest.fn(() => builder),
    single: jest.fn(async () => ({ data: chat, error: chat ? null : new Error('missing') })),
    maybeSingle: jest.fn(async () => ({ data: { active_thread_id: threadId }, error: null })),
  };
  return builder;
}

function context(tenantId = 'tenant-1', body: Record<string, unknown> = {}) {
  return {
    params: { id: 'chat-1' },
    request: {
      method: 'POST', url: 'http://localhost/api/chats/chat-1/release',
      headers: new Headers({ 'content-type': 'application/json', 'x-tenant-id': tenantId }),
      json: async () => body,
    },
    supabase: {} as never,
    user: { id: 'owner-1', tenantId },
  };
}

describe('POST /api/chats/[id]/release', () => {
  beforeEach(() => { jest.clearAllMocks(); mockClearHumanHandling.mockResolvedValue(undefined); });

  it('clears only the handoff window on the exact active thread', async () => {
    mockAdmin.mockReturnValue(adminFor({
      tenant_id: 'tenant-1', customer_phone: '+2348', metadata: { channel: 'whatsapp' },
    }));
    await expect(POST(context() as unknown as Parameters<typeof POST>[0])).resolves.toEqual({ success: true });
    expect(mockClearHumanHandling).toHaveBeenCalledWith({
      tenantId: 'tenant-1', threadId: 'thread-1', externalId: '+2348', channel: 'whatsapp', close: false,
    });
  });

  it('passes an explicit close through to the canonical thread', async () => {
    mockAdmin.mockReturnValue(adminFor({
      tenant_id: 'tenant-1', customer_phone: 'IGSID', metadata: { channel: 'instagram' },
    }, 'thread-2'));
    await POST(context('tenant-1', { action: 'close' }) as unknown as Parameters<typeof POST>[0]);
    expect(mockClearHumanHandling).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-2', channel: 'instagram', close: true,
    }));
  });

  it('rejects cross-tenant access before clearing takeover', async () => {
    mockAdmin.mockReturnValue(adminFor({
      tenant_id: 'tenant-2', customer_phone: '+2348', metadata: {},
    }));
    await expect(POST(context('tenant-1') as unknown as Parameters<typeof POST>[0]))
      .rejects.toMatchObject<ApiError>({ statusCode: 403 });
    expect(mockClearHumanHandling).not.toHaveBeenCalled();
  });
});
