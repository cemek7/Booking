import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOperatingLoopService } from './service';
import type { OperatingObjectiveDraft } from './types';

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

const NOW = new Date('2026-08-22T10:00:00.000Z');

function makeAdmin(seed: Tables) {
  const tables = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))]),
  ) as Tables;
  let nextId = 1;
  const rpc = jest.fn((name: string) => {
    if (name === 'queue_operating_delivery') return Promise.resolve({ data: [{ action_id: 'action-1', outbox_id: 'outbox-1' }], error: null });
    if (name === 'apply_operating_suppression') return Promise.resolve({ data: [{ action_id: 'action-2', suppression_id: 'suppression-1' }], error: null });
    if (name === 'persist_operating_objective_draft') return Promise.resolve({ data: [{ outcome: 'suppressed', objective: null }], error: null });
    return Promise.resolve({ data: null, error: null });
  });

  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let operation: 'select' | 'insert' = 'select';
    let payload: Row | null = null;
    const builder = {
      select: () => { if (operation !== 'insert') operation = 'select'; return builder; },
      insert: (value: Row) => { operation = 'insert'; payload = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder; },
      neq: (key: string, value: unknown) => { filters.push((row) => row[key] !== value); return builder; },
      gt: (key: string, value: string) => { filters.push((row) => typeof row[key] === 'string' && String(row[key]) > value); return builder; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return builder; },
      // Retained to model the fluent Supabase test double for any legacy read.
      or: () => {
        filters.push((row) => row.suppressed_until == null || String(row.suppressed_until) > NOW.toISOString());
        return builder;
      },
      order: () => builder,
      maybeSingle: async <T>() => ({ data: ((tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))[0] ?? null) as T | null, error: null }),
      single: async <T>() => {
        if (operation === 'insert' && payload) {
          const inserted = { id: `${table}-${nextId++}`, ...payload };
          (tables[table] ??= []).push(inserted);
          return { data: inserted as T, error: null };
        }
        return { data: ((tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))[0] ?? null) as T | null, error: null };
      },
      then: <TResult1 = { data: Row[]; error: null }, TResult2 = never>(
        onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve({
        data: operation === 'insert' && payload
          ? (() => { const inserted = { id: `${table}-${nextId++}`, ...payload }; (tables[table] ??= []).push(inserted); return [inserted]; })()
          : (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))),
        error: null,
      }).then(onfulfilled, onrejected),
    };
    return builder;
  }

  return { admin: { from, rpc } as unknown as SupabaseClient, tables, rpc };
}

function objective(overrides: Row = {}): Row {
  return {
    id: 'objective-1', tenant_id: 'tenant-1', objective_type: 'confirm_booking',
    dedupe_key: 'confirm_booking:reservation-1', source_fingerprint: 'v1:booking-1',
    title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
    evidence: { bookingId: 'reservation-1', customerName: 'Ada' }, affected_record_ids: ['reservation-1'],
    priority_score: 500, amount_at_risk: 25000, expires_at: '2026-08-22T12:00:00.000Z', status: 'active',
    ...overrides,
  };
}

function activePolicy(overrides: Row = {}): Row {
  return {
    id: 'policy-1', tenant_id: 'tenant-1', name: 'Routine confirmations', action_type: 'confirm_booking',
    status: 'active', eligibility_rules: { maxAmountAtRisk: 50000 }, quiet_hours: {},
    approved_by: 'owner-1', approved_at: '2026-08-20T10:00:00.000Z', ...overrides,
  };
}

function baseTables(overrides: Tables = {}): Tables {
  return {
    reservations: [{ id: 'reservation-1', tenant_id: 'tenant-1', customer_name: 'Ada', customer_number: '2348111111111', start_at: '2026-08-23T10:00:00.000Z' }],
    leads: [],
    operating_loop_state: [{ tenant_id: 'tenant-1', operating_date: '2026-08-22', state: 'active', supporting_signals: [] }],
    operating_loop_settings: [{ tenant_id: 'tenant-1', automation_paused: false }],
    operating_objectives: [objective()],
    operating_objective_suppressions: [],
    automation_policies: [activePolicy()],
    ...overrides,
  };
}

function makeService(tables = baseTables()) {
  const { admin, tables: storedTables, rpc } = makeAdmin(tables);
  return { service: createOperatingLoopService({ admin, now: () => NOW }), tables: storedTables, rpc };
}

describe('operating loop service', () => {
  it('atomically records an approved delivery through the dedicated operating outbox RPC', async () => {
    const { service, rpc } = makeService();

    await expect(service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' }))
      .resolves.toEqual({ actionId: 'action-1', outboxId: 'outbox-1', status: 'queued' });

    expect(rpc).toHaveBeenCalledWith('queue_operating_delivery', expect.objectContaining({
      p_tenant_id: 'tenant-1', p_actor_id: 'owner-1', p_objective_id: 'objective-1', p_policy_id: 'policy-1',
      p_idempotency_key: 'operating:tenant-1:objective-1:policy-1:v1:booking-1',
      p_payload: expect.objectContaining({ recipient: '2348111111111', actionType: 'confirm_booking' }),
    }));
  });

  it('requires owner approval for a sensitive recovery instead of queueing customer outreach', async () => {
    const { service, rpc } = makeService(baseTables({
      operating_objectives: [objective({ objective_type: 'recover_booking' })],
    }));

    await expect(service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' }))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(rpc).not.toHaveBeenCalledWith('queue_operating_delivery', expect.anything());
  });

  it.each([
    ['queue_operating_delivery', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['apply_operating_suppression', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.dismissObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['persist_operating_objective_draft', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.persistObjectiveDrafts('tenant-1', [{
        tenantId: 'tenant-1', kind: 'confirm_booking', title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
        evidence: { bookingId: 'reservation-1' }, affectedRecordIds: ['reservation-1'], amountAtRisk: 25000,
        expiresAt: '2026-08-22T12:00:00.000Z', dedupeKey: 'confirm_booking:reservation-1', sourceFingerprint: 'v1:booking-1',
        status: 'active', score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
      }])],
  ] as const)('accepts the one-row PostgREST array returned by %s', async (_rpcName, invoke) => {
    const { service } = makeService();

    await expect(invoke(service)).resolves.toBeDefined();
  });

  it.each([
    ['queue_operating_delivery', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['apply_operating_suppression', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.dismissObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['persist_operating_objective_draft', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.persistObjectiveDrafts('tenant-1', [{
        tenantId: 'tenant-1', kind: 'confirm_booking', title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
        evidence: { bookingId: 'reservation-1' }, affectedRecordIds: ['reservation-1'], amountAtRisk: 25000,
        expiresAt: '2026-08-22T12:00:00.000Z', dedupeKey: 'confirm_booking:reservation-1', sourceFingerprint: 'v1:booking-1',
        status: 'active', score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
      }])],
  ] as const)('rejects an empty PostgREST array returned by %s', async (rpcName, invoke) => {
    const { service, rpc } = makeService();
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === rpcName ? [] : null, error: null }));

    await expect(invoke(service)).rejects.toMatchObject({ code: 'database_error' });
  });

  it.each([
    ['queue_operating_delivery', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['apply_operating_suppression', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.dismissObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' })],
    ['persist_operating_objective_draft', (service: ReturnType<typeof createOperatingLoopService>) =>
      service.persistObjectiveDrafts('tenant-1', [{
        tenantId: 'tenant-1', kind: 'confirm_booking', title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
        evidence: { bookingId: 'reservation-1' }, affectedRecordIds: ['reservation-1'], amountAtRisk: 25000,
        expiresAt: '2026-08-22T12:00:00.000Z', dedupeKey: 'confirm_booking:reservation-1', sourceFingerprint: 'v1:booking-1',
        status: 'active', score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
      }])],
  ] as const)('rejects multiple PostgREST rows returned by %s', async (rpcName, invoke) => {
    const { service, rpc } = makeService();
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === rpcName ? [{}, {}] : null, error: null }));

    await expect(invoke(service)).rejects.toMatchObject({ code: 'database_error' });
  });

  it('fails closed before the transaction RPC when policy JSON contains an unknown executable field', async () => {
    const { service, rpc } = makeService(baseTables({
      automation_policies: [activePolicy({ eligibility_rules: { maxAmountAtRisk: 50000, allowAll: true } })],
    }));

    await expect(service.executeObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1' }))
      .rejects.toMatchObject({ code: 'forbidden' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes an exact future defer time to the atomic suppression RPC', async () => {
    const { service, rpc } = makeService();

    await service.deferObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1', scheduledFor: '2026-08-22T11:00:00.000Z' });

    expect(rpc).toHaveBeenCalledWith('apply_operating_suppression', {
      p_tenant_id: 'tenant-1', p_actor_id: 'owner-1', p_objective_id: 'objective-1',
      p_mode: 'defer', p_scheduled_for: '2026-08-22T11:00:00.000Z', p_reason: null,
    });
  });

  it('creates a permanent dismissal request tied to the objective source version', async () => {
    const { service, rpc } = makeService();

    await service.dismissObjective({ tenantId: 'tenant-1', actorId: 'owner-1', objectiveId: 'objective-1', reason: 'Already called' });

    expect(rpc).toHaveBeenCalledWith('apply_operating_suppression', expect.objectContaining({
      p_mode: 'dismiss', p_scheduled_for: null, p_reason: 'Already called',
    }));
  });

  it('uses one database RPC to atomically suppress an identical source draft before it can be recreated', async () => {
    const { service, rpc } = makeService(baseTables({ operating_objectives: [] }));
    const draft: OperatingObjectiveDraft = {
      tenantId: 'tenant-1', kind: 'confirm_booking', title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
      evidence: { bookingId: 'reservation-1' }, affectedRecordIds: ['reservation-1'], amountAtRisk: 25000,
      expiresAt: '2026-08-22T12:00:00.000Z', dedupeKey: 'confirm_booking:reservation-1', sourceFingerprint: 'v1:booking-1',
      status: 'active', score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
    };

    await expect(service.persistObjectiveDrafts('tenant-1', [draft])).resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledWith('persist_operating_objective_draft', expect.objectContaining({
      p_tenant_id: 'tenant-1', p_dedupe_key: 'confirm_booking:reservation-1',
      p_source_fingerprint: 'v1:booking-1', p_status: 'active',
    }));
  });

  it('returns a newly persisted draft when the atomic RPC confirms a changed source is not suppressed', async () => {
    const { service, rpc } = makeService(baseTables({ operating_objectives: [] }));
    rpc.mockImplementationOnce((name: string) => {
      if (name === 'persist_operating_objective_draft') {
        return Promise.resolve({ data: [{ outcome: 'inserted', objective: objective({ source_fingerprint: 'v1:changed' }) }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    const draft: OperatingObjectiveDraft = {
      tenantId: 'tenant-1', kind: 'confirm_booking', title: 'Confirm Ada booking', explanation: 'Ada needs to confirm.',
      evidence: { bookingId: 'reservation-1' }, affectedRecordIds: ['reservation-1'], amountAtRisk: 60000,
      expiresAt: '2026-08-22T12:00:00.000Z', dedupeKey: 'confirm_booking:reservation-1', sourceFingerprint: 'v1:changed',
      status: 'active', score: { customerUrgency: 0, revenueRisk: 90, growthValue: 0, deadline: 100, total: 500 },
    };

    await expect(service.persistObjectiveDrafts('tenant-1', [draft]))
      .resolves.toEqual([expect.objectContaining({ source_fingerprint: 'v1:changed' })]);
    expect(rpc).toHaveBeenCalledWith('persist_operating_objective_draft', expect.objectContaining({
      p_source_fingerprint: 'v1:changed',
    }));
  });

  it('reads durable automation pause from tenant settings rather than the daily loop state', async () => {
    const { service } = makeService(baseTables({
      operating_loop_state: [{ tenant_id: 'tenant-1', operating_date: '2026-08-22', state: 'clear', automation_paused: false, supporting_signals: [] }],
      operating_loop_settings: [{ tenant_id: 'tenant-1', automation_paused: true }],
    }));

    await expect(service.getLoop('tenant-1')).resolves.toEqual(expect.objectContaining({ automationPaused: true }));
  });

  it('reports clear rather than active when the saved state has no fresh active objective', async () => {
    const { service } = makeService(baseTables({
      operating_objectives: [objective({ status: 'queued' })],
      operating_loop_state: [{ tenant_id: 'tenant-1', operating_date: '2026-08-22', state: 'active', supporting_signals: [] }],
    }));

    await expect(service.getLoop('tenant-1')).resolves.toEqual(expect.objectContaining({
      state: 'clear',
      primaryObjective: null,
    }));
  });

  it('reopens a previously clear loop when a fresh urgent objective is active', async () => {
    const { service } = makeService(baseTables({
      operating_loop_state: [{ tenant_id: 'tenant-1', operating_date: '2026-08-22', state: 'clear', supporting_signals: [] }],
      operating_objectives: [objective({ objective_type: 'reply_to_lead', priority_score: 1000 })],
    }));

    await expect(service.getLoop('tenant-1')).resolves.toEqual(expect.objectContaining({
      state: 'active',
      primaryObjective: expect.objectContaining({ id: 'objective-1', kind: 'reply_to_lead' }),
    }));
  });

  it('keeps a tenant in setup when no daily loop state has been created', async () => {
    const { service } = makeService(baseTables({
      operating_objectives: [],
      operating_loop_state: [],
    }));

    await expect(service.getLoop('tenant-1')).resolves.toEqual(expect.objectContaining({
      state: 'setup',
      primaryObjective: null,
    }));
  });

  it('validates policy data before atomically replacing policies and the durable pause', async () => {
    const { service, rpc } = makeService();

    await service.replacePolicies({
      tenantId: 'tenant-1', actorId: 'owner-1', automationPaused: true,
      policies: [{ name: 'Updated confirmations', actionType: 'confirm_booking', status: 'active', eligibilityRules: { maxAmountAtRisk: 75000 }, quietHours: { timezone: 'Africa/Lagos' } }],
    });

    expect(rpc).toHaveBeenCalledWith('replace_operating_policies', expect.objectContaining({
      p_tenant_id: 'tenant-1', p_actor_id: 'owner-1', p_automation_paused: true,
      p_policies: [expect.objectContaining({ name: 'Updated confirmations' })],
    }));
  });
});
