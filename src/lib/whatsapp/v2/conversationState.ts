/**
 * Conversation State Manager (v2)
 *
 * Manages the v2 flow columns on whatsapp_conversations:
 *   role, current_flow, flow_step, flow_data
 *
 * The existing v1 columns (current_step, context) are never touched.
 * All reads/writes go through the Supabase admin client (service role)
 * so that RLS is bypassed for server-side operations.
 */
import { createSupabaseAdminClient } from '@/lib/supabase/server';

export type ConvRole = 'owner' | 'staff' | 'customer' | 'unknown';
export type ConvFlow = 'idle' | 'onboarding' | 'booking' | 'managing';
export type ConvChannel = 'whatsapp' | 'instagram';

export interface ConvState {
  id: string;
  tenant_id: string;
  /** WhatsApp rows carry the E.164 phone here; Instagram rows are genuinely null. */
  phone_number: string | null;
  external_id: string;
  channel: ConvChannel;
  role: ConvRole;
  current_flow: ConvFlow;
  flow_step: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow_data: Record<string, any>;
  last_inbound_at: string | null;
  opted_out_at: string | null;
}

/** Identity fields (channel, external_id, phone_number) are intentionally excluded —
 *  updateConversation must never change a conversation's identity. */
export type ConvStatePatch = Partial<
  Pick<ConvState, 'role' | 'current_flow' | 'flow_step' | 'flow_data'>
>;

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetches conversation state for a given (externalId, tenantId, channel) triple.
 * Returns null if no conversation row exists (caller should handle first-contact).
 * The `channel` param defaults to `'whatsapp'` so all existing callers compile unchanged.
 */
export async function getConversation(
  externalId: string,
  tenantId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<ConvState | null> {
  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('id, tenant_id, phone_number, external_id, channel, role, current_flow, flow_step, flow_data, last_inbound_at, opted_out_at')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('[conversationState] getConversation error', error);
    return null;
  }

  return (data as ConvState | null) ?? null;
}

// ─── Upsert ───────────────────────────────────────────────────────────────────

/**
 * Creates a new conversation row or returns the existing one.
 * Sets v2 defaults on creation; never overwrites existing v2 data.
 * The `channel` param defaults to `'whatsapp'` so all existing callers compile unchanged.
 *
 * WhatsApp: writes phone_number = externalId, conflicts on (phone_number, tenant_id).
 * Instagram/others: writes phone_number = null, conflicts on (tenant_id, channel, external_id).
 */
export async function ensureConversation(
  externalId: string,
  tenantId: string,
  role: ConvRole = 'unknown',
  channel: ConvChannel = 'whatsapp'
): Promise<ConvState> {
  const supabaseAdmin = createSupabaseAdminClient();
  const isWhatsApp = channel === 'whatsapp';
  const { data, error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .upsert(
      {
        channel,
        external_id: externalId,
        phone_number: isWhatsApp ? externalId : null,
        tenant_id: tenantId,
        role,
        current_flow: 'idle',
        flow_step: 0,
        flow_data: {},
      },
      {
        onConflict: isWhatsApp ? 'phone_number,tenant_id' : 'tenant_id,channel,external_id',
        ignoreDuplicates: true, // don't overwrite existing row
      }
    )
    .select('id, tenant_id, phone_number, external_id, channel, role, current_flow, flow_step, flow_data, last_inbound_at, opted_out_at')
    .single();

  if (error || !data) {
    // Row already existed and ignoreDuplicates skipped the insert — fetch it
    const existing = await getConversation(externalId, tenantId, channel);
    if (!existing) throw new Error(`[conversationState] ensureConversation failed: ${error?.message}`);
    return existing;
  }

  return data as ConvState;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Patches only the v2 columns. Supply only the fields that changed.
 * The `channel` param defaults to `'whatsapp'` so all existing callers compile unchanged.
 */
export async function updateConversation(
  externalId: string,
  tenantId: string,
  patch: ConvStatePatch,
  channel: ConvChannel = 'whatsapp'
): Promise<void> {
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin
    .from('whatsapp_conversations')
    .update(patch)
    .eq('channel', channel)
    .eq('external_id', externalId)
    .eq('tenant_id', tenantId);

  if (error) {
    console.error('[conversationState] updateConversation error', error);
    throw error;
  }
}

// ─── Reset ────────────────────────────────────────────────────────────────────

/**
 * Resets the v2 flow state to idle, preserving role and identity.
 * Used after a booking is confirmed, cancelled, or the user says "stop".
 * The `channel` param defaults to `'whatsapp'` so all existing callers compile unchanged.
 */
export async function resetConversation(
  externalId: string,
  tenantId: string,
  channel: ConvChannel = 'whatsapp'
): Promise<void> {
  await updateConversation(externalId, tenantId, {
    current_flow: 'idle',
    flow_step: 0,
    flow_data: {},
  }, channel);
}
