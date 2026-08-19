import { describe, it, expect } from '@jest/globals';
import {
  recordMessagingConsent,
  hasMessagingConsent,
  revokeMessagingConsent,
} from '@/lib/optin/messagingConsent';

function makeAdmin(existing: unknown) {
  const ops: Array<{ kind: string; payload?: unknown }> = [];
  const admin = {
    from() {
      const b: Record<string, unknown> = {
        upsert(p: unknown) { ops.push({ kind: 'upsert', payload: p }); return b; },
        delete() { ops.push({ kind: 'delete' }); return b; },
        select() { return b; },
        eq() { return b; },
        maybeSingle() { return Promise.resolve({ data: existing, error: null }); },
        then(resolve: (v: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return b;
    },
  };
  return { admin: admin as never, ops };
}

const key = { tenantId: 't1', recipient: '2348000', channel: 'whatsapp' as const };

describe('messagingConsent', () => {
  it('records consent as an upsert with source', async () => {
    const { admin, ops } = makeAdmin(null);
    await recordMessagingConsent(admin, { ...key, source: 'booking_form' });
    expect(ops[0].kind).toBe('upsert');
    expect(ops[0].payload).toMatchObject({ tenant_id: 't1', recipient: '2348000', channel: 'whatsapp', source: 'booking_form' });
  });

  it('hasMessagingConsent is true when a row exists, false otherwise', async () => {
    expect(await hasMessagingConsent(makeAdmin({ tenant_id: 't1' }).admin, key)).toBe(true);
    expect(await hasMessagingConsent(makeAdmin(null).admin, key)).toBe(false);
  });

  it('revokeMessagingConsent deletes the row', async () => {
    const { admin, ops } = makeAdmin({ tenant_id: 't1' });
    await revokeMessagingConsent(admin, key);
    expect(ops.some((o) => o.kind === 'delete')).toBe(true);
  });
});
