import type { ListeningQuery, TenantListeningConfig } from './types';

export function buildListeningQuery(config: TenantListeningConfig): ListeningQuery {
  return {
    businessName: config.businessName,
    handles: config.handles,
    keywords: config.keywords,
    platforms: config.platforms,
    ...(config.lastPolledAt ? { since: config.lastPolledAt } : {}),
  };
}
