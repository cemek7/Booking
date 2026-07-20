import { describe, expect, it, jest } from '@jest/globals';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from './businessEvents';

function mockAdmin(insert: jest.Mock) {
  return {
    from: jest.fn(() => ({ insert })),
  } as never;
}

describe('recordBusinessEvent', () => {
  it('inserts a normalized row into business_events', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const admin = mockAdmin(insert);

    await recordBusinessEvent(admin, {
      tenantId: 't1',
      actorType: 'system',
      action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_COMPUTED,
      entityType: 'reconciliation_run',
      entityId: 'r1',
    });

    expect(admin.from).toHaveBeenCalledWith('business_events');
    const row = insert.mock.calls[0][0];
    expect(row).toMatchObject({
      tenant_id: 't1',
      actor_type: 'system',
      action: 'reconciliation.computed',
      source: 'system',
      metadata: {},
    });
  });

  it('never throws when the insert errors', async () => {
    const insert = jest.fn(async () => ({ error: { message: 'boom' } }));
    await expect(
      recordBusinessEvent(mockAdmin(insert), {
        tenantId: 't1',
        actorType: 'system',
        action: 'x.y',
      })
    ).resolves.toBeUndefined();
  });
});
