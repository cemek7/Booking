import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const maybeSingle = jest.fn();
const select = jest.fn(() => ({ maybeSingle }));
const eqActive = jest.fn(() => ({ select }));
const eqProvider = jest.fn(() => ({ eq: eqActive }));
const eqTenant = jest.fn(() => ({ eq: eqProvider }));
const update = jest.fn(() => ({ eq: eqTenant }));
const from = jest.fn(() => ({ update }));

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(() => ({ from })),
}));

import { PATCH } from '@/app/api/tenants/[tenantId]/whatsapp/meta/embedded-signup/route';

function context(tenantId = 'tenant-1', user = { id: 'owner-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' }) {
  return {
    request: {
      json: jest.fn().mockResolvedValue({ agentEnabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
      method: 'PATCH',
      url: `http://booka.test/api/tenants/${tenantId}/whatsapp/meta/embedded-signup`,
    },
    params: { tenantId },
    user,
    supabase: {} as never,
  };
}

describe('Meta WhatsApp agent setting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lets an owner enable replies only for their active Meta connection', async () => {
    maybeSingle.mockResolvedValue({ data: { agent_enabled: true, meta_phone_number_id: 'phone-1' }, error: null });

    const result = await PATCH(context() as never);

    expect(result).toEqual({ status: 'updated', agentEnabled: true, phoneNumberId: 'phone-1' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ agent_enabled: true }));
    expect(eqTenant).toHaveBeenCalledWith('tenant_id', 'tenant-1');
    expect(eqProvider).toHaveBeenCalledWith('provider', 'meta');
    expect(eqActive).toHaveBeenCalledWith('active', true);
  });

  it('rejects an owner attempting to change another tenant', async () => {
    await expect(PATCH(context('tenant-2') as never)).rejects.toMatchObject({ statusCode: 403 });
    expect(update).not.toHaveBeenCalled();
  });
});
