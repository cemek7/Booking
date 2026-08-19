import type { SupabaseClient } from '@supabase/supabase-js';

/** Email opt-out persistence (table: email_unsubscribes, migration 090). */

export interface EmailUnsubKey {
  tenantId: string;
  recipient: string;
  list: string;
}

/** Record (idempotently) that a recipient has opted out of a list for a tenant. */
export async function recordUnsubscribe(admin: SupabaseClient, key: EmailUnsubKey): Promise<void> {
  await admin.from('email_unsubscribes').upsert(
    {
      tenant_id: key.tenantId,
      recipient: key.recipient,
      list: key.list,
      unsubscribed_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,recipient,list' },
  );
}

/** True if the recipient has opted out of the given list for the tenant. */
export async function isUnsubscribed(admin: SupabaseClient, key: EmailUnsubKey): Promise<boolean> {
  const { data } = await admin
    .from('email_unsubscribes')
    .select('tenant_id')
    .eq('tenant_id', key.tenantId)
    .eq('recipient', key.recipient)
    .eq('list', key.list)
    .maybeSingle();
  return Boolean(data);
}
