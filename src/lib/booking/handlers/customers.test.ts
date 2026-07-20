import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS } from '@/lib/audit/businessEvents';

const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    CUSTOMER_NOTE_ADDED: 'customer.note_added',
    CUSTOMER_TAGGED: 'customer.tagged',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { customerHandlers } from './customers';

function makeAdmin(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const queue = [...responses];
  return {
    from: jest.fn(() => {
      const state = {
        select: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
        single: jest.fn(async () => queue.shift() ?? { data: null, error: null }),
      };
      return state;
    }),
  } as unknown as SupabaseClient;
}

describe('customerHandlers', () => {
  beforeEach(() => {
    mockRecordBusinessEvent.mockReset();
  });

  it('set_customer_tag appends a tag once and emits customer.tagged', async () => {
    const admin = makeAdmin([
      { data: { id: 'customer-1', tags: ['vip'] }, error: null },
      { data: { id: 'customer-1', tags: ['vip', 'wholesale'] }, error: null },
    ]);

    const result = await customerHandlers.set_customer_tag.execute(
      admin,
      'tenant-1',
      { customer_id: 'customer-1', tag: 'wholesale' },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.CUSTOMER_TAGGED,
        entityId: 'customer-1',
      })
    );
  });

  it('add_customer_note appends to notes and emits customer.note_added', async () => {
    const admin = makeAdmin([
      { data: { id: 'customer-1', notes: 'Existing', name: 'Amaka', customer_name: null }, error: null },
      { data: { id: 'customer-1', notes: 'Existing\n[2026-07-20T00:00:00.000Z] Follow up', name: 'Amaka', customer_name: null }, error: null },
    ]);

    const isoSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-07-20T00:00:00.000Z');

    const result = await customerHandlers.add_customer_note.execute(
      admin,
      'tenant-1',
      { customer_id: 'customer-1', note: 'Follow up' },
      { actorId: 'user-1' }
    );

    expect(result.success).toBe(true);
    expect(result.reply).toMatch(/Added note for Amaka/i);
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({
        action: BUSINESS_EVENT_ACTIONS.CUSTOMER_NOTE_ADDED,
        entityId: 'customer-1',
      })
    );

    isoSpy.mockRestore();
  });
});
