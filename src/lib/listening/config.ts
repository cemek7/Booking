import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantListeningConfig } from './types';

interface ListeningConfigRow {
  tenant_id: string;
  business_name: string;
  handles: string[] | null;
  keywords: string[] | null;
  platforms: string[] | null;
  enabled: boolean;
  last_polled_at: string | null;
}

export async function getEnabledListeningConfigs(admin: SupabaseClient): Promise<TenantListeningConfig[]> {
  const { data, error } = await admin.from('tenant_listening_config').select('*').eq('enabled', true);
  if (error) {
    throw error;
  }

  return ((data ?? []) as ListeningConfigRow[]).map((row) => ({
    tenantId: row.tenant_id,
    businessName: row.business_name,
    handles: row.handles ?? [],
    keywords: row.keywords ?? [],
    platforms: row.platforms ?? [],
    enabled: row.enabled,
    lastPolledAt: row.last_polled_at,
  }));
}
