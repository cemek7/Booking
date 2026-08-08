import { describe, expect, it, jest } from '@jest/globals';
import { POST } from '@/app/api/tenants/[tenantId]/whatsapp/meta/embedded-signup/route';

describe('Meta Embedded Signup route', () => {
  it('rejects the operator-assisted Direct path for a tenant owner', async () => {
    const request = {
      method: 'POST',
      url: 'http://booka.test/api/tenants/tenant-1/whatsapp/meta/embedded-signup',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: jest.fn().mockResolvedValue({
        connectionSource: 'direct',
        accessToken: 'token-not-used',
        wabaId: 'waba-1',
        phoneNumberId: 'phone-1',
      }),
    };

    await expect(POST({
      request: request as never,
      params: { tenantId: 'tenant-1' },
      user: { id: 'owner-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' },
      supabase: {} as never,
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});
