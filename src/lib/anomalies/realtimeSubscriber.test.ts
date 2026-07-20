import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockNotifyRealtimeAnomalies = jest.fn();
const mockUpsertAnomaly = jest.fn();

jest.mock('./notify', () => ({
  notifyRealtimeAnomalies: (...args: unknown[]) => mockNotifyRealtimeAnomalies(...args),
}));

jest.mock('./upsertAnomaly', () => ({
  upsertAnomaly: (...args: unknown[]) => mockUpsertAnomaly(...args),
}));

import { processBusinessEventForAnomalies } from './realtimeSubscriber';

function makeAdmin() {
  const responseMap = new Map<string, { data: unknown; error: { message: string } | null }>();

  return {
    __responses: responseMap,
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
        then?: (onfulfilled: (value: unknown) => unknown) => unknown;
      };

      state.then = (onfulfilled) =>
        Promise.resolve(onfulfilled(responseMap.get(table) ?? { data: [], error: null }));

      return state;
    }),
  } as unknown as SupabaseClient & { __responses: Map<string, { data: unknown; error: { message: string } | null }> };
}

describe('processBusinessEventForAnomalies', () => {
  beforeEach(() => {
    mockNotifyRealtimeAnomalies.mockReset();
    mockUpsertAnomaly.mockReset();
    mockUpsertAnomaly.mockResolvedValue('anomaly-1');
  });

  it('runs only the matching realtime rule for order.refunded', async () => {
    const admin = makeAdmin();
    admin.__responses.set('transactions', {
      data: [{ id: 'txn-1', subject_type: 'retail_order', subject_id: 'order-1', refund_amount: 25, refund_reason: null }],
      error: null,
    });

    const detections = await processBusinessEventForAnomalies(admin, {
      tenantId: 'tenant-1',
      action: 'order.refunded',
      entityType: 'retail_order',
      entityId: 'order-1',
      createdAt: '2026-07-20T10:00:00.000Z',
    });

    expect(detections).toHaveLength(1);
    expect(detections[0]).toEqual(
      expect.objectContaining({
        ruleKey: 'refund_without_reason',
        anomalyId: 'anomaly-1',
      })
    );
    expect(mockUpsertAnomaly).toHaveBeenCalledTimes(1);
    expect(mockNotifyRealtimeAnomalies).toHaveBeenCalledWith(
      admin,
      'tenant-1',
      expect.arrayContaining([expect.objectContaining({ ruleKey: 'refund_without_reason' })])
    );
  });
});
