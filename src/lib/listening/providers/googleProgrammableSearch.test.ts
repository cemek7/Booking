import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  buildDateRestrict,
  buildGoogleSearchQuery,
  GoogleProgrammableSearchProvider,
} from '@/lib/listening/providers/googleProgrammableSearch';

const query = {
  businessName: 'Glow Salon',
  handles: ['@glow'],
  keywords: ['lagos salon'],
  platforms: ['instagram', 'linkedin'],
  since: '2026-07-01T00:00:00.000Z',
};

describe('buildGoogleSearchQuery', () => {
  it('combines platform site filters with business terms', () => {
    const built = buildGoogleSearchQuery(query);
    expect(built).toContain('site:instagram.com');
    expect(built).toContain('site:linkedin.com');
    expect(built).toContain('"Glow Salon"');
    expect(built).toContain('"@glow"');
    expect(built).toContain('"lagos salon"');
  });
});

describe('buildDateRestrict', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'));
  });

  it('returns day-level dateRestrict for recent windows', () => {
    expect(buildDateRestrict('2026-07-01T00:00:00.000Z')).toBe('d1');
  });

  it('returns undefined for invalid timestamps', () => {
    expect(buildDateRestrict('bad-date')).toBeUndefined();
  });
});

describe('GoogleProgrammableSearchProvider', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('maps Google results into RawMention rows', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            link: 'https://www.instagram.com/glowsalon/p/abc123/',
            title: 'Glow Salon on Instagram',
            snippet: 'Glow Salon Lagos is trending',
            displayLink: 'www.instagram.com',
          },
        ],
      }),
    } as Response);

    const provider = new GoogleProgrammableSearchProvider({
      apiKey: 'key',
      searchEngineId: 'cx',
      resultLimit: 5,
      fetchImpl,
    });

    const mentions = await provider.search(query);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(calledUrl.searchParams.get('key')).toBe('key');
    expect(calledUrl.searchParams.get('cx')).toBe('cx');
    expect(calledUrl.searchParams.get('num')).toBe('5');
    expect(calledUrl.searchParams.get('sort')).toBe('date');
    expect(mentions).toEqual([
      expect.objectContaining({
        externalId: 'https://www.instagram.com/glowsalon/p/abc123/',
        platform: 'instagram',
        author: '@glowsalon',
        url: 'https://www.instagram.com/glowsalon/p/abc123/',
        matchedTerm: 'Glow Salon',
      }),
    ]);
  });

  it('throws when Google returns a non-2xx response', async () => {
    const provider = new GoogleProgrammableSearchProvider({
      apiKey: 'key',
      searchEngineId: 'cx',
      fetchImpl: jest.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 429 } as Response),
    });

    await expect(provider.search(query)).rejects.toThrow('Google Programmable Search request failed: 429');
  });
});
