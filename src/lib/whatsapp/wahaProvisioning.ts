import { defaultLogger } from '@/lib/logger';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getStoredProviderApiKey, upsertStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';

export type WahaRuntimeConfig = { baseUrl: string; apiKey: string };
type WahaEndpointMapValue = string | { baseUrl?: string; apiKey?: string };
type ExistingConfig = Record<string, unknown> | null;
type WahaConfigRow = { tenant_id: string; provider_base_url: string | null };

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isAllowedWahaBaseUrl(baseUrl: string): boolean {
  const allowed = (process.env.WAHA_ALLOWED_BASE_HOSTS ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  try {
    const host = new URL(baseUrl).host.toLowerCase();
    return allowed.includes(host);
  } catch {
    return false;
  }
}

export function buildProviderWebhookUrl(baseWebhookUrl: string, provider: 'evolution' | 'waha' | 'meta', tenantId: string): string {
  const url = new URL(baseWebhookUrl);
  const cleanedPath = url.pathname.replace(/\/+$/, '');
  const normalizedWebhookBase = cleanedPath.replace(
    /\/api\/webhooks\/(?:whatsapp|evolution)(?:\/[^/]+)?$/,
    '/api/webhooks/whatsapp'
  );

  void provider;
  url.pathname = `${normalizedWebhookBase}/${tenantId}`;
  url.search = '';
  return url.toString();
}

function parseWahaEndpointMap(): Record<string, WahaEndpointMapValue> {
  const raw = process.env.WAHA_TENANT_ENDPOINTS_JSON;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, WahaEndpointMapValue>;
  } catch {
    return {};
  }
}

function resolveMappedWahaConfig(tenantId: string): WahaRuntimeConfig | null {
  const map = parseWahaEndpointMap();
  const selected = map[tenantId] ?? map.default;
  if (!selected) return null;

  if (typeof selected === 'string') {
    return { baseUrl: normalizeBaseUrl(selected), apiKey: process.env.WAHA_API_KEY || '' };
  }

  if (selected && typeof selected === 'object' && typeof selected.baseUrl === 'string') {
    return {
      baseUrl: normalizeBaseUrl(selected.baseUrl),
      apiKey: selected.apiKey ?? process.env.WAHA_API_KEY ?? '',
    };
  }

  return null;
}

function parseWahaPool(): WahaRuntimeConfig[] {
  const raw = process.env.WAHA_CORE_ENDPOINT_POOL_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: WahaRuntimeConfig[] = [];
    for (const item of parsed) {
      if (typeof item === 'string') {
        out.push({ baseUrl: normalizeBaseUrl(item), apiKey: process.env.WAHA_API_KEY || '' });
        continue;
      }
      if (item && typeof item === 'object' && typeof item.baseUrl === 'string') {
        out.push({
          baseUrl: normalizeBaseUrl(item.baseUrl),
          apiKey: typeof item.apiKey === 'string' ? item.apiKey : (process.env.WAHA_API_KEY || ''),
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function pickFromPool(
  supabase: SupabaseClient,
  tenantId: string
): Promise<WahaRuntimeConfig | null> {
  const pool = parseWahaPool().filter((x) => x.baseUrl && x.apiKey);
  if (pool.length === 0) return null;

  const { data, error } = await supabase
    .from('whatsapp_configurations')
    .select('tenant_id, provider_base_url')
    .eq('provider', 'waha')
    .eq('active', true);

  if (error) throw error;

  const usedByOtherTenants = new Set(
    (data ?? [])
      .filter((row: WahaConfigRow) => row.tenant_id !== tenantId)
      .map((row: WahaConfigRow) => normalizeBaseUrl(String(row.provider_base_url || '')))
      .filter(Boolean)
  );

  const free = pool.find((p) => !usedByOtherTenants.has(p.baseUrl));
  return free ?? null;
}

async function requestWebhookProvisioning(
  tenantId: string,
  tenantName?: string
): Promise<WahaRuntimeConfig | null> {
  const endpoint = process.env.WAHA_PROVISIONER_WEBHOOK_URL;
  if (!endpoint) return null;

  const token = process.env.WAHA_PROVISIONER_TOKEN || '';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      action: 'provision_waha_core',
      tenantId,
      tenantName: tenantName ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WAHA provisioner failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!data || typeof data !== 'object') return null;

  const baseUrl = typeof data.baseUrl === 'string' ? normalizeBaseUrl(data.baseUrl) : '';
  const apiKey = typeof data.apiKey === 'string' ? data.apiKey : '';
  if (!baseUrl || !apiKey) {
    throw new Error('WAHA provisioner response missing baseUrl/apiKey');
  }
  return { baseUrl, apiKey };
}

async function resolveProvisionedWahaConfig(
  supabase: SupabaseClient,
  tenantId: string,
  tenantName?: string
): Promise<WahaRuntimeConfig> {
  const mapped = resolveMappedWahaConfig(tenantId);
  if (mapped?.baseUrl && mapped?.apiKey) return mapped;

  const provisioned = await requestWebhookProvisioning(tenantId, tenantName);
  if (provisioned) return provisioned;

  const pool = await pickFromPool(supabase, tenantId);
  if (pool?.baseUrl && pool?.apiKey) return pool;

  const fallbackBaseUrl = normalizeBaseUrl(process.env.WAHA_API_BASE || '');
  const fallbackApiKey = process.env.WAHA_API_KEY || '';
  if (!fallbackBaseUrl || !fallbackApiKey) {
    throw new Error('No WAHA endpoint/key available (set mapping, provisioner, pool, or WAHA_API_BASE/WAHA_API_KEY)');
  }

  const { data: used } = await supabase
    .from('whatsapp_configurations')
    .select('tenant_id')
    .eq('provider', 'waha')
    .eq('provider_base_url', fallbackBaseUrl)
    .eq('active', true)
    .limit(1);

  const allowShared = process.env.WAHA_ALLOW_SHARED_ENDPOINTS === 'true';
  const isInUseByAnother = !!(used && used.length > 0 && used[0]?.tenant_id !== tenantId);
  if (isInUseByAnother && !allowShared) {
    throw new Error('Fallback WAHA endpoint already assigned to another active tenant');
  }

  return { baseUrl: fallbackBaseUrl, apiKey: fallbackApiKey };
}

export function resolveWahaRuntimeConfig(
  tenantId: string,
  existingConfig: ExistingConfig,
  existingApiKey: string,
  fallbackBaseUrl: string,
  fallbackApiKey: string
): WahaRuntimeConfig {
  if (existingConfig?.provider === 'waha') {
    const existingBase = typeof existingConfig.provider_base_url === 'string'
      ? normalizeBaseUrl(existingConfig.provider_base_url)
      : '';
    const existingKey =
      existingApiKey ||
      (typeof existingConfig.provider_api_key === 'string' ? existingConfig.provider_api_key : '');
    if (existingBase && existingKey) {
      return { baseUrl: existingBase, apiKey: existingKey };
    }
  }

  const mapped = resolveMappedWahaConfig(tenantId);
  if (mapped?.baseUrl && mapped?.apiKey) {
    return mapped;
  }

  return { baseUrl: normalizeBaseUrl(fallbackBaseUrl), apiKey: fallbackApiKey };
}

export async function ensureTenantWahaProvisioning(
  supabase: SupabaseClient,
  tenantId: string,
  tenantName?: string
): Promise<void> {
  const autoProvisionEnabled = process.env.WAHA_AUTO_PROVISION_ENABLED !== 'false';
  if (!autoProvisionEnabled) return;

  const { data: existing, error: existingError } = await supabase
    .from('whatsapp_configurations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle();

  if (existingError) throw existingError;

  // Respect explicit non-WAHA provider selection if already configured.
  if (existing?.provider === 'evolution' || existing?.provider === 'meta') return;

  if (existing?.provider === 'waha' && existing.provider_base_url) {
    const existingSecret = await getStoredProviderApiKey(
      supabase,
      tenantId,
      'waha',
      typeof existing.provider_api_key === 'string' ? existing.provider_api_key : ''
    );
    if (existingSecret) return;
  }

  const cfg = await resolveProvisionedWahaConfig(supabase, tenantId, tenantName);
  if (!isAllowedWahaBaseUrl(cfg.baseUrl)) {
    throw new Error('Provisioned WAHA endpoint is not allowlisted');
  }

  const evolutionBase = process.env.EVOLUTION_API_BASE || 'http://localhost:8080';
  const evolutionKey = process.env.EVOLUTION_API_KEY || '';
  const baseWebhookUrl =
    process.env.EVOLUTION_WEBHOOK_URL ||
    `${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
  const webhookUrl = buildProviderWebhookUrl(baseWebhookUrl, 'waha', tenantId);

  const { error: upsertError } = await supabase
    .from('whatsapp_configurations')
    .upsert(
      {
        tenant_id: tenantId,
        provider: 'waha',
        instance_name: 'default',
        provider_base_url: cfg.baseUrl,
        provider_api_key: null,
        evolution_base_url: evolutionBase,
        evolution_api_key: '',
        webhook_url: webhookUrl,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    );

  if (upsertError) throw upsertError;
  await upsertStoredProviderApiKey(supabase, tenantId, 'waha', cfg.apiKey);
  if (evolutionKey) {
    await upsertStoredProviderApiKey(supabase, tenantId, 'evolution', evolutionKey);
  }

  defaultLogger.info('[waha-provisioning] Provisioned WAHA endpoint for tenant', {
    tenantId,
    baseUrl: cfg.baseUrl,
  });
}
