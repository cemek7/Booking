import { describe, expect, it, jest } from '@jest/globals';
import { PATCH } from '@/app/api/tenants/[tenantId]/settings/route';

const validPolicy = {
  methods: ['customer_pickup', 'own_dispatch', 'third_party_manual'],
  thirdPartyProviders: ['bolt', 'indrive'],
  serviceAreas: ['Lekki', 'Victoria Island'],
  feePolicy: 'fixed',
  fixedFeeCents: 250000,
  customerNotice: 'Delivery timing is confirmed in chat.',
};

function createClient(initialSettings: Record<string, unknown> = {}) {
  let written: Record<string, unknown> | null = null;
  const client = {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(async () => ({
            data: { settings: initialSettings, metadata: {} },
            error: null,
          })),
        })),
      })),
      update: jest.fn((payload: { settings: Record<string, unknown> }) => {
        written = payload.settings;
        return { eq: jest.fn(async () => ({ error: null })) };
      }),
    })),
  };
  return { client, written: () => written };
}

async function patchPolicy(
  retailFulfillment: unknown,
  options: { requestTenantId?: string; userTenantId?: string } = {},
) {
  const requestTenantId = options.requestTenantId ?? 'tenant-1';
  const { client, written } = createClient({ theme: 'green' });
  const result = await PATCH({
    request: {
      method: 'PATCH',
      url: `http://localhost/api/tenants/${requestTenantId}/settings`,
      headers: { get: () => null },
      json: async () => ({ retailFulfillment }),
    },
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      role: 'owner',
      tenantId: options.userTenantId ?? 'tenant-1',
    },
    supabase: client,
    params: { tenantId: requestTenantId },
  } as never);
  return { result: result as Record<string, unknown>, written: written() };
}

describe('tenant retail fulfillment settings', () => {
  it('persists one complete validated policy without changing other settings', async () => {
    const { result, written } = await patchPolicy(validPolicy);

    expect(written).toEqual({ theme: 'green', retailFulfillment: validPolicy });
    expect(result).toEqual(written);
  });

  it.each([
    ['unknown method', { ...validPolicy, methods: ['teleport'] }],
    ['unknown provider', { ...validPolicy, thirdPartyProviders: ['unknown'] }],
    ['provider without method', {
      ...validPolicy,
      methods: ['customer_pickup'],
      thirdPartyProviders: ['bolt'],
    }],
    ['missing fixed fee', {
      ...validPolicy,
      fixedFeeCents: undefined,
    }],
    ['negative fixed fee', { ...validPolicy, fixedFeeCents: -1 }],
    ['fractional fixed fee', { ...validPolicy, fixedFeeCents: 2.5 }],
    ['unexpected nested field', { ...validPolicy, accessToken: 'must-not-persist' }],
    ['oversized service area', { ...validPolicy, serviceAreas: ['x'.repeat(81)] }],
    ['oversized customer notice', { ...validPolicy, customerNotice: 'x'.repeat(501) }],
  ])('rejects %s', async (_label, policy) => {
    await expect(patchPolicy(policy)).rejects.toMatchObject({ code: 'validation_error' });
  });

  it('rejects cross-tenant updates before querying the database', async () => {
    await expect(patchPolicy(validPolicy, {
      requestTenantId: 'tenant-2',
      userTenantId: 'tenant-1',
    })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
