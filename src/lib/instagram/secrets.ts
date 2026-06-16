import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';

/**
 * Instagram credential storage.
 *
 * Reuses the service-role-only `whatsapp_provider_secrets` table (provider='instagram').
 * For Instagram rows:
 *   api_key          = long-lived Instagram User access token
 *   base_url         = INSTAGRAM_GRAPH_BASE_URL
 *   instance_name    = Instagram-scoped business account id (the webhook recipient.id)
 *   token_expires_at = long-lived token expiry (refresh before this)
 */

export const INSTAGRAM_GRAPH_BASE_URL = 'https://graph.instagram.com/v25.0';

export interface InstagramSecret {
  accessToken: string;
  /** Instagram-scoped business account id — used in the send URL and recipient→tenant mapping. */
  igId: string;
  tokenExpiresAt: string | null;
}

/** Store (or refresh) a tenant's Instagram credentials. Service-role client required. */
export async function upsertInstagramSecret(
  supabase: SupabaseClient,
  tenantId: string,
  secret: InstagramSecret
): Promise<void> {
  const { error } = await supabase.from('whatsapp_provider_secrets').upsert(
    {
      tenant_id: tenantId,
      provider: 'instagram',
      api_key: secret.accessToken,
      base_url: INSTAGRAM_GRAPH_BASE_URL,
      instance_name: secret.igId,
      token_expires_at: secret.tokenExpiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,provider' }
  );

  if (error) throw error;
}

/**
 * Map an incoming webhook recipient (the tenant's IG business account id) to a tenant.
 * Returns null when no tenant has connected that Instagram account.
 */
export async function findTenantByInstagramId(
  supabase: SupabaseClient,
  igId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('whatsapp_provider_secrets')
    .select('tenant_id')
    .eq('provider', 'instagram')
    .eq('instance_name', igId)
    .maybeSingle();

  if (error) {
    defaultLogger.error('[instagram/secrets] findTenantByInstagramId failed', error);
    return null;
  }
  return (data?.tenant_id as string | undefined) ?? null;
}
