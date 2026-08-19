import type { ListeningProvider } from '../provider';
import type { ListeningQuery, RawMention } from '../types';

const GOOGLE_API_BASE = 'https://customsearch.googleapis.com/customsearch/v1';

const PLATFORM_SITES: Record<string, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com'],
  linkedin: ['linkedin.com'],
  tiktok: ['tiktok.com'],
  twitter: ['twitter.com', 'x.com'],
  x: ['x.com', 'twitter.com'],
};

interface GoogleProgrammableSearchProviderOptions {
  apiKey: string;
  searchEngineId: string;
  resultLimit?: number;
  fetchImpl?: typeof fetch;
}

interface GoogleCustomSearchResponse {
  items?: GoogleCustomSearchItem[];
}

interface GoogleCustomSearchItem {
  link?: string;
  title?: string;
  snippet?: string;
  displayLink?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
  };
}

export class GoogleProgrammableSearchProvider implements ListeningProvider {
  readonly name = 'google_pse';

  private readonly apiKey: string;
  private readonly searchEngineId: string;
  private readonly resultLimit: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleProgrammableSearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.searchEngineId = options.searchEngineId;
    this.resultLimit = clampResultLimit(options.resultLimit ?? 10);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: ListeningQuery): Promise<RawMention[]> {
    const url = new URL(GOOGLE_API_BASE);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('cx', this.searchEngineId);
    url.searchParams.set('q', buildGoogleSearchQuery(query));
    url.searchParams.set('num', String(this.resultLimit));
    url.searchParams.set('safe', 'off');
    url.searchParams.set('sort', 'date');

    const dateRestrict = buildDateRestrict(query.since);
    if (dateRestrict) {
      url.searchParams.set('dateRestrict', dateRestrict);
    }

    const response = await this.fetchImpl(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Google Programmable Search request failed: ${response.status}`);
    }

    const payload = (await response.json()) as GoogleCustomSearchResponse;
    const items = payload.items ?? [];

    return items
      .map((item) => normalizeItem(item, query))
      .filter((item): item is RawMention => item !== null);
  }
}

export function buildGoogleSearchQuery(query: ListeningQuery): string {
  const terms = uniqueTerms([
    query.businessName,
    ...query.handles,
    ...query.keywords,
  ]);

  const siteClauses = uniqueTerms(
    query.platforms.flatMap((platform) => PLATFORM_SITES[platform.toLowerCase()] ?? [])
  ).map((host) => `site:${host}`);

  const termClause = terms
    .map((term) => (term.includes(' ') ? `"${term}"` : `"${term}"`))
    .join(' OR ');

  const sites = siteClauses.length > 1 ? `(${siteClauses.join(' OR ')})` : siteClauses[0] ?? '';
  const termsGroup = termClause ? `(${termClause})` : '';

  return [sites, termsGroup].filter(Boolean).join(' ');
}

export function buildDateRestrict(since?: string): string | undefined {
  if (!since) return undefined;
  const sinceMs = Date.parse(since);
  if (Number.isNaN(sinceMs)) return undefined;

  const diffMs = Date.now() - sinceMs;
  if (diffMs <= 0) return 'd1';

  const diffDays = Math.max(1, Math.ceil(diffMs / 86_400_000));
  if (diffDays <= 31) return `d${diffDays}`;
  if (diffDays <= 180) return `w${Math.ceil(diffDays / 7)}`;
  if (diffDays <= 730) return `m${Math.ceil(diffDays / 30)}`;
  return `y${Math.ceil(diffDays / 365)}`;
}

function normalizeItem(item: GoogleCustomSearchItem, query: ListeningQuery): RawMention | null {
  const link = item.link?.trim();
  if (!link) return null;

  const title = item.title?.trim() ?? '';
  const snippet = item.snippet?.trim() ?? '';
  const platform = inferPlatform(link, item.displayLink, query.platforms);
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

function inferPlatform(link: string, displayLink: string | undefined, configuredPlatforms: string[]): string {
  const haystack = `${link} ${displayLink ?? ''}`.toLowerCase();
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
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function clampResultLimit(value: number): number {
  if (!Number.isFinite(value)) return 10;
  return Math.max(1, Math.min(10, Math.trunc(value)));
}
