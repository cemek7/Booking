import { getProviderClient } from '@/lib/whatsapp/providers';
import { EvolutionAdapter } from '@/lib/whatsapp/providers/evolution';
import { WahaAdapter } from '@/lib/whatsapp/providers/waha';

describe('getProviderClient', () => {
  const base = { baseUrl: 'http://localhost:8080', apiKey: 'key', instanceName: 'test' };

  it('returns EvolutionAdapter for provider=evolution', () => {
    const client = getProviderClient({ ...base, provider: 'evolution' });
    expect(client).toBeInstanceOf(EvolutionAdapter);
  });

  it('returns WahaAdapter for provider=waha', () => {
    const client = getProviderClient({ ...base, provider: 'waha' });
    expect(client).toBeInstanceOf(WahaAdapter);
  });
});
