import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OperatingObjectiveDraft } from './types';
import { createOperatingLoopService } from './service';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const NOW = new Date('2026-08-22T10:00:00.000Z');

function makeAdmin(seed: Tables) {
  const tables = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
  ) as Tables;
  let nextId = 1;

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: Row | Row[] | null = null;
    let maxRows: number | null = null;
    let orderBy: { column: string; ascending: boolean } | null = null;

    const builder = {
      select() {
        return builder;
      },
      insert(value: Row | Row[]) {
        operation = 'insert';
        payload = value;
        return builder;
      },
      update(value: Row) {
        operation = 'update';
        payload = value;
        return builder;
      },
      upsert(value: Row | Row[]) {
        operation = 'upsert';
        payload = value;
        return builder;
      },
      delete() {
        operation = 'delete';
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => row[column] !== value);
        return builder;
      },
      gt(column: string, value: string) {
        filters.push((row) => String(row[column]) > value);
        return builder;
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column]) >= value);
        return builder;
      },
      lte(column: string, value: string) {
        filters.push((row) => String(row[column]) <= value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy = { column, ascending: options?.ascending ?? true };
        return builder;
      },
      limit(value: number) {
        maxRows = value;
        return builder;
      },
      async maybeSingle() {
        const result = execute();
        return { ...result, data: result.data[0] ?? null };
      },
      async single() {
        const result = execute();
        return { ...result, data: result.data[0] ?? null };
      },
      then<TResult1 = { data: Row[]; error: null | { code: string; message: string } }>(
        onfulfilled?: ((value: { data: Row[]; error: null | { code: string; message: string } }) => TResult1 | PromiseLike<TResult1>) | null,
      ) {
        return Promise.resolve(execute()).then(onfulfilled);
      },
    };

    function matchingRows() {
      const rows = tables[table] ?? [];
      let matches = rows.filter((row) => filters.every((filter) => filter(row)));
      if (orderBy) {
        const { column, ascending } = orderBy;
        matches = [...matches].sort((left, right) => {
          const compared = String(left[column]).localeCompare(String(right[column]));
          return ascending ? compared : -compared;
        });
      }
      return maxRows === null ? matches : matches.slice(0, maxRows);
    }

    function execute(): { data: Row[]; error: null | { code: string; message: string } } {
      tables[table] ??= [];

      if (operation === 'select') {
        return { data: matchingRows().map((row) => ({ ...row })), error: null };
      }

      if (operation === 'insert') {
        const values = (Array.isArray(payload) ? payload : [payload]).filter((row): row is Row => row !== null);
        const duplicatePrimaryKey = values.find((value) =>
          value.id !== undefined && tables[table].some((row) => row.id === value.id),
        );
        if (duplicatePrimaryKey) {
          return { data: [], error: { code: '23505', message: 'duplicate primary key' } };
        }
        if (table === 'operating_objectives') {
          const duplicate = values.find((value) =>
            tables[table].some((row) =>
              row.tenant_id === value.tenant_id &&
              row.dedupe_key === value.dedupe_key &&
              row.status === 'active',
            ),
          );
          if (duplicate) {
            return { data: [], error: { code: '23505', message: 'duplicate active objective' } };
          }
        }
        const inserted = values.map((value) => ({ id: value.id ?? `${table}-${nextId++}`, ...value }));
        tables[table].push(...inserted);
        return { data: inserted.map((row) => ({ ...row })), error: null };
      }

      if (operation === 'update') {
        const matches = matchingRows();
        for (const row of matches) Object.assign(row, payload);
        return { data: matches.map((row) => ({ ...row })), error: null };
      }

      if (operation === 'delete') {
        const matches = new Set(matchingRows());
        tables[table] = tables[table].filter((row) => !matches.has(row));
        return { data: [], error: null };
      }

      const values = (Array.isArray(payload) ? payload : [payload]).filter((row): row is Row => row !== null);
      const upserted = values.map((value) => {
        const existing = tables[table].find((row) =>
          table === 'operating_loop_state'
            ? row.tenant_id === value.tenant_id && row.operating_date === value.operating_date
            : row.id === value.id,
        );
        if (existing) {
          Object.assign(existing, value);
          return existing;
        }
        const inserted = { id: value.id ?? `${table}-${nextId++}`, ...value };
        tables[table].push(inserted);
        return inserted;
      });
      return { data: upserted.map((row) => ({ ...row })), error: null };
    }

    return builder;
  }

  return {
    admin: { from } as unknown as SupabaseClient,
    tables,
  };
}

function objective(overrides: Row = {}): Row {
  return {
    id: 'objective-1',
    tenant_id: 'tenant-1',
    objective_type: 'confirm_booking',
    dedupe_key: 'confirm_booking:reservation-1',
    title: 'Confirm Ada booking',
    explanation: 'Ada needs to confirm.',
    evidence: { bookingId: 'reservation-1', customerName: 'Ada' },
    affected_record_ids: ['reservation-1'],
    priority_score: 500,
    amount_at_risk: 25000,
    expires_at: '2026-08-22T12:00:00.000Z',
    status: 'active',
    created_at: '2026-08-22T09:00:00.000Z',
    updated_at: '2026-08-22T09:00:00.000Z',
    ...overrides,
  };
}

function activePolicy(overrides: Row = {}): Row {
  return {
    id: 'policy-1',
    tenant_id: 'tenant-1',
    name: 'Routine confirmations',
    action_type: 'confirm_booking',
    status: 'active',
    eligibility_rules: { maxAmountAtRisk: 50000 },
    quiet_hours: {},
    approved_by: 'owner-1',
    approved_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

function baseTables(overrides: Tables = {}): Tables {
  return {
    tenant_users: [{ tenant_id: 'tenant-1', user_id: 'owner-1', role: 'owner' }],
    tenants: [{ id: 'tenant-1', whatsapp_number: '2348000000000' }],
    reservations: [{
      id: 'reservation-1',
      tenant_id: 'tenant-1',
      customer_name: 'Ada',
      customer_number: '2348111111111',
      start_at: '2026-08-23T10:00:00.000Z',
    }],
    leads: [],
    operating_loop_state: [{
      id: 'state-1',
      tenant_id: 'tenant-1',
      operating_date: '2026-08-22',
      state: 'active',
      automation_paused: false,
      supporting_signals: [],
    }],
    operating_objectives: [objective()],
    automation_policies: [activePolicy()],
    operating_actions: [],
    ...overrides,
  };
}

function makeService(tables = baseTables()) {
  const { admin, tables: storedTables } = makeAdmin(tables);
  const queue = jest.fn<(tenantId: string, from: string, to: string, content: string, priority?: 'normal', metadata?: Record<string, unknown>) => Promise<string | null>>()
    .mockResolvedValue('queue-1');
  const service = createOperatingLoopService({ admin, queueWhatsAppMessage: queue, now: () => NOW });
  return { service, queue, tables: storedTables };
}

describe('operating loop service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an objective whose freshness window has elapsed', async () => {
    const { service, queue } = makeService(baseTables({
      operating_objectives: [objective({ expires_at: '2026-08-22T09:59:59.000Z' })],
    }));

    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('rejects an objective belonging to another tenant', async () => {
    const { service, queue } = makeService(baseTables({
      operating_objectives: [objective({ tenant_id: 'tenant-2' })],
    }));

    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'tenant_mismatch' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('requires an active owner-approved policy before queueing', async () => {
    const { service, queue } = makeService(baseTables({ automation_policies: [] }));

    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('re-checks that the actor is a tenant owner before queueing', async () => {
    const { service, queue } = makeService(baseTables({
      tenant_users: [{ tenant_id: 'tenant-1', user_id: 'staff-1', role: 'staff' }],
    }));

    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'staff-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('deduplicates active evaluator drafts by tenant and dedupe key', async () => {
    const { service, tables } = makeService(baseTables({ operating_objectives: [] }));
    const draft: OperatingObjectiveDraft = {
      tenantId: 'tenant-1',
      kind: 'confirm_booking',
      title: 'Confirm Ada booking',
      explanation: 'Ada needs to confirm.',
      evidence: { bookingId: 'reservation-1', customerName: 'Ada' },
      affectedRecordIds: ['reservation-1'],
      amountAtRisk: 25000,
      expiresAt: '2026-08-22T12:00:00.000Z',
      dedupeKey: 'confirm_booking:reservation-1',
      status: 'active',
      score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
    };

    const first = await service.persistObjectiveDrafts('tenant-1', [draft]);
    const second = await service.persistObjectiveDrafts('tenant-1', [draft]);

    expect(first[0]?.id).toBe(second[0]?.id);
    expect(tables.operating_objectives).toHaveLength(1);
  });

  it('queues one approved routine send and stores its proposal and delivery reference', async () => {
    const { service, queue, tables } = makeService();

    const result = await service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    });

    expect(queue).toHaveBeenCalledTimes(1);
    expect(queue).toHaveBeenCalledWith(
      'tenant-1',
      '2348000000000',
      '2348111111111',
      expect.stringContaining('confirm'),
      'normal',
      expect.objectContaining({ objectiveId: 'objective-1', policyId: 'policy-1' }),
    );
    expect(result).toEqual(expect.objectContaining({ status: 'queued', deliveryReference: 'queue-1' }));
    expect(tables.operating_actions).toContainEqual(expect.objectContaining({
      tenant_id: 'tenant-1',
      objective_id: 'objective-1',
      policy_id: 'policy-1',
      action_type: 'execute',
      status: 'queued',
      proposed_payload: expect.objectContaining({
        toNumber: '2348111111111',
        actionType: 'confirm_booking',
      }),
      delivery_reference: 'queue-1',
    }));
  });

  it('claims an objective once so repeated execution cannot enqueue a duplicate send', async () => {
    const { service, queue } = makeService();

    await service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    });
    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'conflict' });

    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('records a failed action when the queue adapter throws', async () => {
    const { service, queue, tables } = makeService();
    queue.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'external_service_error' });

    expect(tables.operating_actions).toContainEqual(expect.objectContaining({
      action_type: 'execute', status: 'failed', result_payload: { reason: 'queue_failed' },
    }));
    expect(tables.operating_objectives[0]).toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('schedules a defer and creates an immutable defer audit record', async () => {
    const { service, queue, tables } = makeService();

    await service.deferObjective({
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      objectiveId: 'objective-1',
      scheduledFor: '2026-08-22T11:00:00.000Z',
    });

    expect(queue).not.toHaveBeenCalled();
    expect(tables.operating_objectives[0]).toEqual(expect.objectContaining({ status: 'deferred' }));
    expect(tables.operating_actions).toContainEqual(expect.objectContaining({
      action_type: 'defer',
      status: 'deferred',
      scheduled_for: '2026-08-22T11:00:00.000Z',
    }));
  });

  it('dismisses without deleting the underlying objective', async () => {
    const { service, tables } = makeService();

    await service.dismissObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1', reason: 'Already called',
    });

    expect(tables.operating_objectives).toHaveLength(1);
    expect(tables.operating_objectives[0]).toEqual(expect.objectContaining({ status: 'dismissed' }));
    expect(tables.operating_actions).toContainEqual(expect.objectContaining({
      action_type: 'dismiss', status: 'dismissed', result_payload: { reason: 'Already called' },
    }));
  });

  it('applies automation pause immediately and blocks a subsequent execution', async () => {
    const { service, queue } = makeService();

    await service.replacePolicies({
      tenantId: 'tenant-1', actorId: 'owner-1', automationPaused: true, policies: [],
    });

    const policies = await service.getPolicies('tenant-1');
    expect(policies.automationPaused).toBe(true);
    await expect(service.executeObjective({
      tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1',
    })).rejects.toMatchObject({ code: 'forbidden' });
    expect(queue).not.toHaveBeenCalled();
  });

  it('pauses automation without changing the current loop state', async () => {
    const tables = baseTables();
    tables.operating_loop_state[0].state = 'clear';
    const { service, tables: stored } = makeService(tables);

    await service.replacePolicies({
      tenantId: 'tenant-1', actorId: 'owner-1', automationPaused: true, policies: [],
    });

    expect(stored.operating_loop_state[0]).toEqual(expect.objectContaining({
      state: 'clear', automation_paused: true,
    }));
  });

  it('replaces an existing policy without reusing its revoked row id', async () => {
    const { service, tables } = makeService();

    await service.replacePolicies({
      tenantId: 'tenant-1',
      actorId: 'owner-1',
      automationPaused: false,
      policies: [{
        id: 'policy-1',
        name: 'Updated confirmations',
        actionType: 'confirm_booking',
        status: 'active',
        eligibilityRules: { maxAmountAtRisk: 75000 },
      }],
    });

    const active = tables.automation_policies.filter((policy) => policy.status === 'active');
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual(expect.objectContaining({
      name: 'Updated confirmations', approved_by: 'owner-1',
    }));
    expect(active[0]?.id).not.toBe('policy-1');
  });

  it('returns a compact active loop view with the highest-priority fresh objective', async () => {
    const { service } = makeService();

    await expect(service.getLoop('tenant-1')).resolves.toEqual(expect.objectContaining({
      state: 'active',
      automationPaused: false,
      primaryObjective: expect.objectContaining({ id: 'objective-1', kind: 'confirm_booking' }),
    }));
  });
});
