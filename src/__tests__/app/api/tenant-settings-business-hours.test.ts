import { describe, expect, it, jest } from '@jest/globals';
import { PATCH } from '@/app/api/tenants/[tenantId]/settings/route';

const HOURS = {
  mon: { open: '10:00', close: '16:00', closed: false },
  tue: { open: '10:00', close: '16:00', closed: false },
  wed: { open: '10:00', close: '16:00', closed: false },
  thu: { open: '10:00', close: '16:00', closed: false },
  fri: { open: '10:00', close: '16:00', closed: false },
  sat: { open: null, close: null, closed: true },
  sun: { open: null, close: null, closed: true },
};

function createClient(initialSettings: Record<string, unknown>) {
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
        return {
          eq: jest.fn(async () => ({ error: null })),
        };
      }),
    })),
  };
  return { client, written: () => written };
}

async function patchSettings(
  payload: Record<string, unknown>,
  initialSettings: Record<string, unknown> = {},
) {
  const { client, written } = createClient(initialSettings);
  const result = await PATCH({
    request: {
      method: 'PATCH',
      url: 'http://localhost/api/tenants/tenant-1/settings',
      headers: { get: () => null },
      json: async () => payload,
    },
    user: { id: 'user-1', email: 'owner@example.com', role: 'owner', tenantId: 'tenant-1' },
    supabase: client,
    params: { tenantId: 'tenant-1' },
  } as never);
  return { result: result as Record<string, unknown>, written: written() };
}

describe('tenant settings business hours', () => {
  it('normalizes legacy camel-case input into the canonical snake-case field', async () => {
    const { result, written } = await patchSettings(
      { businessHours: HOURS },
      { businessHours: HOURS, theme: 'green' },
    );

    expect(written).toMatchObject({ business_hours: HOURS, theme: 'green' });
    expect(written).not.toHaveProperty('businessHours');
    expect(result).toMatchObject({ business_hours: HOURS, theme: 'green' });
    expect(result).not.toHaveProperty('businessHours');
  });

  it('round-trips canonical hours without changing closed days', async () => {
    const { written } = await patchSettings({ business_hours: HOURS });
    expect(written).toMatchObject({ business_hours: HOURS });
  });

  it('rejects an open day whose close time is earlier than its open time', async () => {
    await expect(patchSettings({
      business_hours: {
        ...HOURS,
        mon: { open: '17:00', close: '09:00', closed: false },
      },
    })).rejects.toMatchObject({ code: 'validation_error' });
  });
});
