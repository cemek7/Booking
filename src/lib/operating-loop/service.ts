import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { OperatingObjectiveDraft, OperatingObjectiveKind } from './types';

const AUTOMATABLE_KINDS = new Set<OperatingObjectiveKind>([
  'confirm_booking',
  'collect_deposit',
  'follow_up',
]);

type ObjectiveRow = {
  id: string;
  tenant_id: string;
  objective_type: OperatingObjectiveKind;
  dedupe_key: string;
  source_fingerprint: string;
  title: string;
  explanation: string;
  evidence: Record<string, unknown> | null;
  affected_record_ids: string[] | null;
  priority_score: number | string;
  amount_at_risk: number | string | null;
  expires_at: string | null;
  status: string;
};

type PolicyActionType = 'confirm_booking' | 'collect_deposit' | 'follow_up';
type PolicyStatus = 'draft' | 'active' | 'paused' | 'revoked';

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  action_type: PolicyActionType;
  status: PolicyStatus;
  eligibility_rules: Record<string, unknown> | null;
  quiet_hours: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at?: string;
};

type LoopStateRow = {
  state: 'setup' | 'active' | 'clear';
  supporting_signals: unknown[] | null;
};

type SettingsRow = { automation_paused: boolean };

type OperatingDeliveryPayload = {
  actionType: PolicyActionType;
  recipient: string;
  content: string;
  affectedRecordIds: string[];
};

type RpcResult = { action_id?: string; outbox_id?: string; suppression_id?: string };
type PersistDraftRpcResult = {
  outcome: 'suppressed' | 'existing' | 'inserted';
  objective: ObjectiveRow | null;
};

export interface ExecuteObjectiveInput {
  tenantId: string;
  actorId: string;
  objectiveId: string;
}

export interface DeferObjectiveInput extends ExecuteObjectiveInput {
  scheduledFor: string;
}

export interface DismissObjectiveInput extends ExecuteObjectiveInput {
  reason?: string | null;
}

export interface AutomationPolicyInput {
  id?: string;
  name: string;
  actionType: PolicyActionType;
  status: PolicyStatus;
  eligibilityRules?: Record<string, unknown>;
  quietHours?: Record<string, unknown>;
}

export interface ReplacePoliciesInput {
  tenantId: string;
  actorId: string;
  automationPaused: boolean;
  policies: AutomationPolicyInput[];
}

export interface OperatingLoopServiceDependencies {
  admin: SupabaseClient;
  now?: () => Date;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function throwDatabaseError(error: unknown): never {
  throw ApiErrorFactory.databaseError(asError(error));
}

function requireData<T>(data: T | null, error: unknown, resource: string): T {
  if (error) throwDatabaseError(error);
  if (!data) throw ApiErrorFactory.notFound(resource);
  return data;
}

/**
 * PostgreSQL `RETURNS TABLE` functions are exposed by PostgREST as arrays.
 * Mutations must produce exactly one record; accepting none or several makes
 * a transaction outcome ambiguous and risks showing the owner a false result.
 */
function requireExactlyOneRpcRow<T>(data: T[] | null, error: unknown, resource: string): T {
  if (error) throwDatabaseError(error);
  if (!Array.isArray(data) || data.length !== 1) {
    throwDatabaseError(new Error(`${resource} RPC must return exactly one row`));
  }
  return data[0];
}

function mapObjective(row: ObjectiveRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.objective_type,
    title: row.title,
    explanation: row.explanation,
    evidence: row.evidence ?? {},
    affectedRecordIds: row.affected_record_ids ?? [],
    priorityScore: Number(row.priority_score),
    amountAtRisk: row.amount_at_risk == null ? null : Number(row.amount_at_risk),
    expiresAt: row.expires_at,
    status: row.status,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validIanaTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Fail closed: only an explicit monetary cap and valid quiet-hours shape are executable policy data. */
function validatePolicyShape(policy: AutomationPolicyInput): void {
  if (!policy.name.trim() || !AUTOMATABLE_KINDS.has(policy.actionType)) {
    throw ApiErrorFactory.validationError('Invalid automation policy');
  }
  if (!['draft', 'active', 'paused', 'revoked'].includes(policy.status)) {
    throw ApiErrorFactory.validationError('Invalid automation policy status');
  }

  const rules = policy.eligibilityRules ?? {};
  if (!isPlainRecord(rules) || !hasOnlyKeys(rules, ['maxAmountAtRisk'])) {
    throw ApiErrorFactory.validationError('Automation policy eligibility rules are not recognized');
  }
  if ('maxAmountAtRisk' in rules && (
    typeof rules.maxAmountAtRisk !== 'number'
    || !Number.isFinite(rules.maxAmountAtRisk)
    || rules.maxAmountAtRisk < 0
  )) {
    throw ApiErrorFactory.validationError('maxAmountAtRisk must be a non-negative number');
  }

  const quietHours = policy.quietHours ?? {};
  if (!isPlainRecord(quietHours) || !hasOnlyKeys(quietHours, ['start', 'end', 'timezone'])) {
    throw ApiErrorFactory.validationError('Automation policy quiet-hours are not recognized');
  }
  const hasStart = 'start' in quietHours;
  const hasEnd = 'end' in quietHours;
  if (hasStart !== hasEnd || (hasStart && (!validTime(quietHours.start) || !validTime(quietHours.end)))) {
    throw ApiErrorFactory.validationError('Quiet hours require valid start and end times');
  }
  if ('timezone' in quietHours && !validIanaTimezone(quietHours.timezone)) {
    throw ApiErrorFactory.validationError('Quiet-hours timezone must be a valid IANA timezone');
  }
}

function bookingMessage(kind: 'confirm_booking' | 'collect_deposit', name: string, startAt: string | null): string {
  const timing = startAt ? ` for ${new Date(startAt).toLocaleString('en-NG')}` : '';
  return kind === 'collect_deposit'
    ? `Hi ${name}, a deposit is due to secure your booking${timing}. Please reply if you need help.`
    : `Hi ${name}, please confirm your booking${timing}. Reply YES to confirm or CHANGE to reschedule.`;
}

function idempotencyKey(objective: ObjectiveRow, policy: PolicyRow): string {
  return `operating:${objective.tenant_id}:${objective.id}:${policy.id}:${objective.source_fingerprint}`;
}

export function createOperatingLoopService({ admin, now = () => new Date() }: OperatingLoopServiceDependencies) {
  async function loadObjective(objectiveId: string): Promise<ObjectiveRow> {
    const { data, error } = await admin
      .from('operating_objectives')
      .select('*')
      .eq('id', objectiveId)
      .maybeSingle<ObjectiveRow>();
    return requireData(data, error, 'Operating objective');
  }

  async function loadLoopState(tenantId: string, current: Date): Promise<LoopStateRow | null> {
    const { data, error } = await admin
      .from('operating_loop_state')
      .select('state, supporting_signals')
      .eq('tenant_id', tenantId)
      .eq('operating_date', current.toISOString().slice(0, 10))
      .maybeSingle<LoopStateRow>();
    if (error) throwDatabaseError(error);
    return data;
  }

  async function loadSettings(tenantId: string): Promise<SettingsRow | null> {
    const { data, error } = await admin
      .from('operating_loop_settings')
      .select('automation_paused')
      .eq('tenant_id', tenantId)
      .maybeSingle<SettingsRow>();
    if (error) throwDatabaseError(error);
    return data;
  }

  async function loadEligiblePolicy(tenantId: string, objective: ObjectiveRow): Promise<PolicyRow> {
    if (!AUTOMATABLE_KINDS.has(objective.objective_type)) {
      throw ApiErrorFactory.forbidden('This objective requires owner approval and cannot be automated');
    }
    const { data, error } = await admin
      .from('automation_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('action_type', objective.objective_type)
      .eq('status', 'active');
    if (error) throwDatabaseError(error);

    const policy = ((data ?? []) as PolicyRow[]).find((candidate) => {
      try {
        validatePolicyShape({
          name: candidate.name,
          actionType: candidate.action_type,
          status: candidate.status,
          eligibilityRules: candidate.eligibility_rules ?? {},
          quietHours: candidate.quiet_hours ?? {},
        });
        return Boolean(candidate.approved_by && candidate.approved_at);
      } catch {
        return false;
      }
    });
    if (!policy) throw ApiErrorFactory.forbidden('An active owner-approved automation policy is required');
    return policy;
  }

  async function buildDeliveryPayload(objective: ObjectiveRow): Promise<OperatingDeliveryPayload> {
    if (!AUTOMATABLE_KINDS.has(objective.objective_type)) {
      throw ApiErrorFactory.forbidden('This objective requires owner approval and cannot be automated');
    }
    const recordId = objective.affected_record_ids?.[0];
    if (!recordId) throw ApiErrorFactory.conflict('Objective has no delivery target');

    if (objective.objective_type === 'confirm_booking' || objective.objective_type === 'collect_deposit') {
      const { data, error } = await admin
        .from('reservations')
        .select('customer_name, customer_number, start_at')
        .eq('tenant_id', objective.tenant_id)
        .eq('id', recordId)
        .maybeSingle<{ customer_name: string | null; customer_number: string | null; start_at: string | null }>();
      const reservation = requireData(data, error, 'Reservation');
      if (!reservation.customer_number) throw ApiErrorFactory.conflict('Reservation has no WhatsApp recipient');
      return {
        actionType: objective.objective_type,
        recipient: reservation.customer_number,
        content: bookingMessage(objective.objective_type, reservation.customer_name ?? 'there', reservation.start_at),
        affectedRecordIds: objective.affected_record_ids ?? [],
      };
    }

    const { data, error } = await admin
      .from('leads')
      .select('name, phone')
      .eq('tenant_id', objective.tenant_id)
      .eq('id', recordId)
      .maybeSingle<{ name: string | null; phone: string | null }>();
    const lead = requireData(data, error, 'Lead');
    if (!lead.phone) throw ApiErrorFactory.conflict('Follow-up has no WhatsApp recipient');
    return {
      actionType: 'follow_up',
      recipient: lead.phone,
      content: `Hi ${lead.name ?? 'there'}, just following up. Reply here if you would like help with your booking.`,
      affectedRecordIds: objective.affected_record_ids ?? [],
    };
  }

  async function getLoop(tenantId: string) {
    const current = now();
    const [stateRow, settings, objectivesResult] = await Promise.all([
      loadLoopState(tenantId, current),
      loadSettings(tenantId),
      admin.from('operating_objectives').select('*').eq('tenant_id', tenantId).eq('status', 'active')
        .gt('expires_at', current.toISOString()).order('priority_score', { ascending: false }),
    ]);
    if (objectivesResult.error) throwDatabaseError(objectivesResult.error);
    const objectives = (objectivesResult.data ?? []) as ObjectiveRow[];
    return {
      state: objectives[0]
        ? 'active' as const
        : !stateRow || stateRow.state === 'setup'
          ? 'setup' as const
          : 'clear' as const,
      primaryObjective: objectives[0] ? mapObjective(objectives[0]) : null,
      supportingSignals: stateRow?.supporting_signals ?? [],
      automationPaused: settings?.automation_paused ?? false,
    };
  }

  async function executeObjective(input: ExecuteObjectiveInput) {
    const objective = await loadObjective(input.objectiveId);
    if (objective.tenant_id !== input.tenantId) throw ApiErrorFactory.tenantMismatch();
    const policy = await loadEligiblePolicy(input.tenantId, objective);
    const payload = await buildDeliveryPayload(objective);
    const { data, error } = await admin.rpc('queue_operating_delivery', {
      p_tenant_id: input.tenantId,
      p_actor_id: input.actorId,
      p_objective_id: input.objectiveId,
      p_policy_id: policy.id,
      p_payload: payload,
      p_idempotency_key: idempotencyKey(objective, policy),
    });
    const result = requireExactlyOneRpcRow(data as RpcResult[] | null, error, 'Operating delivery');
    if (!result.action_id || !result.outbox_id) throwDatabaseError(new Error('Operating delivery RPC returned an invalid result'));
    return { actionId: result.action_id, outboxId: result.outbox_id, status: 'queued' as const };
  }

  async function applySuppression(
    input: ExecuteObjectiveInput,
    mode: 'defer' | 'dismiss',
    scheduledFor: string | null,
    reason: string | null,
  ) {
    const { data, error } = await admin.rpc('apply_operating_suppression', {
      p_tenant_id: input.tenantId,
      p_actor_id: input.actorId,
      p_objective_id: input.objectiveId,
      p_mode: mode,
      p_scheduled_for: scheduledFor,
      p_reason: reason,
    });
    return requireExactlyOneRpcRow(data as RpcResult[] | null, error, 'Operating objective suppression');
  }

  async function deferObjective(input: DeferObjectiveInput) {
    if (!Number.isFinite(Date.parse(input.scheduledFor)) || Date.parse(input.scheduledFor) <= now().getTime()) {
      throw ApiErrorFactory.validationError('scheduledFor must be a future timestamp');
    }
    return applySuppression(input, 'defer', input.scheduledFor, null);
  }

  async function dismissObjective(input: DismissObjectiveInput) {
    return applySuppression(input, 'dismiss', null, input.reason?.trim() || null);
  }

  async function getPolicies(tenantId: string) {
    const [settings, policiesResult] = await Promise.all([
      loadSettings(tenantId),
      admin.from('automation_policies').select('*').eq('tenant_id', tenantId).neq('status', 'revoked')
        .order('created_at', { ascending: true }),
    ]);
    if (policiesResult.error) throwDatabaseError(policiesResult.error);
    return {
      automationPaused: settings?.automation_paused ?? false,
      policies: ((policiesResult.data ?? []) as PolicyRow[]).map((policy) => ({
        id: policy.id,
        name: policy.name,
        actionType: policy.action_type,
        status: policy.status,
        eligibilityRules: policy.eligibility_rules ?? {},
        quietHours: policy.quiet_hours ?? {},
        approvedBy: policy.approved_by,
        approvedAt: policy.approved_at,
      })),
    };
  }

  async function replacePolicies(input: ReplacePoliciesInput) {
    input.policies.forEach(validatePolicyShape);
    const { error } = await admin.rpc('replace_operating_policies', {
      p_tenant_id: input.tenantId,
      p_actor_id: input.actorId,
      p_automation_paused: input.automationPaused,
      p_policies: input.policies.map((policy) => ({
        name: policy.name.trim(), actionType: policy.actionType, status: policy.status,
        eligibilityRules: policy.eligibilityRules ?? {}, quietHours: policy.quietHours ?? {},
      })),
    });
    if (error) throwDatabaseError(error);
    return getPolicies(input.tenantId);
  }

  async function persistObjectiveDrafts(tenantId: string, drafts: OperatingObjectiveDraft[]) {
    const persisted: ObjectiveRow[] = [];
    for (const draft of drafts) {
      if (draft.tenantId !== tenantId) throw ApiErrorFactory.tenantMismatch();
      const { data, error } = await admin.rpc('persist_operating_objective_draft', {
        p_tenant_id: tenantId,
        p_objective_type: draft.kind,
        p_dedupe_key: draft.dedupeKey,
        p_source_fingerprint: draft.sourceFingerprint,
        p_title: draft.title,
        p_explanation: draft.explanation,
        p_evidence: draft.evidence,
        p_affected_record_ids: draft.affectedRecordIds,
        p_priority_score: draft.score.total,
        p_amount_at_risk: draft.amountAtRisk,
        p_expires_at: draft.expiresAt,
        p_status: draft.status,
      });
      const result = requireExactlyOneRpcRow(data as PersistDraftRpcResult[] | null, error, 'Operating objective draft');
      if (result.outcome === 'suppressed') continue;
      if ((result.outcome !== 'existing' && result.outcome !== 'inserted') || !result.objective) {
        throwDatabaseError(new Error('Operating objective draft RPC returned an invalid result'));
      }
      persisted.push(result.objective);
    }
    return persisted;
  }

  return { getLoop, executeObjective, deferObjective, dismissObjective, getPolicies, replacePolicies, persistObjectiveDrafts };
}

function createDefaultService() {
  return createOperatingLoopService({ admin: createSupabaseAdminClient() });
}

export async function getLoop(tenantId: string) { return createDefaultService().getLoop(tenantId); }
export async function executeObjective(input: ExecuteObjectiveInput) { return createDefaultService().executeObjective(input); }
export async function deferObjective(input: DeferObjectiveInput) { return createDefaultService().deferObjective(input); }
export async function dismissObjective(input: DismissObjectiveInput) { return createDefaultService().dismissObjective(input); }
export async function getPolicies(tenantId: string) { return createDefaultService().getPolicies(tenantId); }
export async function replacePolicies(input: ReplacePoliciesInput) { return createDefaultService().replacePolicies(input); }
export async function persistObjectiveDrafts(tenantId: string, drafts: OperatingObjectiveDraft[]) {
  return createDefaultService().persistObjectiveDrafts(tenantId, drafts);
}
