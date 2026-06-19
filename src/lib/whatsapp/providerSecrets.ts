import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';

export type WhatsAppProvider = 'evolution' | 'waha' | 'meta';

function normalizeProvider(provider: string | null | undefined): WhatsAppProvider {
  if (provider === 'waha') return 'waha';
  if (provider === 'meta') return 'meta';
  return 'evolution';
}

export async function getStoredProviderApiKey(
  supabase: SupabaseClient,
  tenantId: string,
  provider: string | null | undefined,
  legacyApiKey?: string | null
): Promise<string> {
  const normalizedProvider = normalizeProvider(provider);
  const { data, error } = await supabase
    .from('whatsapp_provider_secrets')
    .select('api_key')
    .eq('tenant_id', tenantId)
    .eq('provider', normalizedProvider)
    .maybeSingle();

  if (error) {
    defaultLogger.warn('[whatsapp/providerSecrets] Failed to load secret; using legacy fallback', {
      tenantId,
      provider: normalizedProvider,
      error: error.message,
    });
  }

  const secret = typeof data?.api_key === 'string' ? data.api_key : '';
  if (secret) return secret;
  return typeof legacyApiKey === 'string' ? legacyApiKey : '';
}

export async function upsertStoredProviderApiKey(
  supabase: SupabaseClient,
  tenantId: string,
  provider: string | null | undefined,
  apiKey: string
): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  if (!apiKey) return;

  const { error } = await supabase
    .from('whatsapp_provider_secrets')
    .upsert(
      {
        tenant_id: tenantId,
        provider: normalizedProvider,
        api_key: apiKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,provider' }
    );

  if (error) throw error;
}

