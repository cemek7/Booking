import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { OperatingObjectiveDraft, OperatingObjectiveKind } from './types';

const AUTOMATABLE_KINDS = new Set<OperatingObjectiveKind>([
  'confirm_booking',
  'collect_deposit',
  'follow_up',
]);

type QueueWhatsAppMessage = (
  tenantId: string,
  fromNumber: string,
  toNumber: string,
  content: string,
  priority?: 'normal',
  metadata?: Record<string, unknown>,
) => Promise<string | null>;

type ObjectiveRow = {
  id: string;
  tenant_id: string;
  objective_type: OperatingObjectiveKind;
  dedupe_key: string;
  title: string;
  explanation: string;
  evidence: Record<string, unknown> | null;
  affected_record_ids: string[] | null;
  priority_score: number | string;
  amount_at_risk: number | string | null;
  expires_at: string | null;
  status: string;
  created_at?: string;
  updated_at?: string;
};

type PolicyRow = {
  id: string;
  tenant_id: string;
  name: string;
  action_type: 'confirm_booking' | 'collect_deposit' | 'follow_up';
  status: 'draft' | 'active' | 'paused' | 'revoked';
  eligibility_rules: Record<string, unknown> | null;
  quiet_hours: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at?: string;
  updated_at?: string;
};

type LoopStateRow = {
  state: 'setup' | 'active' | 'clear';
  supporting_signals: unknown[] | null;
  automation_paused: boolean;
};

type OutboundPayload = {
  actionType: 'confirm_booking' | 'collect_deposit' | 'follow_up';
  fromNumber: string;
  toNumber: string;
  content: string;
  affectedRecordIds: string[];
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
  actionType: 'confirm_booking' | 'collect_deposit' | 'follow_up';
  status: 'draft' | 'active' | 'paused' | 'revoked';
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
  queueWhatsAppMessage: QueueWhatsAppMessage;
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

function isTruthyEvidenceFlag(evidence: Record<string, unknown>, key: string): boolean {
  return evidence[key] === true || evidence[key] === 'true';
}

function isSensitive(objective: ObjectiveRow): boolean {
  const evidence = objective.evidence ?? {};
  return [
    'sensitive',
    'bespoke',
    'highValue',
    'high_value',
    'complaint',
    'refund',
    'pricingException',
    'pricing_exception',
  ].some((key) => isTruthyEvidenceFlag(evidence, key));
}

function localTime(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

function isWithinQuietHours(quietHours: Record<string, unknown> | null, now: Date): boolean {
  const start = typeof quietHours?.start === 'string' ? quietHours.start : null;
  const end = typeof quietHours?.end === 'string' ? quietHours.end : null;
  if (!start || !end) return false;

  const timezone = typeof quietHours?.timezone === 'string' ? quietHours.timezone : 'Africa/Lagos';
  let current: string;
  try {
    current = localTime(now, timezone);
  } catch {
    return true;
  }

  return start <= end
    ? current >= start && current < end
    : current >= start || current < end;
}

function policyAllows(policy: PolicyRow, objective: ObjectiveRow, now: Date): boolean {
  if (
    policy.status !== 'active' ||
    !policy.approved_by ||
    !policy.approved_at ||
    policy.action_type !== objective.objective_type ||
    isSensitive(objective) ||
    isWithinQuietHours(policy.quiet_hours, now)
  ) {
    return false;
  }

  const rules = policy.eligibility_rules ?? {};
  const amountAtRisk = objective.amount_at_risk == null ? null : Number(objective.amount_at_risk);
  if (amountAtRisk !== null) {
    const maximum = rules.maxAmountAtRisk;
    if (typeof maximum !== 'number' || !Number.isFinite(maximum) || amountAtRisk > maximum) {
      return false;
    }
  }

  const allowedDedupeKeys = rules.allowedDedupeKeys;
  if (Array.isArray(allowedDedupeKeys) && !allowedDedupeKeys.includes(objective.dedupe_key)) {
    return false;
  }

  return true;
}

function bookingMessage(kind: 'confirm_booking' | 'collect_deposit', name: string, startAt: string | null): string {
  const timing = startAt ? ` for ${new Date(startAt).toLocaleString('en-NG')}` : '';
  if (kind === 'collect_deposit') {
    return `Hi ${name}, a deposit is due to secure your booking${timing}. Please reply if you need help.`;
  }
  return `Hi ${name}, please confirm your booking${timing}. Reply YES to confirm or CHANGE to reschedule.`;
}

async function defaultQueueWhatsAppMessage(...args: Parameters<QueueWhatsAppMessage>) {
  const { queueWhatsAppMessage } = await import('@/lib/whatsapp/messageProcessor');
  return queueWhatsAppMessage(...args);
}

export function createOperatingLoopService({
  admin,
  queueWhatsAppMessage,
  now = () => new Date(),
}: OperatingLoopServiceDependencies) {
  async function assertOwner(tenantId: string, actorId: string): Promise<void> {
    const { data, error } = await admin
      .from('tenant_users')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', actorId)
      .eq('role', 'owner')
      .maybeSingle();

    if (error) throwDatabaseError(error);
    if (!data) throw ApiErrorFactory.forbidden('Only the tenant owner may manage the operating loop');
  }

  async function loadObjective(objectiveId: string): Promise<ObjectiveRow> {
    const { data, error } = await admin
      .from('operating_objectives')
      .select('*')
      .eq('id', objectiveId)
      .maybeSingle<ObjectiveRow>();
    return requireData(data, error, 'Operating objective');
  }

  function assertObjectiveTenant(objective: ObjectiveRow, tenantId: string): void {
    if (objective.tenant_id !== tenantId) throw ApiErrorFactory.tenantMismatch();
  }

  function assertFresh(objective: ObjectiveRow, current: Date): void {
    const expiresAt = objective.expires_at ? Date.parse(objective.expires_at) : Number.NaN;
    if (objective.status !== 'active' || !Number.isFinite(expiresAt) || expiresAt <= current.getTime()) {
      throw ApiErrorFactory.conflict('Operating objective is stale or no longer active');
    }
  }

  async function loadLoopState(tenantId: string, current: Date): Promise<LoopStateRow | null> {
    const { data, error } = await admin
      .from('operating_loop_state')
      .select('state, supporting_signals, automation_paused')
      .eq('tenant_id', tenantId)
      .eq('operating_date', current.toISOString().slice(0, 10))
      .maybeSingle<LoopStateRow>();
    if (error) throwDatabaseError(error);
    return data;
  }

  async function loadEligiblePolicy(tenantId: string, objective: ObjectiveRow, current: Date): Promise<PolicyRow> {
    const { data, error } = await admin
      .from('automation_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('action_type', objective.objective_type)
      .eq('status', 'active');
    if (error) throwDatabaseError(error);

    const policy = ((data ?? []) as PolicyRow[]).find((candidate) => policyAllows(candidate, objective, current));
    if (!policy) {
      throw ApiErrorFactory.forbidden('An active owner-approved automation policy is required');
    }
    return policy;
  }

  async function loadTenantFromNumber(tenantId: string): Promise<string> {
    const { data, error } = await admin
      .from('tenants')
      .select('whatsapp_number')
      .eq('id', tenantId)
      .maybeSingle<{ whatsapp_number: string | null }>();
    const tenant = requireData(data, error, 'Tenant');
    if (!tenant.whatsapp_number) {
      throw ApiErrorFactory.conflict('Tenant WhatsApp delivery number is not configured');
    }
    return tenant.whatsapp_number;
  }

  async function buildOutboundPayload(objective: ObjectiveRow): Promise<OutboundPayload> {
    if (!AUTOMATABLE_KINDS.has(objective.objective_type)) {
      throw ApiErrorFactory.forbidden('This objective requires owner approval and cannot be automated');
    }

    const actionType = objective.objective_type as OutboundPayload['actionType'];
    const recordId = objective.affected_record_ids?.[0];
    if (!recordId) throw ApiErrorFactory.conflict('Objective has no delivery target');

    const fromNumber = await loadTenantFromNumber(objective.tenant_id);

    if (actionType === 'confirm_booking' || actionType === 'collect_deposit') {
      const { data, error } = await admin
        .from('reservations')
        .select('customer_name, customer_number, start_at')
        .eq('tenant_id', objective.tenant_id)
        .eq('id', recordId)
        .maybeSingle<{ customer_name: string | null; customer_number: string | null; start_at: string | null }>();
      const reservation = requireData(data, error, 'Reservation');
      if (!reservation.customer_number) throw ApiErrorFactory.conflict('Reservation has no WhatsApp recipient');

      return {
        actionType,
        fromNumber,
        toNumber: reservation.customer_number,
        content: bookingMessage(actionType, reservation.customer_name ?? 'there', reservation.start_at),
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
      actionType,
      fromNumber,
      toNumber: lead.phone,
      content: `Hi ${lead.name ?? 'there'}, just following up. Reply here if you would like help with your booking.`,
      affectedRecordIds: objective.affected_record_ids ?? [],
    };
  }

  async function getLoop(tenantId: string) {
    const current = now();
    const [stateRow, objectivesResult] = await Promise.all([
      loadLoopState(tenantId, current),
      admin
        .from('operating_objectives')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .gt('expires_at', current.toISOString())
        .order('priority_score', { ascending: false }),
    ]);
    if (objectivesResult.error) throwDatabaseError(objectivesResult.error);

    const objectives = (objectivesResult.data ?? []) as ObjectiveRow[];
    const primaryObjective = objectives[0] ? mapObjective(objectives[0]) : null;
    return {
      state: primaryObjective ? 'active' as const : stateRow?.state ?? 'setup' as const,
      primaryObjective,
      supportingSignals: stateRow?.supporting_signals ?? [],
      automationPaused: stateRow?.automation_paused ?? false,
    };
  }

  async function executeObjective(input: ExecuteObjectiveInput) {
    const current = now();
    const objective = await loadObjective(input.objectiveId);
    assertObjectiveTenant(objective, input.tenantId);
    assertFresh(objective, current);
    const proposedPayload = await buildOutboundPayload(objective);

    // These authorization and policy reads deliberately happen immediately
    // before the atomic claim and enqueue boundary.
    await assertOwner(input.tenantId, input.actorId);
    const state = await loadLoopState(input.tenantId, current);
    if (state?.automation_paused) {
      throw ApiErrorFactory.forbidden('Operating-loop automation is paused');
    }
    const policy = await loadEligiblePolicy(input.tenantId, objective, current);

    const claimedResult = await admin
      .from('operating_objectives')
      .update({
        status: 'completed',
        completed_at: current.toISOString(),
        updated_at: current.toISOString(),
      })
      .eq('id', input.objectiveId)
      .eq('tenant_id', input.tenantId)
      .eq('status', 'active')
      .gt('expires_at', current.toISOString())
      .select('*')
      .maybeSingle<ObjectiveRow>();
    if (claimedResult.error) throwDatabaseError(claimedResult.error);
    if (!claimedResult.data) {
      throw ApiErrorFactory.conflict('Operating objective was already handled or expired');
    }

    const actionResult = await admin
      .from('operating_actions')
      .insert({
        tenant_id: input.tenantId,
        objective_id: input.objectiveId,
        policy_id: policy.id,
        action_type: 'execute',
        status: 'proposed',
        actor_id: input.actorId,
        proposed_payload: proposedPayload,
        result_payload: {},
      })
      .select('*')
      .single<{ id: string }>();
    const action = requireData(actionResult.data, actionResult.error, 'Operating action');

    let deliveryReference: string | null = null;
    try {
      deliveryReference = await queueWhatsAppMessage(
        input.tenantId,
        proposedPayload.fromNumber,
        proposedPayload.toNumber,
        proposedPayload.content,
        'normal',
        { objectiveId: input.objectiveId, actionId: action.id, policyId: policy.id },
      );
    } catch {
      deliveryReference = null;
    }

    if (!deliveryReference) {
      await Promise.all([
        admin
          .from('operating_actions')
          .update({ status: 'failed', result_payload: { reason: 'queue_failed' } })
          .eq('id', action.id)
          .eq('tenant_id', input.tenantId),
        admin
          .from('operating_objectives')
          .update({ status: 'failed', updated_at: now().toISOString() })
          .eq('id', input.objectiveId)
          .eq('tenant_id', input.tenantId),
      ]);
      throw ApiErrorFactory.externalServiceError('WhatsApp queue');
    }

    const { error: updateError } = await admin
      .from('operating_actions')
      .update({ status: 'queued', delivery_reference: deliveryReference })
      .eq('id', action.id)
      .eq('tenant_id', input.tenantId);
    if (updateError) throwDatabaseError(updateError);

    return { actionId: action.id, status: 'queued' as const, deliveryReference };
  }

  async function deferObjective(input: DeferObjectiveInput) {
    const current = now();
    const scheduledAt = Date.parse(input.scheduledFor);
    if (!Number.isFinite(scheduledAt) || scheduledAt <= current.getTime()) {
      throw ApiErrorFactory.validationError('scheduledFor must be a future timestamp');
    }

    const objective = await loadObjective(input.objectiveId);
    assertObjectiveTenant(objective, input.tenantId);
    assertFresh(objective, current);
    await assertOwner(input.tenantId, input.actorId);

    const updatedResult = await admin
      .from('operating_objectives')
      .update({ status: 'deferred', updated_at: current.toISOString() })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.objectiveId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle<ObjectiveRow>();
    if (updatedResult.error) throwDatabaseError(updatedResult.error);
    if (!updatedResult.data) throw ApiErrorFactory.conflict('Operating objective was already handled');

    const { data, error } = await admin
      .from('operating_actions')
      .insert({
        tenant_id: input.tenantId,
        objective_id: input.objectiveId,
        action_type: 'defer',
        status: 'deferred',
        actor_id: input.actorId,
        scheduled_for: input.scheduledFor,
        proposed_payload: {},
        result_payload: {},
      })
      .select('*')
      .single();
    return requireData(data, error, 'Operating action');
  }

  async function dismissObjective(input: DismissObjectiveInput) {
    const current = now();
    const objective = await loadObjective(input.objectiveId);
    assertObjectiveTenant(objective, input.tenantId);
    assertFresh(objective, current);
    await assertOwner(input.tenantId, input.actorId);

    const updatedResult = await admin
      .from('operating_objectives')
      .update({ status: 'dismissed', updated_at: current.toISOString() })
      .eq('tenant_id', input.tenantId)
      .eq('id', input.objectiveId)
      .eq('status', 'active')
      .select('*')
      .maybeSingle<ObjectiveRow>();
    if (updatedResult.error) throwDatabaseError(updatedResult.error);
    if (!updatedResult.data) throw ApiErrorFactory.conflict('Operating objective was already handled');

    const reason = input.reason?.trim() || null;
    const { data, error } = await admin
      .from('operating_actions')
      .insert({
        tenant_id: input.tenantId,
        objective_id: input.objectiveId,
        action_type: 'dismiss',
        status: 'dismissed',
        actor_id: input.actorId,
        proposed_payload: {},
        result_payload: { reason },
      })
      .select('*')
      .single();
    return requireData(data, error, 'Operating action');
  }

  async function getPolicies(tenantId: string) {
    const current = now();
    const [state, policiesResult] = await Promise.all([
      loadLoopState(tenantId, current),
      admin
        .from('automation_policies')
        .select('*')
        .eq('tenant_id', tenantId)
        .neq('status', 'revoked')
        .order('created_at', { ascending: true }),
    ]);
    if (policiesResult.error) throwDatabaseError(policiesResult.error);
    return {
      automationPaused: state?.automation_paused ?? false,
      policies: (policiesResult.data ?? []).map((row) => {
        const policy = row as PolicyRow;
        return {
          id: policy.id,
          name: policy.name,
          actionType: policy.action_type,
          status: policy.status,
          eligibilityRules: policy.eligibility_rules ?? {},
          quietHours: policy.quiet_hours ?? {},
          approvedBy: policy.approved_by,
          approvedAt: policy.approved_at,
        };
      }),
    };
  }

  async function replacePolicies(input: ReplacePoliciesInput) {
    const current = now();
    await assertOwner(input.tenantId, input.actorId);

    // Persist the global pause first so concurrent executors observe it before
    // any policy replacement work begins.
    const { error: stateError } = await admin
      .from('operating_loop_state')
      .upsert({
        tenant_id: input.tenantId,
        operating_date: current.toISOString().slice(0, 10),
        automation_paused: input.automationPaused,
        updated_at: current.toISOString(),
      }, { onConflict: 'tenant_id,operating_date' });
    if (stateError) throwDatabaseError(stateError);

    const { error: revokeError } = await admin
      .from('automation_policies')
      .update({ status: 'revoked', updated_at: current.toISOString() })
      .eq('tenant_id', input.tenantId)
      .neq('status', 'revoked');
    if (revokeError) throwDatabaseError(revokeError);

    if (input.policies.length > 0) {
      const rows = input.policies.map((policy) => ({
        tenant_id: input.tenantId,
        name: policy.name.trim(),
        action_type: policy.actionType,
        status: policy.status,
        eligibility_rules: policy.eligibilityRules ?? {},
        quiet_hours: policy.quietHours ?? {},
        approved_by: policy.status === 'active' ? input.actorId : null,
        approved_at: policy.status === 'active' ? current.toISOString() : null,
        updated_at: current.toISOString(),
      }));
      const { error: insertError } = await admin.from('automation_policies').insert(rows);
      if (insertError) throwDatabaseError(insertError);
    }

    return getPolicies(input.tenantId);
  }

  async function persistObjectiveDrafts(tenantId: string, drafts: OperatingObjectiveDraft[]) {
    const persisted: ObjectiveRow[] = [];
    for (const draft of drafts) {
      if (draft.tenantId !== tenantId) throw ApiErrorFactory.tenantMismatch();

      const payload = {
        tenant_id: tenantId,
        objective_type: draft.kind,
        dedupe_key: draft.dedupeKey,
        title: draft.title,
        explanation: draft.explanation,
        evidence: draft.evidence,
        affected_record_ids: draft.affectedRecordIds,
        priority_score: draft.score.total,
        amount_at_risk: draft.amountAtRisk,
        expires_at: draft.expiresAt,
        status: draft.status,
      };
      const { data, error } = await admin
        .from('operating_objectives')
        .insert(payload)
        .select('*')
        .single<ObjectiveRow>();

      if (!error && data) {
        persisted.push(data);
        continue;
      }

      if ((error as { code?: string } | null)?.code !== '23505') throwDatabaseError(error);
      const existingResult = await admin
        .from('operating_objectives')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('dedupe_key', draft.dedupeKey)
        .eq('status', 'active')
        .maybeSingle<ObjectiveRow>();
      persisted.push(requireData(existingResult.data, existingResult.error, 'Operating objective'));
    }
    return persisted;
  }

  return {
    getLoop,
    executeObjective,
    deferObjective,
    dismissObjective,
    getPolicies,
    replacePolicies,
    persistObjectiveDrafts,
  };
}

function createDefaultService() {
  return createOperatingLoopService({
    admin: createSupabaseAdminClient(),
    queueWhatsAppMessage: defaultQueueWhatsAppMessage,
  });
}

export async function getLoop(tenantId: string) {
  return createDefaultService().getLoop(tenantId);
}

export async function executeObjective(input: ExecuteObjectiveInput) {
  return createDefaultService().executeObjective(input);
}

export async function deferObjective(input: DeferObjectiveInput) {
  return createDefaultService().deferObjective(input);
}

export async function dismissObjective(input: DismissObjectiveInput) {
  return createDefaultService().dismissObjective(input);
}

export async function getPolicies(tenantId: string) {
  return createDefaultService().getPolicies(tenantId);
}

export async function replacePolicies(input: ReplacePoliciesInput) {
  return createDefaultService().replacePolicies(input);
}

export async function persistObjectiveDrafts(tenantId: string, drafts: OperatingObjectiveDraft[]) {
  return createDefaultService().persistObjectiveDrafts(tenantId, drafts);
}
