import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockUpsertAnomaly = jest.fn();

jest.mock('../upsertAnomaly', () => ({
  upsertAnomaly: (...args: unknown[]) => mockUpsertAnomaly(...args),
}));

import { runRules } from './registry';

describe('runRules', () => {
  beforeEach(() => {
    mockUpsertAnomaly.mockReset();
    mockUpsertAnomaly.mockResolvedValue('anomaly-1');
  });

  it('runs batch rules and upserts produced anomalies', async () => {
    const admin = {
      from: jest.fn((table: string) => {
        const state = {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          gt: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          lt: jest.fn().mockReturnThis(),
          then: undefined as unknown,
        } as {
          select: jest.Mock;
          eq: jest.Mock;
          gt: jest.Mock;
          gte: jest.Mock;
          lt: jest.Mock;
          then?: (onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
        };

        const payloads: Record<string, unknown> = {
          reservations: [{ id: 'reservation-1', price_cents_snapshot: 12000 }],
          transactions: [],
          retail_orders: [],
        };

        state.then = (onfulfilled) =>
          Promise.resolve(onfulfilled({ data: payloads[table] ?? [], error: null }));

        return state;
      }),
    } as unknown as SupabaseClient;

    const detections = await runRules(admin, 'tenant-1', 'batch', {
      window: {
        startUtc: '2026-07-20T00:00:00.000Z',
        endUtc: '2026-07-21T00:00:00.000Z',
      },
      runId: 'run-1',
    });

    expect(detections[0]).toEqual(
      expect.objectContaining({
        anomalyId: 'anomaly-1',
        ruleKey: 'completed_service_unpaid',
      })
    );
    expect(mockUpsertAnomaly).toHaveBeenCalled();
  });
});
