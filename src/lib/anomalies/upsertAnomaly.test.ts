import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';
import { upsertAnomaly } from './upsertAnomaly';

const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    ANOMALY_DETECTED: 'anomaly.detected',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

function makeAdmin() {
  const responses = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();

  return {
    __responses: responses,
    from: jest.fn((table: string) => {
      const state = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(async () => responses.get(`${table}:maybeSingle`)?.shift() ?? { data: null, error: null }),
        update: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        single: jest.fn(async () => responses.get(`${table}:single`)?.shift() ?? { data: null, error: null }),
      };
      return state;
    }),
  } as unknown as SupabaseClient & { __responses: Map<string, Array<{ data: unknown; error: { message: string } | null }>> };
}

describe('upsertAnomaly', () => {
  beforeEach(() => {
    mockRecordBusinessEvent.mockReset();
  });

  it('bumps last_seen_at on an existing open anomaly', async () => {
    const admin = makeAdmin();
    admin.__responses.set('business_anomalies:maybeSingle', [
      { data: { id: 'anomaly-1', status: 'open' }, error: null },
    ]);

    const anomalyId = await upsertAnomaly(admin, {
      tenantId: 'tenant-1',
      ruleKey: 'completed_service_unpaid',
      domain: 'service',
      severity: 'high',
      detectionSource: 'reconciliation',
      dedupKey: 'svc:123',
    });

    expect(anomalyId).toBe('anomaly-1');
    expect(mockRecordBusinessEvent).not.toHaveBeenCalled();
  });

  it('creates a new anomaly linked to the previous resolved one', async () => {
    const admin = makeAdmin();
    admin.__responses.set('business_anomalies:maybeSingle', [
      { data: null, error: null },
      { data: { id: 'anomaly-old', status: 'resolved', detail: {} }, error: null },
    ]);
    admin.__responses.set('business_anomalies:single', [
      { data: { id: 'anomaly-new' }, error: null },
    ]);

    const anomalyId = await upsertAnomaly(admin, {
      tenantId: 'tenant-1',
      ruleKey: 'delivered_order_unpaid',
      domain: 'retail',
      severity: 'critical',
      entityType: 'retail_order',
      entityId: 'order-1',
      detectionSource: 'realtime_event',
      dedupKey: 'retail:order-1',
      detail: { order_id: 'order-1' },
    });

    expect(anomalyId).toBe('anomaly-new');
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.ANOMALY_DETECTED,
        entityId: 'anomaly-new',
      })
    );
  });
});
