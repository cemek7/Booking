import type { SupabaseClient } from '@supabase/supabase-js';

export async function getTenantSettings(supabase: SupabaseClient, tenantId: string) {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, domain, vertical, plan, timezone, currency, metadata, created_at, updated_at')
    .eq('id', tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!tenant) throw new Error('Tenant not found');

  // Flatten metadata fields into top-level settings for convenience
  const meta = (tenant.metadata ?? {}) as Record<string, unknown>;
  return {
    settings: {
      id: tenant.id,
      name: tenant.name,
      domain: tenant.domain,
      vertical: tenant.vertical,
      plan: tenant.plan,
      timezone: tenant.timezone ?? 'UTC',
      currency: tenant.currency ?? 'USD',
      booking_window_days: meta.booking_window_days ?? 60,
      cancellation_window_hours: meta.cancellation_window_hours ?? 24,
      auto_confirm: meta.auto_confirm ?? false,
      require_phone: meta.require_phone ?? true,
      allow_walkins: meta.allow_walkins ?? true,
      email_notifications: meta.email_notifications ?? true,
      sms_notifications: meta.sms_notifications ?? false,
      whatsapp_notifications: meta.whatsapp_notifications ?? false,
      // Agent config fields
      preferred_language: meta.preferred_language ?? 'en',
      business_hours: meta.business_hours ?? null,
      tone_config: meta.tone_config ?? {},
      capture_leads: meta.capture_leads ?? false,
      follow_up_delay_hours: meta.follow_up_delay_hours ?? 24,
      follow_up_message_template: meta.follow_up_message_template ?? 'Hi {name}, still thinking about booking? We\'d love to help!',
      voice_notes_enabled: meta.voice_notes_enabled ?? false,
      voice_calls_enabled: meta.voice_calls_enabled ?? false,
      voice_stt_provider: meta.voice_stt_provider ?? 'openai',
      voice_tts_provider: meta.voice_tts_provider ?? 'openai',
      voice_character: meta.voice_character ?? 'alloy',
      reply_with_audio: meta.reply_with_audio ?? 'when_user_uses_voice',
    },
  };
}

export async function updateTenantSettings(
  supabase: SupabaseClient,
  tenantId: string,
  data: Record<string, unknown>
) {
  // Split into direct columns vs metadata fields
  const directColumns = ['name', 'domain', 'vertical', 'plan', 'timezone', 'currency'];
  const directUpdates: Record<string, unknown> = {};
  const metaUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (directColumns.includes(key)) {
      directUpdates[key] = value;
    } else {
      metaUpdates[key] = value;
    }
  }

  // Fetch current metadata to merge
  if (Object.keys(metaUpdates).length > 0) {
    const { data: current } = await supabase
      .from('tenants')
      .select('metadata')
      .eq('id', tenantId)
      .maybeSingle();
    directUpdates.metadata = { ...((current?.metadata as object) ?? {}), ...metaUpdates };
  }

  directUpdates.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from('tenants')
    .update(directUpdates)
    .eq('id', tenantId)
    .select('id, name, domain, vertical, plan, timezone, currency, metadata')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('Tenant not found');
  return { updated };
}
