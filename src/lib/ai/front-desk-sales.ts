import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { normalizePhone } from '@/lib/customers/identity';
import { siasOperations } from '@/lib/sias-operations';

const supabaseAdmin = createSupabaseAdminClient();

export async function upsertLeadRecord(input: {
  tenantId: string;
  phone?: string | null;
  name?: string | null;
  intent?: string | null;
  notes?: string | null;
  status?: string | null;
  stage?: string | null;
  source?: string | null;
  followUpAt?: string | null;
}): Promise<{ id: string; status: string | null } | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;

  const { data: existing } = await supabaseAdmin
    .from('leads')
    .select('id, notes, status')
    .eq('tenant_id', input.tenantId)
    .eq('phone', phone)
    .maybeSingle();

  const nextNotes = [existing?.notes, input.notes].filter(Boolean).join('\n').slice(0, 4000);
  const payload = {
    tenant_id: input.tenantId,
    phone,
    name: input.name ?? null,
    intent: input.intent ?? null,
    notes: nextNotes || null,
    status: input.status ?? existing?.status ?? 'new',
    stage: input.stage ?? null,
    qualified_at: input.stage === 'qualified' ? new Date().toISOString() : null,
    source: input.source ?? 'ai_front_desk',
    follow_up_at: input.followUpAt ?? null,
  };

  if (existing?.id) {
    const { data } = await supabaseAdmin
      .from('leads')
      .update({
        ...payload,
        followed_up_at: null,
        last_contacted_at: payload.follow_up_at ? null : new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, status')
      .maybeSingle();
    return data ?? null;
  }

  const { data } = await supabaseAdmin
    .from('leads')
    .insert(payload)
    .select('id, status')
    .maybeSingle();

  return data ?? null;
}

export async function scheduleLeadRecoveryCampaign(input: {
  tenantId: string;
  phone?: string | null;
  customerId?: string | null;
  leadId?: string | null;
  message?: string | null;
  reason?: string | null;
  scheduledFor?: string | null;
}): Promise<string | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;

  const run = await siasOperations.recordCampaignRun({
    tenantId: input.tenantId,
    campaignType: 'lead_recovery',
    action: 'send_reactivation',
    targetPhone: phone,
    targetCustomerId: input.customerId ?? null,
    sourceEvent: 'front_desk.lead_recovery',
    scheduledFor: input.scheduledFor ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    metadata: {
      reason: input.reason ?? 'lead_recovery',
      lead_id: input.leadId ?? null,
      message: input.message ?? null,
    },
  });

  return typeof run?.id === 'string' ? run.id : null;
}
