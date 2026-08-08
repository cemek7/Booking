import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { decryptMetaCredential, encryptMetaCredential } from './metaCredentialCrypto';

export type WhatsAppProvider = 'evolution' | 'waha' | 'meta';

export function isProviderCredentialExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= now;
}

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
    .select('api_key, encrypted_api_key, encryption_iv, encryption_key_version, revoked_at, token_expires_at')
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

  if (data?.revoked_at) return '';
  if (isProviderCredentialExpired(data?.token_expires_at)) {
    defaultLogger.warn('[whatsapp/providerSecrets] Provider credential has expired', {
      tenantId,
      provider: normalizedProvider,
    });
    return '';
  }
  if (data?.encrypted_api_key && data.encryption_iv && data.encryption_key_version) {
    try {
      return decryptMetaCredential({
        encryptedApiKey: data.encrypted_api_key,
        encryptionIv: data.encryption_iv,
        encryptionKeyVersion: data.encryption_key_version,
      });
    } catch (error) {
      defaultLogger.error('[whatsapp/providerSecrets] Failed to decrypt provider credential', {
        tenantId,
        provider: normalizedProvider,
        error: error instanceof Error ? error.message : String(error),
      });
      return '';
    }
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

  const secretPayload = normalizedProvider === 'meta'
    ? (() => {
        const encrypted = encryptMetaCredential(apiKey);
        return {
          api_key: null,
          encrypted_api_key: encrypted.encryptedApiKey,
          encryption_iv: encrypted.encryptionIv,
          encryption_key_version: encrypted.encryptionKeyVersion,
          revoked_at: null,
        };
      })()
    : {
        api_key: apiKey,
        encrypted_api_key: null,
        encryption_iv: null,
        encryption_key_version: null,
        revoked_at: null,
      };

  const { error } = await supabase
    .from('whatsapp_provider_secrets')
    .upsert(
      {
        tenant_id: tenantId,
        provider: normalizedProvider,
        ...secretPayload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,provider' }
    );

  if (error) throw error;
}
