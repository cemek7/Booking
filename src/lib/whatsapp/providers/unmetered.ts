import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { EvolutionAdapter } from './evolution';
import { MetaAdapter } from './meta';
import { WahaAdapter } from './waha';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

/**
 * Raw adapter construction, with no metering anywhere in it.
 *
 * This module is deliberately a LEAF of the provider graph: it imports the
 * adapters and the config loader and nothing else. That is what breaks the
 * cycle metering would otherwise close —
 *
 *   factory -> metered -> messageHandoff -> unmetered -> adapters
 *
 * The handoff needs an unmetered client (metering it would recurse), and the
 * metering factory needs the handoff. If the unmetered client lived in
 * `providerSelection`, which itself needs the factory, that chain would close
 * on itself. Do not import `metered`, `factory` or `index` from here.
 */
export function buildAdapter(config: ProviderConfig): WhatsAppProviderClient {
  if (config.provider === 'waha') return new WahaAdapter(config);
  if (config.provider === 'meta') return new MetaAdapter(config);
  return new EvolutionAdapter(config);
}

/**
 * Unmetered tenant client. Only two callers are legitimate:
 *   - the wallet-exhausted handoff (metering it would recurse), and
 *   - internal diagnostics.
 * Everything customer-facing must go through getTenantChannelProviderClient.
 */
export async function getTenantWhatsAppProviderClientUnmetered(
  tenantId: string,
): Promise<WhatsAppProviderClient | null> {
  const config = await getTenantWhatsAppConfig(tenantId);
  if (!config) return null;
  return buildAdapter(config);
}
