import { describe, it, expect } from '@jest/globals';
import { recordUnsubscribe, isUnsubscribed } from '@/lib/email/preferences';

function makeAdmin(existing: unknown) {
  const ops: Array<{ kind: string; payload?: unknown }> = [];
  const admin = {
    from() {
      const builder: Record<string, unknown> = {
        upsert(payload: unknown) { ops.push({ kind: 'upsert', payload }); return builder; },
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve({ data: existing, error: null }); },
        then(resolve: (v: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return builder;
    },
  };
  return { admin: admin as never, ops };
}

const key = { tenantId: 't1', recipient: 'ada@example.com', list: 'marketing' };

describe('recordUnsubscribe', () => {
  it('upserts an unsubscribe row keyed by tenant/recipient/list', async () => {
    const { admin, ops } = makeAdmin(null);
    await recordUnsubscribe(admin, key);
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('upsert');
    expect(ops[0].payload).toMatchObject({ tenant_id: 't1', recipient: 'ada@example.com', list: 'marketing' });
  });
});

describe('isUnsubscribed', () => {
  it('returns true when a row exists', async () => {
    const { admin } = makeAdmin({ tenant_id: 't1' });
    expect(await isUnsubscribed(admin, key)).toBe(true);
  });

  it('returns false when no row exists', async () => {
    const { admin } = makeAdmin(null);
    expect(await isUnsubscribed(admin, key)).toBe(false);
  });
});
