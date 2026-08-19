import type { SupabaseClient } from '@supabase/supabase-js';
import type { ListeningProvider } from './provider';
import type { RawMention, TenantListeningConfig } from './types';
import { buildListeningQuery } from './query';

export async function ingestMentions(
  admin: SupabaseClient,
  config: TenantListeningConfig,
  provider: ListeningProvider,
): Promise<RawMention[]> {
  const found = await provider.search(buildListeningQuery(config));
  if (found.length === 0) {
    await touchLastPolled(admin, config.tenantId);
    return [];
  }

  const { data: existingRows, error } = await admin
    .from('social_mentions')
    .select('external_id')
    .eq('tenant_id', config.tenantId)
    .eq('provider', provider.name);

  if (error) {
    throw error;
  }

  const existing = new Set(
    ((existingRows ?? []) as Array<{ external_id: string }>).map((row) => row.external_id)
  );

  const fresh = found.filter((mention) => !existing.has(mention.externalId));

  if (fresh.length > 0) {
    const { error: insertError } = await admin.from('social_mentions').insert(
      fresh.map((mention) => ({
        tenant_id: config.tenantId,
        provider: provider.name,
        external_id: mention.externalId,
        platform: mention.platform,
        author: mention.author ?? null,
        url: mention.url ?? null,
        content: mention.content ?? null,
        matched_term: mention.matchedTerm ?? null,
        raw: mention.raw ?? null,
      }))
    );
    if (insertError) {
      throw insertError;
    }
  }

  await touchLastPolled(admin, config.tenantId);
  return fresh;
}

async function touchLastPolled(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { error } = await admin
    .from('tenant_listening_config')
    .update({ last_polled_at: new Date().toISOString() })
    .eq('tenant_id', tenantId);
  if (error) {
    throw error;
  }
}
