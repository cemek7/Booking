import { describe, expect, it, jest } from '@jest/globals';
import { GET, POST } from '@/app/api/tenants/[tenantId]/whatsapp/meta/embedded-signup/route';

describe('Meta Embedded Signup route', () => {
  it('returns the server-controlled Graph API version with public signup identifiers', async () => {
    const previous = {
      META_APP_ID: process.env.META_APP_ID,
      META_APP_SECRET: process.env.META_APP_SECRET,
      META_EMBEDDED_SIGNUP_CONFIG_ID: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
      WHATSAPP_API_VERSION: process.env.WHATSAPP_API_VERSION,
    };
    process.env.META_APP_ID = 'public-app-id';
    process.env.META_APP_SECRET = 'server-only-app-secret';
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'public-config-id';
    delete process.env.WHATSAPP_API_VERSION;

    const query = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);

    try {
      const result = await GET({
        request: {
          method: 'GET',
          url: 'http://booka.test/api/tenants/tenant-1/whatsapp/meta/embedded-signup',
          headers: new Headers(),
        } as never,
        params: { tenantId: 'tenant-1' },
        user: { id: 'owner-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' },
        supabase: { from: jest.fn().mockReturnValue(query) } as never,
      });

      expect(result).toEqual(expect.objectContaining({
        configured: true,
        embeddedSignup: {
          appId: 'public-app-id',
          configId: 'public-config-id',
          apiVersion: 'v25.0',
        },
      }));
      expect(JSON.stringify(result)).not.toContain('server-only-app-secret');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

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
