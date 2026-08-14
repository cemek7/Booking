import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { SIAS_CAMPAIGN_ACTIONS, SIAS_OUTCOME_ATRIBUTION } from '@/lib/sias';

type AnyRecord = Record<string, unknown>;

type CampaignStatus = 'pending' | 'processing' | 'sent' | 'completed' | 'retry_scheduled' | 'failed' | 'cancelled';

export type CampaignRunInput = {
  tenantId: string;
  campaignType: string;
  action: (typeof SIAS_CAMPAIGN_ACTIONS)[number] | string;
  targetPhone?: string | null;
  targetCustomerId?: string | null;
  targetBookingId?: string | null;
  sourceEvent?: string | null;
  scheduledFor?: string | Date | null;
  maxAttempts?: number;
  status?: CampaignStatus;
  metadata?: AnyRecord;
  attribution?: AnyRecord;
};

export type AttributionInput = {
  tenantId: string;
  signal: (typeof SIAS_OUTCOME_ATRIBUTION)[number]['id'] | string;
  sourceEvent: string;
  reservationId?: string | null;
  customerId?: string | null;
  customerPhone?: string | null;
  attributedTo?: string | null;
  value?: number;
  windowHours?: number | null;
  campaignRunId?: string | null;
  metadata?: AnyRecord;
};

export type MemoryInput = {
  tenantId: string;
  memoryKey: string;
  memoryValue: AnyRecord;
  source?: string;
  confidence?: number;
  lastSeenAt?: string | Date;
};

export type EscalationInput = {
  tenantId: string;
  customerPhone: string;
  sessionId: string;
  reason: string;
  assignedAgentId?: string | null;
  conversationSnapshot?: unknown[];
  status?: 'pending' | 'claimed' | 'resolved' | 'timed_out';
};

export type EscalationUpdateInput = {
  tenantId: string;
  escalationId: string;
  action: 'claim' | 'resolve';
  agentId?: string | null;
};

function normalizeDate(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

export class SiasOperationsService {
  private supabase: ReturnType<typeof createSupabaseAdminClient>;

  constructor(supabase?: ReturnType<typeof createSupabaseAdminClient>) {
    this.supabase = supabase ?? createSupabaseAdminClient();
  }

  async recordCampaignRun(input: CampaignRunInput) {
    const now = new Date().toISOString();
    const vertical = typeof input.metadata?.vertical === 'string' ? String(input.metadata.vertical) : null;
    const payload = {
      tenant_id: input.tenantId,
      campaign_type: input.campaignType,
      action: input.action,
      target_phone: input.targetPhone ?? null,
      target_customer_id: input.targetCustomerId ?? null,
      target_booking_id: input.targetBookingId ?? null,
      source_event: input.sourceEvent ?? null,
      status: input.status ?? 'pending',
      attempts: 0,
      max_attempts: input.maxAttempts ?? 5,
      scheduled_for: normalizeDate(input.scheduledFor) ?? now,
      metadata: vertical ? { ...(input.metadata ?? {}), vertical } : { ...(input.metadata ?? {}) },
      attribution: input.attribution ?? {},
      updated_at: now,
    };

    const { data, error } = await this.supabase
      .from('sias_campaign_runs')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to record campaign run', { error: error.message, input });
      return null;
    }

    return data ?? null;
  }

  async updateCampaignRun(
    campaignRunId: string,
    updates: Partial<{
      status: CampaignStatus;
      attempts: number;
      nextRetryAt: string | Date | null;
      error: string | null;
      sentAt: string | Date | null;
      completedAt: string | Date | null;
      metadata: AnyRecord;
      attribution: AnyRecord;
    }>
  ) {
    const now = new Date().toISOString();
    const payload: AnyRecord = { updated_at: now };

    if (updates.status) payload.status = updates.status;
    if (typeof updates.attempts === 'number') payload.attempts = updates.attempts;
    if (updates.nextRetryAt !== undefined) payload.next_retry_at = normalizeDate(updates.nextRetryAt);
    if (updates.error !== undefined) payload.error = updates.error;
    if (updates.sentAt !== undefined) payload.sent_at = normalizeDate(updates.sentAt);
    if (updates.completedAt !== undefined) payload.completed_at = normalizeDate(updates.completedAt);
    if (updates.metadata) payload.metadata = updates.metadata;
    if (updates.attribution) payload.attribution = updates.attribution;

    const { data, error } = await this.supabase
      .from('sias_campaign_runs')
      .update(payload)
      .eq('id', campaignRunId)
      .select('*')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to update campaign run', { error: error.message, campaignRunId });
      return null;
    }

    return data ?? null;
  }

  async recordOutcomeAttribution(input: AttributionInput) {
    const payload = {
      tenant_id: input.tenantId,
      reservation_id: input.reservationId ?? null,
      customer_id: input.customerId ?? null,
      customer_phone: input.customerPhone ?? null,
      signal: input.signal,
      source_event: input.sourceEvent,
      attributed_to: input.attributedTo ?? null,
      value: input.value ?? 1,
      window_hours: input.windowHours ?? null,
      campaign_run_id: input.campaignRunId ?? null,
      metadata: input.metadata ?? {},
    };

    const { data, error } = await this.supabase
      .from('sias_outcome_attributions')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to record outcome attribution', { error: error.message, input });
      return null;
    }

    return data ?? null;
  }

  async updateOperationalMemory(input: MemoryInput) {
    const now = new Date().toISOString();
    const payload = {
      tenant_id: input.tenantId,
      memory_key: input.memoryKey,
      memory_value: input.memoryValue,
      source: input.source ?? null,
      confidence: typeof input.confidence === 'number' ? input.confidence : 0.5,
      hit_count: 1,
      last_seen_at: normalizeDate(input.lastSeenAt) ?? now,
      updated_at: now,
    };

    const { data: existing, error: existingError } = await this.supabase
      .from('sias_operational_memory')
      .select('id, hit_count, memory_value')
      .eq('tenant_id', input.tenantId)
      .eq('memory_key', input.memoryKey)
      .maybeSingle();

    if (existingError) {
      defaultLogger.warn('[SIAS] Failed to load operational memory', { error: existingError.message, input });
      return null;
    }

    const nextValue = existing
      ? {
          ...((existing.memory_value ?? {}) as AnyRecord),
          ...input.memoryValue,
        }
      : input.memoryValue;

    const { data, error } = await this.supabase
      .from('sias_operational_memory')
      .upsert({
        ...payload,
        memory_value: nextValue,
        hit_count: existing ? Number(existing.hit_count ?? 0) + 1 : 1,
      }, { onConflict: 'tenant_id,memory_key' })
      .select('*')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to update operational memory', { error: error.message, input });
      return null;
    }

    return data ?? null;
  }

  async createEscalationTicket(input: EscalationInput) {
    const conversationSnapshot = Array.isArray(input.conversationSnapshot) ? input.conversationSnapshot : [];
    const reason = input.reason.trim() || 'unspecified';
    const duplicateWindow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: existing } = await this.supabase
      .from('escalation_queue')
      .select('id, status, reason, created_at')
      .eq('tenant_id', input.tenantId)
      .eq('customer_phone', input.customerPhone)
      .eq('reason', reason)
      .gte('created_at', duplicateWindow)
      .in('status', ['pending', 'claimed'])
      .limit(1)
      .maybeSingle();

    if (existing) {
      return existing;
    }

    const { data, error } = await this.supabase
      .from('escalation_queue')
      .insert({
        tenant_id: input.tenantId,
        customer_phone: input.customerPhone,
        session_id: input.sessionId,
        reason,
        status: input.status ?? 'pending',
        assigned_agent_id: input.assignedAgentId ?? null,
        conversation_snapshot: conversationSnapshot,
      })
      .select('*')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to create escalation ticket', { error: error.message, input });
      return null;
    }

    return data ?? null;
  }

  async updateEscalationTicket(input: EscalationUpdateInput) {
    const updates: Record<string, unknown> =
      input.action === 'claim'
        ? { status: 'claimed', assigned_agent_id: input.agentId ?? null }
        : { status: 'resolved', resolved_at: new Date().toISOString() };

    const { data, error } = await this.supabase
      .from('escalation_queue')
      .update(updates)
      .eq('id', input.escalationId)
      .eq('tenant_id', input.tenantId)
      .select('id, status, assigned_agent_id, resolved_at')
      .maybeSingle();

    if (error) {
      defaultLogger.warn('[SIAS] Failed to update escalation ticket', { error: error.message, input });
      return null;
    }

    return data ?? null;
  }

  async recordBookingMemory(input: {
    tenantId: string;
    reservationId: string;
    customerPhone?: string | null;
    customerName?: string | null;
    serviceId?: string | null;
    serviceName?: string | null;
    sourceEvent: string;
  }) {
    const now = new Date().toISOString();
    await Promise.all([
      this.updateOperationalMemory({
        tenantId: input.tenantId,
        memoryKey: 'last_booking',
        memoryValue: {
          reservation_id: input.reservationId,
          customer_phone: input.customerPhone ?? null,
          customer_name: input.customerName ?? null,
          service_id: input.serviceId ?? null,
          service_name: input.serviceName ?? null,
          recorded_at: now,
        },
        source: input.sourceEvent,
        lastSeenAt: now,
        confidence: 0.9,
      }),
      this.updateOperationalMemory({
        tenantId: input.tenantId,
        memoryKey: 'service_preference',
        memoryValue: {
          service_id: input.serviceId ?? null,
          service_name: input.serviceName ?? null,
          last_seen_at: now,
        },
        source: input.sourceEvent,
        lastSeenAt: now,
        confidence: 0.7,
      }),
    ]);
  }
}

export const siasOperations = new SiasOperationsService();
