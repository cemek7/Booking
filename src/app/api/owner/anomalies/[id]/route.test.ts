import { describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const mockRecordBusinessEvent = jest.fn();

jest.mock('@/lib/audit/businessEvents', () => ({
  BUSINESS_EVENT_ACTIONS: {
    ANOMALY_RESOLVED: 'anomaly.resolved',
    ANOMALY_REVIEWED: 'anomaly.reviewed',
  },
  recordBusinessEvent: (...args: unknown[]) => mockRecordBusinessEvent(...args),
}));

import { PATCH } from './route';

function makeAdmin(rows: Record<string, unknown[] | unknown> = {}) {
  const ops: Array<{ table: string; kind: string; payload?: unknown }> = [];
  const admin = {
    from(table: string) {
      const op = { table, kind: '', payload: undefined as unknown };
      ops.push(op);
      const b: Record<string, unknown> = {
        select() { op.kind ||= 'select'; return b; },
        update(payload: unknown) { op.kind = 'update'; op.payload = payload; return b; },
        eq() { return b; },
        maybeSingle() {
          const values = rows[table];
          const row = Array.isArray(values) ? values.shift() ?? null : values ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        single() {
          const values = rows[table];
          const row = Array.isArray(values) ? values.shift() ?? null : values ?? null;
          return Promise.resolve({ data: row, error: null });
        },
      };
      return b;
    },
  };
  return { admin, ops };
}

describe('PATCH /api/owner/anomalies/[id]', () => {
  it('rejects resolving an anomaly without a note', async () => {
    const { admin } = makeAdmin({
      business_anomalies: [{ id: 'anomaly-1', tenant_id: 'tenant-1', status: 'open' }],
    });

    await expect(
      PATCH({
        request: new NextRequest('http://localhost/api/owner/anomalies/anomaly-1', {
          method: 'PATCH',
          body: JSON.stringify({ status: 'resolved' }),
        }),
        supabase: admin as never,
        params: { id: 'anomaly-1' },
        user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1' },
      })
    ).rejects.toMatchObject({
      code: 'validation_error',
    });
  });

  it('resolves an anomaly with a note and emits anomaly.resolved', async () => {
    const { admin, ops } = makeAdmin({
      business_anomalies: [
        { id: 'anomaly-1', tenant_id: 'tenant-1', status: 'open', resolution_note: null },
        { id: 'anomaly-1', tenant_id: 'tenant-1', status: 'resolved', resolution_note: 'Investigated and fixed' },
      ],
    });

    const result = await PATCH({
      request: new NextRequest('http://localhost/api/owner/anomalies/anomaly-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved', resolution_note: 'Investigated and fixed' }),
      }),
      supabase: admin as never,
      params: { id: 'anomaly-1' },
      user: { id: 'user-1', email: 'owner@test.com', role: 'owner', tenantId: 'tenant-1' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        anomaly: expect.objectContaining({
          status: 'resolved',
          resolution_note: 'Investigated and fixed',
        }),
      })
    );
    expect(ops.find((entry) => entry.table === 'business_anomalies' && entry.kind === 'update')?.payload).toEqual(
      expect.objectContaining({
        status: 'resolved',
        resolution_note: 'Investigated and fixed',
      })
    );
    expect(mockRecordBusinessEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'anomaly.resolved',
        entityId: 'anomaly-1',
      })
    );
  });
});
