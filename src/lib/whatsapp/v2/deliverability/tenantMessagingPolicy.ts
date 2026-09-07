import type { SupabaseClient } from '@supabase/supabase-js';

export interface TenantMessagingPolicy {
  templateMessagingEnabled: boolean;
  paidTemplateConsent: boolean;
}

type SettingsEnvelope = {
  settings?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function policyFrom(source: Record<string, unknown> | null | undefined): TenantMessagingPolicy {
  const channelConfig = source?.channelConfig;
  const whatsapp = channelConfig && typeof channelConfig === 'object'
    ? (channelConfig as Record<string, unknown>).whatsapp
    : null;
  const values = whatsapp && typeof whatsapp === 'object'
    ? whatsapp as Record<string, unknown>
    : {};

  return {
    templateMessagingEnabled: values.templateMessagingEnabled === true,
    paidTemplateConsent: values.paidTemplateConsent === true,
  };
}

/**
 * Reads the owner-controlled template-message policy from the canonical tenant
 * settings location, with the legacy metadata.ui_settings fallback used by the
 * Settings API. Missing or malformed values deliberately fail closed.
 */
export async function loadTenantMessagingPolicy(
  admin: SupabaseClient,
  tenantId: string,
): Promise<TenantMessagingPolicy> {
  const { data, error } = await admin
    .from('tenants')
    .select('settings, metadata')
    .eq('id', tenantId)
    .maybeSingle();

  if (error || !data) {
    return { templateMessagingEnabled: false, paidTemplateConsent: false };
  }

  const row = data as SettingsEnvelope;
  if (row.settings && typeof row.settings === 'object') {
    return policyFrom(row.settings);
  }

  const uiSettings = row.metadata?.ui_settings;
  return policyFrom(uiSettings && typeof uiSettings === 'object'
    ? uiSettings as Record<string, unknown>
    : null);
}
