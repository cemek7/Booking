import type { ListeningQuery, RawMention } from './types';

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
