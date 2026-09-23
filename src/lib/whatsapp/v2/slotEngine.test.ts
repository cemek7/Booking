import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: () => ({ from: mockFrom }),
}));

import { lockSlot, releaseLock } from './slotEngine';

describe('WhatsApp temporary slot holds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('continues to create and release holds through slot_locks', async () => {
    const insertChain: Record<string, jest.Mock> = {};
    insertChain.insert = jest.fn(() => insertChain);
    insertChain.select = jest.fn(() => insertChain);
    insertChain.single = jest.fn(async () => ({ data: { id: 'hold-1' }, error: null }));
    const deleteChain: Record<string, jest.Mock> = {};
    deleteChain.delete = jest.fn(() => deleteChain);
    deleteChain.eq = jest.fn(async () => ({ error: null }));
    mockFrom
      .mockReturnValueOnce(insertChain)
      .mockReturnValueOnce(deleteChain);

    await expect(lockSlot(
      'tenant-1',
      'staff-1',
      '2026-09-24',
      '10:00',
      '11:00',
      '+2348000000000',
    )).resolves.toBe('hold-1');
    await releaseLock('hold-1');

    expect(mockFrom).toHaveBeenNthCalledWith(1, 'slot_locks');
    expect(mockFrom).toHaveBeenNthCalledWith(2, 'slot_locks');
    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1',
      tenant_staff_id: 'staff-1',
    }));
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'hold-1');
  });
});
