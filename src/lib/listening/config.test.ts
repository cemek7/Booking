import { describe, expect, it } from '@jest/globals';
import { getEnabledListeningConfigs } from '@/lib/listening/config';

function makeAdmin(rows: unknown[]) {
  const calls: Array<[string, unknown]> = [];
  const admin = {
    from() {
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(column: string, value: unknown) { calls.push([column, value]); return builder; },
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

describe('getEnabledListeningConfigs', () => {
  it('returns mapped configs filtered to enabled', async () => {
    const { admin, calls } = makeAdmin([
      {
        tenant_id: 't1',
        business_name: 'Glow',
        handles: ['@g'],
        keywords: [],
        platforms: ['twitter'],
        enabled: true,
        last_polled_at: null,
      },
    ]);

    const configs = await getEnabledListeningConfigs(admin);

    expect(calls).toContainEqual(['enabled', true]);
    expect(configs[0]).toMatchObject({
      tenantId: 't1',
      businessName: 'Glow',
      platforms: ['twitter'],
    });
  });
});
