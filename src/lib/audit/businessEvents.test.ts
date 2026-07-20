import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from './businessEvents';

function mockAdmin(insert: jest.Mock): SupabaseClient {
  return {
    from: jest.fn(() => ({
      insert,
    })),
  } as unknown as SupabaseClient;
}

describe('recordBusinessEvent', () => {
  it('inserts a normalized row into business_events', async () => {
    const insert = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          tenant_id: 't1',
          action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
          entity_type: 'reconciliation_run',
          entity_id: 'r1',
          created_at: '2026-07-20T00:00:00.000Z',
          metadata: {},
        },
        error: null,
      }),
    }));
    const admin = mockAdmin(insert);

    await recordBusinessEvent(admin, {
      tenantId: 't1',
      actorType: 'system',
      action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
      entityType: 'reconciliation_run',
      entityId: 'r1',
    });

    expect(admin.from).toHaveBeenCalledWith('business_events');
    const firstCall = insert.mock.calls[0] as unknown[] | undefined;
    const row = (firstCall?.[0] ?? {}) as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: 't1',
      actor_type: 'system',
      action: 'reconciliation.computed',
      source: 'system',
      metadata: {},
    });
  });

  it('never throws when the insert errors', async () => {
    const insert = jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
    }));
    await expect(
      recordBusinessEvent(mockAdmin(insert), {
        tenantId: 't1',
        actorType: 'system',
        action: 'x.y',
      })
    ).resolves.toBeUndefined();
  });
});
