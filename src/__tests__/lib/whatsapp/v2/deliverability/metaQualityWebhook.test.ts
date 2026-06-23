import { ingestQualityWebhook } from '@/lib/whatsapp/v2/deliverability/metaQualityWebhook';

const updates: Array<Record<string, unknown>> = [];
const updateWheres: Array<[string, unknown]> = [];

function makeChain() {
  const chain: Record<string, jest.Mock> = {
    upsert: jest.fn(async (payload: Record<string, unknown>) => {
      updates.push(payload);
      return { error: null };
    }),
    update: jest.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return chain;
    }),
    eq: jest.fn((key: string, value: unknown) => {
      updateWheres.push([key, value]);
      return chain;
    }),
  };

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };

describe('ingestQualityWebhook', () => {
  beforeEach(() => {
    updates.length = 0;
    updateWheres.length = 0;
    from.mockClear();
  });

  it('upserts quality + tier limit for a quality update', async () => {
    await ingestQualityWebhook(admin as never, {
      field: 'phone_number_quality_update',
      value: {
        metadata: { phone_number_id: 'PNID_1' },
        quality_rating: 'YELLOW',
        messaging_limit_tier: 'TIER_1K',
      },
    });

    expect(updates[0]).toMatchObject({
      phone_number_id: 'PNID_1',
      quality_rating: 'YELLOW',
      messaging_tier: 'TIER_1K',
      limit_per_24h: 1000,
    });
  });

  it('does nothing when no phone number id is present', async () => {
    await ingestQualityWebhook(admin as never, {
      field: 'messaging_limits',
      value: { messaging_limit_tier: 'TIER_10K' },
    });

    expect(updates).toHaveLength(0);
  });

  it('updates template status by template name + language', async () => {
    await ingestQualityWebhook(admin as never, {
      field: 'message_template_status_update',
      value: {
        message_template_name: 'rebooking_followup_v1',
        message_template_language: 'en_US',
        message_template_status: 'APPROVED',
      },
    });

    expect(updates[0]).toMatchObject({ status: 'approved' });
    expect(updateWheres).toEqual([
      ['template_name', 'rebooking_followup_v1'],
      ['language', 'en_US'],
    ]);
  });
});
