import { EvolutionAdapter } from './evolution';
import { InstagramAdapter } from './instagram';
import { MetaAdapter } from './meta';
import { WahaAdapter } from './waha';
import type { ProviderConfig, WhatsAppProviderClient } from './types';

export function getProviderClient(config: ProviderConfig): WhatsAppProviderClient {
  if (config.provider === 'waha') return new WahaAdapter(config);
  if (config.provider === 'meta') return new MetaAdapter(config);
  if (config.provider === 'instagram') return new InstagramAdapter(config);
  return new EvolutionAdapter(config);
}

export {
  buildDefaultWhatsAppProviderConfig,
  getDefaultWhatsAppProviderClient,
  getTenantWhatsAppProviderClient,
  resolveDefaultWhatsAppProvider,
} from './providerSelection';

export { getTenantIdByInstanceName } from '@/lib/whatsapp/evolutionClient';
export type { WhatsAppProviderClient, ProviderConfig } from './types';
