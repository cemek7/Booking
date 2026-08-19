import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Explicit opt-in for business-initiated messaging (templates/reminders).
 * Storage: messaging_consents (migration 111). Senders of business-initiated
 * messages should check hasMessagingConsent() before sending.
 */

export type ConsentChannel = 'whatsapp' | 'sms' | 'email';

export interface ConsentKey {
  tenantId: string;
  recipient: string;
  channel: ConsentChannel;
}

export async function recordMessagingConsent(
  admin: SupabaseClient,
  p: ConsentKey & { source?: string },
): Promise<void> {
  await admin.from('messaging_consents').upsert(
    {
      tenant_id: p.tenantId,
      recipient: p.recipient,
      channel: p.channel,
      source: p.source ?? null,
      consented_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,recipient,channel' },
  );
}

export async function hasMessagingConsent(admin: SupabaseClient, p: ConsentKey): Promise<boolean> {
  const { data } = await admin
    .from('messaging_consents')
    .select('tenant_id')
    .eq('tenant_id', p.tenantId)
    .eq('recipient', p.recipient)
    .eq('channel', p.channel)
    .maybeSingle();
  return Boolean(data);
}

export async function revokeMessagingConsent(admin: SupabaseClient, p: ConsentKey): Promise<void> {
  await admin
    .from('messaging_consents')
    .delete()
    .eq('tenant_id', p.tenantId)
    .eq('recipient', p.recipient)
    .eq('channel', p.channel);
}
