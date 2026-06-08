// src/__tests__/lib/whatsapp/v2/outboundBranding.test.ts
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';

// Mock the supabase admin client used by the module.
const tenantRow = {
  name: 'Chris Barbershop',
  display_name: null,
  brand_emoji: '✂️',
  previous_names: null,
  renamed_at: null,
};

jest.mock('@supabase/supabase-js', () => {
  return {
    createClient: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () =>
                table === 'tenants'
                  ? { data: (global as any).__tenantRow }
                  : { data: (global as any).__convRow },
            }),
            maybeSingle: async () =>
              table === 'tenants'
                ? { data: (global as any).__tenantRow }
                : { data: (global as any).__convRow },
          }),
        }),
      }),
    }),
  };
});

beforeEach(() => {
  (global as any).__tenantRow = tenantRow;
  (global as any).__convRow = { last_inbound_at: null, opted_out_at: null };
});

const NOW = new Date('2026-06-08T12:00:00Z');

it('brands a session-open reply using a provided conv', async () => {
  const out = await brandCustomerText('t1', '234999', 'Booked for 2pm.', {
    initiated: false,
    conv: { last_inbound_at: null, opted_out_at: null },
    now: NOW,
  });
  expect(out).toContain('*Chris Barbershop* ✂️');
  expect(out).toContain('Booked for 2pm.');
});

it('returns null for an initiated send to an opted-out customer', async () => {
  const out = await brandCustomerText('t1', '234999', 'Time for a cut?', {
    initiated: true,
    conv: { last_inbound_at: '2026-01-01T00:00:00Z', opted_out_at: '2026-05-01T00:00:00Z' },
    now: NOW,
  });
  expect(out).toBeNull();
});

it('still sends an inbound reply to an opted-out customer (they messaged us)', async () => {
  const out = await brandCustomerText('t1', '234999', 'Sure!', {
    initiated: false,
    conv: { last_inbound_at: '2026-06-08T11:00:00Z', opted_out_at: '2026-05-01T00:00:00Z' },
    now: NOW,
  });
  expect(out).not.toBeNull();
  expect(out).toContain('Sure!');
});
