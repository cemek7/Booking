import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findByIdempotencyKey, logAiAction } from './aiActionLog';

describe('aiActionLog', () => {
  it('returns the prior outcome on idempotency hit', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { outcome: 'duplicate' }, error: null }));
    const eq = jest.fn(() => ({ eq }));
    eq.mockReturnValueOnce({ eq });
    eq.mockReturnValueOnce({ maybeSingle });
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn(() => ({ select }));
    const admin = { from } as unknown as SupabaseClient;

    const result = await findByIdempotencyKey(admin, 'tenant-1', 'idem-1');

    expect(from).toHaveBeenCalledWith('ai_action_log');
    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('inserts ai action log rows', async () => {
    const insert = jest.fn(async () => ({ error: null }));
    const from = jest.fn(() => ({ insert }));
    const admin = { from } as unknown as SupabaseClient;

    await logAiAction(admin, {
      tenantId: 'tenant-1',
      actorType: 'owner',
      action: 'record_retail_sale',
      idempotencyKey: 'idem-1',
      outcome: 'executed',
      params: { amount: 5000 },
    });

    expect(from).toHaveBeenCalledWith('ai_action_log');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        action: 'record_retail_sale',
        idempotency_key: 'idem-1',
        outcome: 'executed',
      })
    );
  });
});
