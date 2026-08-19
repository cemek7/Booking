import { loadNumberQuality } from '@/lib/whatsapp/v2/deliverability/numberQuality';

const responses: Array<unknown> = [];

function pushDb(value: unknown) {
  responses.push(value);
}

function makeChain() {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: responses.shift() ?? null, error: null })),
  };

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };

describe('loadNumberQuality', () => {
  beforeEach(() => {
    responses.length = 0;
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'SHARED_PNID';
    from.mockClear();
  });

  it('resolves the shared number id from env and returns its quality row', async () => {
    pushDb({ phone_number_id: 'SHARED_PNID', quality_rating: 'YELLOW', limit_per_24h: 1000 });

    const quality = await loadNumberQuality(admin as never, 'ten_1');

    expect(quality.phoneNumberId).toBe('SHARED_PNID');
    expect(quality.quality).toBe('YELLOW');
    expect(quality.limitPer24h).toBe(1000);
  });

  it('defaults to UNKNOWN + tier-250 limit when no row yet', async () => {
    pushDb(null);

    const quality = await loadNumberQuality(admin as never, 'ten_1');

    expect(quality.quality).toBe('UNKNOWN');
    expect(quality.limitPer24h).toBe(250);
  });
});
