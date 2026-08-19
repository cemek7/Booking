import { resolveTemplate } from '@/lib/whatsapp/v2/deliverability/templateRegistry';

const responses: Array<unknown> = [];

function pushDb(value: unknown) {
  responses.push(value);
}

function makeChain() {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => ({ data: responses.shift() ?? null, error: null })),
  };

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };

describe('resolveTemplate', () => {
  beforeEach(() => {
    responses.length = 0;
    from.mockClear();
  });

  it('returns tenant override when present + approved', async () => {
    pushDb({ template_name: 't_tenant', language: 'en_US', param_mapping: [], status: 'approved' });

    const result = await resolveTemplate(admin as never, 'ten_1', 'rebooking_followup', 'en_US');

    expect(result?.name).toBe('t_tenant');
  });

  it('falls back to platform default (tenant_id NULL) when no override', async () => {
    pushDb(null);
    pushDb({ template_name: 't_platform', language: 'en_US', param_mapping: [], status: 'approved' });

    const result = await resolveTemplate(admin as never, 'ten_1', 'rebooking_followup', 'en_US');

    expect(result?.name).toBe('t_platform');
  });

  it('returns null when only a non-approved template exists', async () => {
    pushDb({ template_name: 't', language: 'en_US', param_mapping: [], status: 'pending' });
    pushDb(null);

    const result = await resolveTemplate(admin as never, 'ten_1', 'rebooking_followup', 'en_US');

    expect(result).toBeNull();
  });
});
