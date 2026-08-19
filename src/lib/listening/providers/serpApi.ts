import type { ListeningProvider } from '../provider';
import type { ListeningQuery, RawMention } from '../types';
import { buildGoogleSearchQuery } from './googleProgrammableSearch';

// SerpApi Google Search API. Replaces the discontinued Google Programmable
// Search JSON API (closed to new customers; shutdown 2027-01-01) as the
// low-friction social-listening spike path. Self-serve, documented, supports
// `site:` restriction, `tbs` freshness, and `start` pagination.
//
// Contract confirmed from serpapi.com/search-api (query supports site:/OR/quotes,
// tbs date filters, start pagination). The exact organic_results field mapping
// below should be validated against a live SerpApi key before production; the
// injectable fetch + unit test pin the expected shape.
const SERPAPI_BASE = 'https://serpapi.com/search.json';

const PLATFORM_SITES: Record<string, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com'],
  linkedin: ['linkedin.com'],
  tiktok: ['tiktok.com'],
  twitter: ['twitter.com', 'x.com'],
  x: ['x.com', 'twitter.com'],
};

interface SerpApiProviderOptions {
  apiKey: string;
  resultLimit?: number;
  /** Optional Google locale hints (hl=language, gl=country). */
  hl?: string;
  gl?: string;
  fetchImpl?: typeof fetch;
}

interface SerpApiResponse {
  organic_results?: SerpApiOrganicResult[];
  error?: string;
}

interface SerpApiOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  displayed_link?: string;
  date?: string;
}

export class SerpApiProvider implements ListeningProvider {
  readonly name = 'serpapi';

  private readonly apiKey: string;
  private readonly resultLimit: number;
  private readonly hl?: string;
  private readonly gl?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SerpApiProviderOptions) {
    this.apiKey = options.apiKey;
    this.resultLimit = clampResultLimit(options.resultLimit ?? 10);
    this.hl = options.hl;
    this.gl = options.gl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: ListeningQuery): Promise<RawMention[]> {
    const url = new URL(SERPAPI_BASE);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('api_key', this.apiKey);
    // Reuse the exact site:/OR/"terms" syntax the Google provider builds — the
    // SerpApi google engine accepts the same advanced query operators.
    url.searchParams.set('q', buildGoogleSearchQuery(query));
    url.searchParams.set('num', String(this.resultLimit));
    if (this.hl) url.searchParams.set('hl', this.hl);
    if (this.gl) url.searchParams.set('gl', this.gl);

    const tbs = buildFreshnessTbs(query.since);
    if (tbs) url.searchParams.set('tbs', tbs);

    const response = await this.fetchImpl(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`SerpApi request failed: ${response.status}`);
    }

    const payload = (await response.json()) as SerpApiResponse;
    if (payload.error) {
      throw new Error(`SerpApi error: ${payload.error}`);
    }

    const items = payload.organic_results ?? [];
    return items
      .map((item) => normalizeItem(item, query))
      .filter((item): item is RawMention => item !== null);
  }
}

/**
 * Map a `since` timestamp to Google's `tbs=qdr:` freshness window (the smallest
 * bucket that still covers the elapsed period). Coarser than Google's
 * dateRestrict but adequate for frequent cron polling.
 */
export function buildFreshnessTbs(since?: string): string | undefined {
  if (!since) return undefined;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return undefined;

  const diffMs = Date.now() - sinceMs;
  if (diffMs <= 0) return 'qdr:d';

  const diffDays = Math.max(1, Math.ceil(diffMs / 86_400_000));
  if (diffDays <= 1) return 'qdr:d';
  if (diffDays <= 7) return 'qdr:w';
  if (diffDays <= 31) return 'qdr:m';
  return 'qdr:y';
}

function normalizeItem(item: SerpApiOrganicResult, query: ListeningQuery): RawMention | null {
  const link = item.link?.trim();
  if (!link) return null;

  const title = item.title?.trim() ?? '';
  const snippet = item.snippet?.trim() ?? '';
  const platform = inferPlatform(link, item.displayed_link, query.platforms);
  const content = [title, snippet].filter(Boolean).join(' — ') || undefined;

  return {
    externalId: link,
    platform,
    author: inferAuthor(link),
    url: link,
    content,
    matchedTerm: findMatchedTerm([title, snippet, link].join(' '), query),
    raw: item as Record<string, unknown>,
  };
}

function inferPlatform(link: string, displayedLink: string | undefined, configuredPlatforms: string[]): string {
  const haystack = `${link} ${displayedLink ?? ''}`.toLowerCase();
  for (const platform of configuredPlatforms) {
    const candidates = PLATFORM_SITES[platform.toLowerCase()] ?? [];
    if (candidates.some((candidate) => haystack.includes(candidate))) {
      return platform.toLowerCase();
    }
  }
  for (const [platform, candidates] of Object.entries(PLATFORM_SITES)) {
    if (candidates.some((candidate) => haystack.includes(candidate))) {
      return platform;
    }
  }
  return 'web';
}

function inferAuthor(link: string): string | undefined {
  try {
    const url = new URL(link);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;
    const first = segments[0];
    if (['p', 'reel', 'tv', 'posts', 'status', 'watch', 'hashtag', 'search'].includes(first.toLowerCase())) {
      return undefined;
    }
    return first.startsWith('@') ? first : `@${first}`;
  } catch {
    return undefined;
  }
}

function findMatchedTerm(haystack: string, query: ListeningQuery): string | undefined {
  const lower = haystack.toLowerCase();
  const candidates = uniqueTerms([query.businessName, ...query.handles, ...query.keywords]);
  return candidates.find((candidate) => lower.includes(candidate.toLowerCase()));
}

function uniqueTerms(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clampResultLimit(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(100, Math.trunc(value)));
}
