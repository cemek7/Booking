import { InstagramAdapter } from './instagram';
import { buildAdapter } from './unmetered';
import { withMetering } from './metered';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

/**
 * Builds a provider client from a config, metering it when the config names a
 * tenant.
 *
 * The gate is `config.tenantId`, not a list of call sites. Enumerating call
 * sites is what an earlier design did, and it missed the automated AI reply —
 * the highest-volume send path in the product — because that path builds its
 * client here rather than through providerSelection. A config-carried flag
 * meters every present and future tenant send and cannot silently miss a new
 * one. Platform-level sends (anomaly alerts, close reports) build their config
 * with buildDefaultWhatsAppProviderConfig, which has no tenant and therefore no
 * tenantId, so they stay unmetered by construction rather than by memory.
 */
export function getProviderClient(config: ProviderConfig): WhatsAppProviderClient {
  const client = config.provider === 'instagram'
    ? new InstagramAdapter(config)
    : buildAdapter(config);

  if (!config.tenantId) return client;

  return withMetering(client, {
    tenantId: config.tenantId,
    provider: config.provider ?? 'evolution',
    channel: config.provider === 'instagram' ? 'instagram' : 'whatsapp',
  });
}
