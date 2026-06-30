import { describe, expect, it } from '@jest/globals';
import { ingestMentions } from '@/lib/listening/ingest';
import type { ListeningProvider } from '@/lib/listening/provider';

const config = {
  tenantId: 't1',
  businessName: 'Glow',
  handles: [],
  keywords: [],
  platforms: ['twitter'],
  enabled: true,
  lastPolledAt: null,
};

function makeProvider(mentions: unknown[]): ListeningProvider {
  return {
    name: 'mock',
    async search() {
      return mentions as never;
    },
  };
}

function makeAdmin(existing: string[]) {
  const inserted: unknown[] = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select() { return builder; },
        insert(rows: unknown) {
          if (table === 'social_mentions') inserted.push(...(rows as unknown[]));
          return Promise.resolve({ data: null, error: null });
        },
        update() { return builder; },
        eq() { return builder; },
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          const data = table === 'social_mentions' ? existing.map((value) => ({ external_id: value })) : [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
  return { admin: admin as never, inserted };
}

describe('ingestMentions', () => {
  it('inserts only new mentions (dedup by external_id) and returns them', async () => {
    const provider = makeProvider([
      { externalId: 'a', platform: 'twitter', content: 'love Glow' },
      { externalId: 'b', platform: 'twitter', content: 'Glow is great' },
    ]);
    const { admin, inserted } = makeAdmin(['a']);

    const result = await ingestMentions(admin, config, provider);

    expect(result.map((mention) => mention.externalId)).toEqual(['b']);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      tenant_id: 't1',
      provider: 'mock',
      external_id: 'b',
      platform: 'twitter',
    });
  });

  it('returns [] and inserts nothing when provider finds nothing', async () => {
    const { admin, inserted } = makeAdmin([]);
    const result = await ingestMentions(admin, config, makeProvider([]));
    expect(result).toEqual([]);
    expect(inserted).toHaveLength(0);
  });
});
