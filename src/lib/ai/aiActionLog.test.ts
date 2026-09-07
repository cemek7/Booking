import { describe, expect, it } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findByIdempotencyKey, logAiAction } from './aiActionLog';

describe('aiActionLog', () => {
  it('returns the prior outcome on idempotency hit', async () => {
    const maybeSingle = jest.fn(async () => ({ data: { outcome: 'duplicate' }, error: null }));
    // `const eq = jest.fn(() => ({ eq }))` referenced itself in its own
    // initializer, so TypeScript could not infer a type for it and every
    // .mockReturnValueOnce() below resolved against `any`. Declaring the chain
    // shape first breaks the cycle without changing what the mock does.
    type EqChain = { eq: jest.Mock; maybeSingle?: typeof maybeSingle };
    const eq: jest.Mock<EqChain> = jest.fn(() => ({ eq }));
    eq.mockReturnValueOnce({ eq });
    eq.mockReturnValueOnce({ eq, maybeSingle });
    const select = jest.fn(() => ({ eq }));
    const from = jest.fn((_table: string) => ({ select }));
    const admin = { from } as unknown as SupabaseClient;

    const result = await findByIdempotencyKey(admin, 'tenant-1', 'idem-1');

    expect(from).toHaveBeenCalledWith('ai_action_log');
    expect(result).toEqual({ outcome: 'duplicate' });
  });

  it('inserts ai action log rows', async () => {
    const insert = jest.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const from = jest.fn((_table: string) => ({ insert }));
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
