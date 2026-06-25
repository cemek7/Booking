import { describe, it, expect } from '@jest/globals';
import { flagReview, setReviewHidden, listReviewFlags, resolveFlag } from '@/lib/moderation/reviews';

interface Op { table: string; kind: string; payload?: unknown; filters: Array<[string, unknown]> }

function makeAdmin(rows: unknown[] = []) {
  const ops: Op[] = [];
  const admin = {
    from(table: string) {
      const op: Op = { table, kind: '', filters: [] };
      ops.push(op);
      const builder: Record<string, unknown> = {
        insert(payload: unknown) { op.kind = 'insert'; op.payload = payload; return builder; },
        update(payload: unknown) { op.kind = 'update'; op.payload = payload; return builder; },
        select() { op.kind ||= 'select'; return builder; },
        eq(c: string, v: unknown) { op.filters.push([c, v]); return builder; },
        order() { return builder; },
        then(resolve: (v: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, ops };
}

describe('moderation/reviews', () => {
  it('flagReview inserts a pending report', async () => {
    const { admin, ops } = makeAdmin();
    await flagReview(admin, { tenantId: 't1', reviewId: 'r1', reason: 'spam', reporter: 'x' });
    const op = ops.find((o) => o.table === 'review_flags');
    expect(op?.kind).toBe('insert');
    expect(op?.payload).toMatchObject({ tenant_id: 't1', review_id: 'r1', reason: 'spam', status: 'pending' });
  });

  it('setReviewHidden updates the review hidden flag, tenant-scoped', async () => {
    const { admin, ops } = makeAdmin();
    await setReviewHidden(admin, { tenantId: 't1', reviewId: 'r1', hidden: true });
    const op = ops.find((o) => o.table === 'reviews');
    expect(op?.kind).toBe('update');
    expect(op?.payload).toEqual({ hidden: true });
    expect(op?.filters).toEqual(expect.arrayContaining([['id', 'r1'], ['tenant_id', 't1']]));
  });

  it('listReviewFlags returns rows for the tenant', async () => {
    const { admin } = makeAdmin([{ id: 'f1' }]);
    expect(await listReviewFlags(admin, { tenantId: 't1' })).toEqual([{ id: 'f1' }]);
  });

  it('resolveFlag updates the flag status', async () => {
    const { admin, ops } = makeAdmin();
    await resolveFlag(admin, { tenantId: 't1', flagId: 'f1', status: 'resolved' });
    const op = ops.find((o) => o.table === 'review_flags');
    expect(op?.kind).toBe('update');
    expect(op?.payload).toEqual({ status: 'resolved' });
  });
});
