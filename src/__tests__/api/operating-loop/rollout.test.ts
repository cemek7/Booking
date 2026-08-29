import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const definitions: Array<{ method: string; options: { auth?: boolean; roles?: string[] } }> = [];
const maybeSingle = jest.fn();
const updateEq = jest.fn();
const update = jest.fn(() => ({ eq: updateEq }));
const eq = jest.fn(() => ({ maybeSingle }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select, update }));

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

import { GET, PUT } from '@/app/api/operating-loop/rollout/route';

function context(body?: unknown) {
  return {
    request: { json: async () => body },
    user: { id: 'owner-1', email: 'owner@booka.test', role: 'owner', tenantId: 'tenant-1' },
    supabase: { from },
  } as never;
}

describe('Daily Operating Loop rollout control', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: { metadata: { existing_setting: 'keep' } }, error: null });
    updateEq.mockResolvedValue({ error: null });
  });

  it('returns only the rollout flag for the verified owner tenant', async () => {
    await expect(GET(context())).resolves.toEqual({ enabled: false });
    expect(from).toHaveBeenCalledWith('tenants');
    expect(eq).toHaveBeenCalledWith('id', 'tenant-1');
  });

  it('enables the flag while preserving unrelated tenant metadata', async () => {
    await expect(PUT(context({ enabled: true }))).resolves.toEqual({ enabled: true });
    expect(update).toHaveBeenCalledWith({
      metadata: { existing_setting: 'keep', daily_operating_loop_enabled: true },
    });
    expect(updateEq).toHaveBeenCalledWith('id', 'tenant-1');
  });

  it('rejects unknown rollout fields before changing metadata', async () => {
    await expect(PUT(context({ enabled: true, unsafe: true }))).rejects.toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  it('registers both endpoints as authenticated owner-only routes', () => {
    expect(definitions).toHaveLength(2);
    for (const definition of definitions) {
      expect(definition.options).toEqual(expect.objectContaining({ auth: true, roles: ['owner'] }));
    }
  });
});
