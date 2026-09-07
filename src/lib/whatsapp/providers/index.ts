// getProviderClient lives in ./factory so that providerSelection can import it
// without closing the cycle index -> providerSelection -> index. Every existing
// `from '@/lib/whatsapp/providers'` import keeps working through this re-export.
export { getProviderClient } from './factory';
export { getTenantWhatsAppProviderClientUnmetered } from './unmetered';
export { withMetering } from './metered';

export {
  buildDefaultWhatsAppProviderConfig,
  getDefaultWhatsAppProviderClient,
  getTenantWhatsAppProviderClient,
  resolveDefaultWhatsAppProvider,
} from './providerSelection';

export { getTenantIdByInstanceName } from '@/lib/whatsapp/evolutionClient';
export type { WhatsAppProviderClient, ProviderConfig } from './types';
