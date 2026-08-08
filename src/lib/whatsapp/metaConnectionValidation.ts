import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { getStoredProviderApiKey } from './providerSecrets';

export type MetaApiConfig = { apiBase: string };

export type MetaConnectionRow = {
  tenant_id: string;
  meta_waba_id: string | null;
  meta_phone_number_id: string | null;
  meta_connection_source: 'direct' | 'embedded_signup' | null;
};

export type MetaCredentialRevalidationResult = {
  checked: number;
  healthy: number;
  actionRequired: number;
  transientFailures: number;
  failures: Array<{ tenantId: string; reason: string }>;
};

type MetaValidationError = Error & { requiresAction?: boolean };

function validationError(message: string, requiresAction: boolean): MetaValidationError {
  const error = new Error(message) as MetaValidationError;
  error.requiresAction = requiresAction;
  return error;
}

export async function verifyMetaPhone(
  config: MetaApiConfig,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `${config.apiBase}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 15_000 },
  );
  if (!response.ok) {
    throw validationError(
      `Meta phone number validation failed (${response.status})`,
      [400, 401, 403, 404].includes(response.status),
    );
  }
}

/**
 * Prevents a valid token from pairing an arbitrary phone ID with a different
 * WABA. Meta's phone endpoint validates existence/access only; this validates
 * the tenant routing relationship Booka stores.
 */
export async function verifyMetaPhoneBelongsToWaba(
  config: MetaApiConfig,
  wabaId: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetchWithTimeout(
    `${config.apiBase}/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=500`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeoutMs: 15_000 },
  );
  const body = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
  if (!response.ok) {
    throw validationError(
      `Meta WABA phone-number validation failed (${response.status})`,
      [400, 401, 403, 404].includes(response.status),
    );
  }
  if (!body.data?.some((phone) => phone.id === phoneNumberId)) {
    throw validationError('The selected phone number is not part of the supplied WhatsApp Business Account', true);
  }
}

export async function subscribeMetaWaba(
  config: MetaApiConfig,
  wabaId: string,
  accessToken: string,
): Promise<void> {
  const response = await fetchWithTimeout(`${config.apiBase}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({}),
    timeoutMs: 15_000,
  });
  if (!response.ok) throw new Error(`Meta webhook subscription failed (${response.status})`);
}

function safeReason(error: unknown): string {
  return (error instanceof Error ? error.message : 'Meta credential revalidation failed').slice(0, 500);
}

function requiresTenantAction(error: unknown): boolean {
  if (error && typeof error === 'object' && 'requiresAction' in error) {
    return (error as MetaValidationError).requiresAction === true;
  }
  const reason = safeReason(error).toLowerCase();
  return reason.includes('missing its whatsapp business account') || reason.includes('credential is unavailable');
}

/**
 * Rechecks active tenant-owned Meta credentials before they are used by normal
 * traffic. A failed check disables the connection and asks for reconnection;
 * it never falls back to a deployment-wide Meta credential.
 */
export async function revalidateActiveMetaConnections(
  admin: SupabaseClient,
  config: MetaApiConfig,
): Promise<MetaCredentialRevalidationResult> {
  const result: MetaCredentialRevalidationResult = {
    checked: 0, healthy: 0, actionRequired: 0, transientFailures: 0, failures: [],
  };
  const { data, error } = await admin
    .from('whatsapp_configurations')
    .select('tenant_id, meta_waba_id, meta_phone_number_id, meta_connection_source')
    .eq('provider', 'meta')
    .eq('active', true)
    .eq('meta_connection_status', 'connected')
    // The nightly route has a five-minute execution budget. Five concurrent
    // Meta checks with two 15-second requests each can safely cover this batch.
    .limit(100);
  if (error) throw error;

  const validateOne = async (connection: MetaConnectionRow) => {
    result.checked += 1;
    const now = new Date().toISOString();
    try {
      if (!connection.meta_waba_id || !connection.meta_phone_number_id) {
        throw new Error('Meta connection is missing its WhatsApp Business Account or phone-number identifier');
      }
      const token = await getStoredProviderApiKey(admin, connection.tenant_id, 'meta');
      if (!token) throw new Error('Meta credential is unavailable, revoked, expired, or cannot be decrypted');

      await verifyMetaPhone(config, connection.meta_phone_number_id, token);
      await verifyMetaPhoneBelongsToWaba(config, connection.meta_waba_id, connection.meta_phone_number_id, token);

      const { error: configError } = await admin.from('whatsapp_configurations').update({
        meta_last_validated_at: now,
        meta_connection_status: 'connected',
        meta_last_error: null,
        updated_at: now,
      }).eq('tenant_id', connection.tenant_id).eq('provider', 'meta');
      if (configError) throw configError;
      const { error: secretError } = await admin.from('whatsapp_provider_secrets').update({
        last_validated_at: now,
        updated_at: now,
      }).eq('tenant_id', connection.tenant_id).eq('provider', 'meta');
      if (secretError) throw secretError;
      result.healthy += 1;
    } catch (error) {
      const reason = safeReason(error);
      if (requiresTenantAction(error)) {
        await admin.from('whatsapp_configurations').update({
          active: false,
          meta_connection_status: 'action_required',
          meta_last_error: reason,
          updated_at: now,
        }).eq('tenant_id', connection.tenant_id).eq('provider', 'meta');
        await admin.from('tenant_meta_connection_events').insert({
          tenant_id: connection.tenant_id,
          event_type: 'validation_failed',
          connection_source: connection.meta_connection_source === 'embedded_signup' ? 'embedded_signup' : 'direct',
          meta_waba_id: connection.meta_waba_id,
          meta_phone_number_id: connection.meta_phone_number_id,
          metadata: { reason },
        });
        result.actionRequired += 1;
      } else {
        // Avoid disconnecting all tenants during a temporary Meta incident.
        // The next nightly run retries this validation automatically.
        await admin.from('whatsapp_configurations').update({
          meta_last_error: reason,
          updated_at: now,
        }).eq('tenant_id', connection.tenant_id).eq('provider', 'meta');
        result.transientFailures += 1;
      }
      result.failures.push({ tenantId: connection.tenant_id, reason });
    }
  };

  const connections = (data ?? []) as MetaConnectionRow[];
  for (let index = 0; index < connections.length; index += 5) {
    await Promise.all(connections.slice(index, index + 5).map(validateOne));
  }
  return result;
}
