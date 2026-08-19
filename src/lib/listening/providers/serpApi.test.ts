import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildFreshnessTbs, SerpApiProvider } from '@/lib/listening/providers/serpApi';

const query = {
  businessName: 'Glow Salon',
  handles: ['@glow'],
  keywords: ['lagos salon'],
  platforms: ['instagram', 'linkedin'],
  since: '2026-07-01T00:00:00.000Z',
};

describe('buildFreshnessTbs', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-02T00:00:00.000Z'));
  });

  it('returns a day-level freshness window for recent since', () => {
    expect(buildFreshnessTbs('2026-07-01T00:00:00.000Z')).toBe('qdr:d');
  });

  it('widens the window as since gets older', () => {
    expect(buildFreshnessTbs('2026-06-20T00:00:00.000Z')).toBe('qdr:m');
    expect(buildFreshnessTbs('2025-06-20T00:00:00.000Z')).toBe('qdr:y');
  });

  it('returns undefined for missing or invalid timestamps', () => {
    expect(buildFreshnessTbs(undefined)).toBeUndefined();
    expect(buildFreshnessTbs('bad-date')).toBeUndefined();
  });
});

describe('SerpApiProvider', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  it('maps SerpApi organic_results into RawMention rows and sends google engine params', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        organic_results: [
          {
            position: 1,
            link: 'https://www.instagram.com/glowsalon/p/abc123/',
            title: 'Glow Salon on Instagram',
            snippet: 'Glow Salon Lagos is trending',
            displayed_link: 'www.instagram.com › glowsalon',
          },
        ],
      }),
    } as Response);

    const provider = new SerpApiProvider({ apiKey: 'sk', resultLimit: 5, fetchImpl });
    const mentions = await provider.search(query);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calledUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(calledUrl.origin + calledUrl.pathname).toBe('https://serpapi.com/search.json');
    expect(calledUrl.searchParams.get('engine')).toBe('google');
    expect(calledUrl.searchParams.get('api_key')).toBe('sk');
    expect(calledUrl.searchParams.get('num')).toBe('5');
    expect(calledUrl.searchParams.get('q')).toContain('site:instagram.com');
    expect(calledUrl.searchParams.get('tbs')).toMatch(/^qdr:/);

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

  it('throws on SerpApi error payloads and non-2xx responses', async () => {
    const errorProvider = new SerpApiProvider({
      apiKey: 'sk',
      fetchImpl: jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({ error: 'Invalid API key' }),
      } as Response),
    });
    await expect(errorProvider.search(query)).rejects.toThrow('SerpApi error: Invalid API key');

    const httpProvider = new SerpApiProvider({
      apiKey: 'sk',
      fetchImpl: jest.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 429 } as Response),
    });
    await expect(httpProvider.search(query)).rejects.toThrow('SerpApi request failed: 429');
  });
});
