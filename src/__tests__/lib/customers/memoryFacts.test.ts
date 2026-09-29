import { extractExplicitMemoryFacts, recordVerifiedMemoryFact, type MemoryFactStore } from '@/lib/customers/memoryFacts';

describe('verified customer memory', () => {
  it('extracts only explicit durable statements', () => {
    expect(extractExplicitMemoryFacts('I prefer knotless braids with Amaka')).toEqual([
      { key: 'preferred_service', value: 'knotless braids' },
      { key: 'preferred_staff', value: 'Amaka' },
    ]);
    expect(extractExplicitMemoryFacts('Call me Ada')).toEqual([{ key: 'consented_contact_name', value: 'Ada' }]);
    expect(extractExplicitMemoryFacts('I prefer mornings')).toEqual([{ key: 'preferred_time_window', value: 'mornings' }]);
    expect(extractExplicitMemoryFacts('My email is Ada@Example.com')).toEqual([{ key: 'consented_email', value: 'ada@example.com' }]);
    expect(extractExplicitMemoryFacts('She probably likes Amaka')).toEqual([]);
  });

  it('delegates an atomic source-backed superseding write', async () => {
    const store: MemoryFactStore = { recordAtomic: jest.fn(async (input) => ({ id: 'fact-2', ...input })) };
    const result = await recordVerifiedMemoryFact({
      tenantId: 'tenant-a', customerId: 'customer-a', key: 'preferred_service', value: 'Braids',
      sourceType: 'explicit_message', sourceMessageId: 'message-a', verifiedAt: '2026-09-29T10:00:00Z',
    }, store);
    expect(result.id).toBe('fact-2');
    expect(store.recordAtomic).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-a', customerId: 'customer-a', sourceMessageId: 'message-a' }));
  });

  it('rejects sensitive or non-allowlisted keys', async () => {
    await expect(recordVerifiedMemoryFact({
      tenantId: 't', customerId: 'c', key: 'diagnosis' as never, value: 'private',
      sourceType: 'operator', sourceRecordId: 'operator-1', verifiedAt: '2026-09-29T10:00:00Z',
    })).rejects.toThrow('Unsupported customer memory fact');
  });
});
