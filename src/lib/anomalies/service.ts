import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';

export const ANOMALY_TERMINAL_STATUSES = ['resolved', 'dismissed', 'false_positive'] as const;

export type AnomalyStatus = 'open' | 'investigating' | 'resolved' | 'dismissed' | 'false_positive';

function isTerminalAnomalyStatus(status: AnomalyStatus): status is (typeof ANOMALY_TERMINAL_STATUSES)[number] {
  return (ANOMALY_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface AnomalyFilters {
  status?: string;
  severity?: string;
  domain?: string;
  assignedTo?: string;
  from?: string;
  to?: string;
}

export interface UpdateAnomalyInput {
  assignedTo?: string | null;
  status?: AnomalyStatus;
  resolutionNote?: string | null;
}

export async function listAnomalies(
  admin: SupabaseClient,
  tenantId: string,
  filters: AnomalyFilters
) {
  let query = admin
    .from('business_anomalies')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('last_seen_at', { ascending: false });

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.domain) query = query.eq('domain', filters.domain);
  if (filters.assignedTo) query = query.eq('assigned_to', filters.assignedTo);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getAnomaly(
  admin: SupabaseClient,
  tenantId: string,
  anomalyId: string
) {
  const { data, error } = await admin
    .from('business_anomalies')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', anomalyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw ApiErrorFactory.notFound('Anomaly');
  return data;
}

export async function updateAnomaly(
  admin: SupabaseClient,
  tenantId: string,
  anomalyId: string,
  actorId: string,
  input: UpdateAnomalyInput
) {
  const existing = await getAnomaly(admin, tenantId, anomalyId);
  const nowIso = new Date().toISOString();

  if (
    input.status &&
    isTerminalAnomalyStatus(input.status) &&
    !input.resolutionNote?.trim()
  ) {
    throw ApiErrorFactory.validationError({
      message: 'A resolution note is required when resolving, dismissing, or marking an anomaly as false positive',
    });
  }

  const update: Record<string, unknown> = { updated_at: nowIso };
  if (input.assignedTo !== undefined) {
    update.assigned_to = input.assignedTo;
    update.assigned_at = input.assignedTo ? nowIso : null;
  }

  if (input.status) {
    update.status = input.status;
    if (isTerminalAnomalyStatus(input.status)) {
      update.resolution_note = input.resolutionNote?.trim() ?? null;
      update.resolved_by = actorId;
      update.resolved_at = nowIso;
    } else {
      update.resolution_note = input.resolutionNote?.trim() ?? existing.resolution_note ?? null;
      update.resolved_by = null;
      update.resolved_at = null;
    }
  } else if (input.resolutionNote?.trim()) {
    update.resolution_note = input.resolutionNote.trim();
  }

  const { data, error } = await admin
    .from('business_anomalies')
    .update(update)
    .eq('tenant_id', tenantId)
    .eq('id', anomalyId)
    .select('*')
    .single();

  if (error) throw error;

  const nextStatus = String(data.status ?? existing.status);
  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'user',
    actorId,
    action:
      nextStatus === 'resolved'
        ? BUSINESS_EVENT_ACTIONS.ANOMALY_RESOLVED
        : BUSINESS_EVENT_ACTIONS.ANOMALY_REVIEWED,
    entityType: 'business_anomaly',
    entityId: anomalyId,
    source: 'dashboard',
    before: existing,
    after: data,
    reason: input.resolutionNote?.trim() ?? null,
    metadata: {
      status: nextStatus,
      assigned_to: data.assigned_to ?? null,
    },
  });

  return data;
}
