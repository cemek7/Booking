/** Tests public availability validation and tenant-local reservation bounds. */

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
}));

import { getAvailability } from '@/lib/publicBookingService';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

function createAvailabilityClient(options: {
  service?: { data: unknown; error: unknown };
} = {}) {
  const calls: Array<[string, string, unknown]> = [];
  const from = jest.fn((table: string) => {
    const chain: Record<string, jest.Mock> = {};
    const fluent = (operation: string) => jest.fn((column: string, value: unknown) => {
      calls.push([operation, column, value]);
      return chain;
    });
    chain.select = jest.fn(() => chain);
    chain.eq = fluent('eq');
    chain.lt = fluent('lt');
    chain.gt = fluent('gt');
    chain.maybeSingle = jest.fn(async () => {
      if (table === 'services') {
        return options.service ?? { data: { duration_minutes: 60 }, error: null };
      }
      if (table === 'tenants') {
        return {
          data: { settings: {}, metadata: {}, timezone: 'Africa/Lagos' },
          error: null,
        };
      }
      return { data: null, error: null };
    });
    chain.in = jest.fn(async () => ({ data: [], error: null }));
    return chain;
  });
  return { client: { from }, calls };
}

describe('publicBookingService getAvailability', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects invalid date strings before querying', async () => {
    await expect(getAvailability('tenant-id', 'service-id', 'invalid-date'))
      .rejects.toThrow('Invalid date format');
  });

  it('accepts valid dates and uses safe default hours for legacy tenants', async () => {
    const mock = createAvailabilityClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mock.client);

    const result = await getAvailability('tenant-id', 'service-id', '2026-09-24');

    expect(result[0]).toEqual({ time: '09:00', available: true });
    expect(result.at(-1)).toEqual({ time: '16:00', available: true });
  });

  it('uses strict half-open UTC day bounds for reservation lookup', async () => {
    const mock = createAvailabilityClient();
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mock.client);

    await getAvailability('tenant-id', 'service-id', '2026-09-24');

    expect(mock.calls).toContainEqual(['lt', 'start_at', '2026-09-24T23:00:00.000Z']);
    expect(mock.calls).toContainEqual(['gt', 'end_at', '2026-09-23T23:00:00.000Z']);
  });

  it('checks a service query error before treating the service as missing', async () => {
    const mock = createAvailabilityClient({
      service: { data: null, error: { message: 'Database error' } },
    });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mock.client);

    await expect(getAvailability('tenant-id', 'service-id', '2026-09-24'))
      .rejects.toThrow();
  });

  it('returns not found for a missing service', async () => {
    const mock = createAvailabilityClient({ service: { data: null, error: null } });
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mock.client);

    await expect(getAvailability('tenant-id', 'service-id', '2026-09-24'))
      .rejects.toThrow('Service');
  });
});
