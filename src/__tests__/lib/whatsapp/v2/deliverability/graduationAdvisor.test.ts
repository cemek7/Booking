jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramAlert: jest.fn().mockResolvedValue(undefined),
}));

import { runGraduationAdvisor } from '@/lib/whatsapp/v2/deliverability/graduationAdvisor';
import { sendTelegramAlert } from '@/lib/monitoring/telegramAlert';

const responses: Array<unknown> = [];
const inserts: Array<Record<string, unknown>> = [];

function pushDb(value: unknown) {
  responses.push(value);
}

function makeChain() {
  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    gte: jest.fn(() => chain),
    insert: jest.fn(async (payload: Record<string, unknown>) => {
      inserts.push(payload);
      return { error: null };
    }),
    then: jest.fn((resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: responses.shift() ?? null, error: null }).then(resolve),
    ),
  };

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };
const mockedSendTelegramAlert = sendTelegramAlert as jest.MockedFunction<typeof sendTelegramAlert>;

describe('runGraduationAdvisor', () => {
  beforeEach(() => {
    responses.length = 0;
    inserts.length = 0;
    from.mockClear();
    mockedSendTelegramAlert.mockClear();
  });

  it('alerts and inserts a notification for tenants over the threshold', async () => {
    pushDb([{ tenant_id: 'ten_1', initiated_recipients_24h: 500 }]);

    const count = await runGraduationAdvisor(admin as never);

    expect(count).toBe(1);
    expect(mockedSendTelegramAlert).toHaveBeenCalledTimes(1);
    // notifications real columns: title/message/meta/read (no type/body/metadata).
    expect(inserts[0]).toMatchObject({
      tenant_id: 'ten_1',
      meta: expect.objectContaining({ kind: 'graduation_recommended' }),
    });
    expect(inserts[0]).not.toHaveProperty('type');
  });

  it('returns 0 when no tenants qualify', async () => {
    pushDb([]);

    const count = await runGraduationAdvisor(admin as never);

    expect(count).toBe(0);
    expect(mockedSendTelegramAlert).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});
