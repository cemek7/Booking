import type { ListeningQuery, RawMention } from './types';
import { GoogleProgrammableSearchProvider } from './providers/googleProgrammableSearch';

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
      return new GoogleProgrammableSearchProvider({
        apiKey: requireEnv('GOOGLE_PSE_API_KEY'),
        searchEngineId: requireEnv('GOOGLE_PSE_CX'),
        resultLimit: Number.parseInt(process.env.GOOGLE_PSE_RESULT_LIMIT ?? '10', 10),
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
