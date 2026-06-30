import { describe, expect, it } from '@jest/globals';
import { convertMentionToLead } from '@/lib/listening/convert';

function makeAdmin() {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        insert(payload: unknown) {
          ops.push({ table, kind: 'insert', payload });
          return Promise.resolve({ error: null });
        },
        update(payload: unknown) {
          ops.push({ table, kind: 'update', payload });
          return builder;
        },
        eq() { return builder; },
        then(resolve: (value: { error: null }) => unknown) {
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, ops };
}

describe('convertMentionToLead', () => {
  it('throws when phone is missing', async () => {
    const { admin } = makeAdmin();
    await expect(
      convertMentionToLead(admin, { mentionId: 'm1', tenantId: 't1', contact: { phone: '' } })
    ).rejects.toThrow(/phone/i);
  });

  it('inserts a social lead and marks the mention converted', async () => {
    const { admin, ops } = makeAdmin();
    await convertMentionToLead(admin, {
      mentionId: 'm1',
      tenantId: 't1',
      contact: { phone: '2348000', name: 'Ada', notes: 'from IG' },
    });

    expect(ops).toContainEqual({
      table: 'leads',
      kind: 'insert',
      payload: expect.objectContaining({
        tenant_id: 't1',
        phone: '2348000',
        source: 'social',
        name: 'Ada',
      }),
    });
    const update = ops.find((entry) => entry.table === 'social_mentions' && entry.kind === 'update');
    expect(update?.payload).toEqual({ status: 'converted' });
  });
});
