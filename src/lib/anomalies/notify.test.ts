import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockSendTextMessage = jest.fn();
const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/whatsapp/providers', () => ({
  buildDefaultWhatsAppProviderConfig: () => ({ provider: 'meta' }),
  getProviderClient: () => ({
    sendTextMessage: (...args: unknown[]) => mockSendTextMessage(...args),
  }),
}));

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    ANOMALY_ALERTED: 'anomaly.alerted',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { notifyRealtimeAnomalies } from './notify';

function makeAdmin(rows: Record<string, unknown[] | unknown> = {}) {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select() { return b; },
        eq() { return b; },
        gte() { return b; },
        limit() { return b; },
        maybeSingle() {
          if (table === 'business_events') return Promise.resolve({ data: rows[table] ?? null, error: null });
          if (table === 'tenant_users') return Promise.resolve({ data: rows[table] ?? null, error: null });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe('notifyRealtimeAnomalies', () => {
  beforeEach(() => {
    mockSendTextMessage.mockReset();
    mockRecordBusinessEvent.mockReset();
  });

  it('does not send a second immediate alert inside the debounce window', async () => {
    const admin = makeAdmin({
      business_events: { id: 'evt-1' },
      tenant_users: { users: { phone: '+2348000000000' } },
    });

    await notifyRealtimeAnomalies(admin, 'tenant-1', [
      {
        anomalyId: 'anomaly-1',
        ruleKey: 'refund_without_reason',
        domain: 'retail',
        severity: 'high',
        entityType: 'retail_order',
        entityId: 'order-1',
        expectedValueCents: 500000,
        actualValueCents: 0,
        differenceCents: 500000,
        detectionSource: 'realtime_event',
        dedupKey: 'refund_without_reason:order-1',
      },
    ]);

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockRecordBusinessEvent).not.toHaveBeenCalled();
  });
});
