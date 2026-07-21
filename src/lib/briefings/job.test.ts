import { describe, expect, it, jest } from '@jest/globals';

const mockBuildMorningBriefing = jest.fn();
const mockBuildWeeklyBriefing = jest.fn();
const mockGetTenantClient = jest.fn();

jest.mock('./morning', () => ({
  buildMorningBriefing: (...args: unknown[]) => mockBuildMorningBriefing(...args),
}));

jest.mock('./weekly', () => ({
  buildWeeklyBriefing: (...args: unknown[]) => mockBuildWeeklyBriefing(...args),
}));

jest.mock('@/lib/whatsapp/providers/providerSelection', () => ({
  getTenantWhatsAppProviderClient: (...args: unknown[]) => mockGetTenantClient(...args),
}));

import { runDueBriefings } from './job';

function makeAdmin() {
  const inserts: unknown[] = [];
  const admin = {
    from: jest.fn((table: string) => {
      if (table === 'briefing_schedules') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockResolvedValue({
            data: [
              {
                tenant_id: 'tenant-1',
                briefing_type: 'morning',
                schedule_time: '08:00:00',
                enabled: true,
                tenants: { name: 'Glow Salon', timezone: 'Africa/Lagos' },
              },
            ],
            error: null,
          }),
        };
      }

      if (table === 'briefing_runs') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          contains: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          insert: jest.fn((payload: unknown) => {
            inserts.push(payload);
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }

      if (table === 'tenant_users') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { phone: '+2348000000000' },
            error: null,
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  } as never;

  return { admin, inserts };
}

describe('runDueBriefings', () => {
  it('sends and archives a due morning briefing', async () => {
    mockBuildMorningBriefing.mockReset();
    mockBuildWeeklyBriefing.mockReset();
    mockGetTenantClient.mockReset();
    mockBuildMorningBriefing.mockResolvedValue({
      body: 'Morning body',
      meta: { appointment_count: 2 },
    });
    mockGetTenantClient.mockResolvedValue({
      sendTextMessage: jest.fn().mockResolvedValue({ success: true }),
    });

    const { admin, inserts } = makeAdmin();
    const result = await runDueBriefings(admin, new Date('2026-07-21T08:30:00.000Z'));

    expect(result).toEqual({ sent: 1, skipped: 0 });
    expect(mockBuildMorningBriefing).toHaveBeenCalled();
    expect(inserts[0]).toEqual(expect.objectContaining({
      tenant_id: 'tenant-1',
      briefing_type: 'morning',
      status: 'sent',
      body: 'Morning body',
    }));
  });

  it('archives a skipped run when the builder returns no content', async () => {
    mockBuildMorningBriefing.mockReset();
    mockGetTenantClient.mockReset();
    mockBuildMorningBriefing.mockResolvedValue(null);

    const { admin, inserts } = makeAdmin();
    const result = await runDueBriefings(admin, new Date('2026-07-21T08:30:00.000Z'));

    expect(result).toEqual({ sent: 0, skipped: 1 });
    expect(mockGetTenantClient).not.toHaveBeenCalled();
    expect(inserts[0]).toEqual(expect.objectContaining({
      tenant_id: 'tenant-1',
      briefing_type: 'morning',
      status: 'skipped',
    }));
  });
});
