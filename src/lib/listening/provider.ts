import type { ListeningQuery, RawMention } from './types';
import { GoogleProgrammableSearchProvider } from './providers/googleProgrammableSearch';
import { SerpApiProvider } from './providers/serpApi';

export interface ListeningProvider {
  readonly name: string;
  search(query: ListeningQuery): Promise<RawMention[]>;
}

export const StubProvider: ListeningProvider = {
  name: 'stub',
  async search() {
    return [];
  },
};

export function createListeningProvider(): ListeningProvider {
  const selected = process.env.SOCIAL_LISTENING_PROVIDER?.trim().toLowerCase() ?? 'stub';

  switch (selected) {
    case 'stub':
      return StubProvider;
    case 'google_pse':
      // NOTE: Google Programmable Search JSON API is closed to new customers and
      // shuts down 2027-01-01. Kept for existing keys only; prefer `serpapi`.
      return new GoogleProgrammableSearchProvider({
        apiKey: requireEnv('GOOGLE_PSE_API_KEY'),
        searchEngineId: requireEnv('GOOGLE_PSE_CX'),
        resultLimit: Number.parseInt(process.env.GOOGLE_PSE_RESULT_LIMIT ?? '10', 10),
      });
    case 'serpapi':
      return new SerpApiProvider({
        apiKey: requireEnv('SERPAPI_API_KEY'),
        resultLimit: Number.parseInt(process.env.SERPAPI_RESULT_LIMIT ?? '10', 10),
        hl: process.env.SERPAPI_HL?.trim() || undefined,
        gl: process.env.SERPAPI_GL?.trim() || undefined,
      });
    default:
      throw new Error(`Unsupported SOCIAL_LISTENING_PROVIDER: ${selected}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
