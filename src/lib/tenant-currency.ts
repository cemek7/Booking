import type { SupabaseClient } from '@supabase/supabase-js';

const ISO_4217 = /^[A-Z]{3}$/;

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return ISO_4217.test(normalized) ? normalized : null;
}

/**
 * Resolve tenant currency preference from known settings locations.
 * Falls back to USD when no explicit preference is configured.
 */
export async function getTenantCurrency(
  supabase: SupabaseClient,
  tenantId: string,
  fallback: string = 'USD'
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('settings, metadata')
      .eq('id', tenantId)
      .maybeSingle();

    if (error || !data) return fallback;

    const row = data as {
      settings?: Record<string, unknown> | null;
      metadata?: Record<string, unknown> | null;
    };

    const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const uiSettings =
      metadata.ui_settings && typeof metadata.ui_settings === 'object'
        ? (metadata.ui_settings as Record<string, unknown>)
        : {};

    return (
      normalizeCurrency(settings.defaultCurrency) ||
      normalizeCurrency(settings.currency) ||
      normalizeCurrency(uiSettings.defaultCurrency) ||
      normalizeCurrency(uiSettings.currency) ||
      fallback
    );
  } catch {
    return fallback;
  }
}
