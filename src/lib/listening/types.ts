export interface RawMention {
  externalId: string;
  platform: string;
  author?: string;
  url?: string;
  content?: string;
  matchedTerm?: string;
  raw?: Record<string, unknown> | null;
}

export interface ListeningQuery {
  businessName: string;
  handles: string[];
  keywords: string[];
  platforms: string[];
  since?: string;
}

export interface TenantListeningConfig {
  tenantId: string;
  businessName: string;
  handles: string[];
  keywords: string[];
  platforms: string[];
  enabled: boolean;
  lastPolledAt: string | null;
}

export interface SocialMentionRow {
  id: string;
  tenant_id: string;
  provider: string;
  external_id: string;
  platform: string;
  author: string | null;
  url: string | null;
  content: string | null;
  matched_term: string | null;
  status: 'new' | 'engaged' | 'dismissed' | 'converted';
  raw: Record<string, unknown> | null;
  created_at: string;
  ingested_at: string;
}
