// Jest globals are available without import
import { publishEvent } from '@/lib/eventBus';

function mockSupabaseFailInsert() {
  return {
    from() { return { insert() { return { error: new Error('fail'), data: null }; }, select() { return this; } }; }
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('eventBus.publishEvent', () => {
  it('returns null on failure without throwing', async () => {
    const supabase = mockSupabaseFailInsert();
    const res = await publishEvent({ supabase, event: 'test.event', payload: { a: 1 } });
    expect(res).toBeNull();
  });
});
