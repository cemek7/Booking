import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const responses: Array<unknown> = [];
const inserted: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

function pushDb(value: unknown) {
  responses.push(value);
}

function pushErr(message = 'db failed') {
  responses.push({ __error: message });
}

function makeChain() {
  const terminal = async () => {
    const next = responses.shift();
    if (next && typeof next === 'object' && '__error' in (next as Record<string, unknown>)) {
      return { data: null, error: { message: (next as { __error: string }).__error } };
    }
    return { data: next ?? null, error: null };
  };

  const chain: Record<string, jest.Mock> = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    neq: jest.fn(() => chain),
    gte: jest.fn(() => chain),
    maybeSingle: jest.fn(terminal),
    insert: jest.fn(async (payload: Record<string, unknown>) => {
      inserted.push(payload);
      return { error: null };
    }),
    upsert: jest.fn(async (payload: Record<string, unknown>) => {
      updates.push(payload);
      return { error: null };
    }),
  };
  (chain as unknown as { then: (resolve: (value: unknown) => unknown) => Promise<unknown> }).then = (resolve) =>
    terminal().then(resolve);

  return chain;
}

const from = jest.fn(() => makeChain());
const admin = { from };

jest.mock('@/lib/monitoring/telegramAlert', () => ({
  sendTelegramInfo: jest.fn().mockResolvedValue(undefined),
}));

describe('CAPS config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.VELOCITY_CREDITS;
    delete process.env.VELOCITY_WINDOW_MIN;
    delete process.env.DAILY_BUDGET_DEFAULT;
    delete process.env.DAILY_BUDGET_PLATFORM_MAX;
    delete process.env.SOFT_WARN_PCT;
    delete process.env.SPEND_CAPS_ENFORCED;
  });

  it('exposes defaults and clamps daily budget', async () => {
    const { CAPS } = await import('@/lib/billing/spendCaps/config');

    expect(CAPS.velocityCredits()).toBe(200);
    expect(CAPS.velocityWindowMs()).toBe(10 * 60 * 1000);
    expect(CAPS.dailyDefault()).toBe(2000);
    expect(CAPS.dailyPlatformMax()).toBe(20000);
    expect(CAPS.softWarnPct()).toBeCloseTo(0.8);
    expect(CAPS.enforced()).toBe(true);
    expect(CAPS.resolveDailyBudget(500)).toBe(500);
    expect(CAPS.resolveDailyBudget(999999)).toBe(20000);
    expect(CAPS.resolveDailyBudget(null)).toBe(2000);
  });
});

describe('checkCaps', () => {
  beforeEach(() => {
    responses.length = 0;
    inserted.length = 0;
    updates.length = 0;
    from.mockClear();
    process.env.SPEND_CAPS_ENFORCED = 'true';
  });

  it('allows under budget', async () => {
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -10 }]);
    pushDb([{ amount_credits: -50 }]);

    const decision = await checkCaps(admin as never, 't1');

    expect(decision).toMatchObject({ allowed: true, reason: 'ok', softWarn: false });
  });

  it('blocks on velocity cap', async () => {
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -150 }, { amount_credits: -80 }]);
    pushDb([{ amount_credits: -230 }]);

    const decision = await checkCaps(admin as never, 't1');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('velocity_cap');
  });

  it('blocks on daily cap', async () => {
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -5 }]);
    pushDb([{ amount_credits: -120 }]);

    const decision = await checkCaps(admin as never, 't1');

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('daily_cap');
  });

  it('flags softWarn at threshold', async () => {
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -5 }]);
    pushDb([{ amount_credits: -85 }]);

    const decision = await checkCaps(admin as never, 't1');

    expect(decision).toMatchObject({ allowed: true, softWarn: true });
  });

  it('fails open on query error', async () => {
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushErr();

    const decision = await checkCaps(admin as never, 't1');

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('meters without blocking when enforcement is disabled', async () => {
    process.env.SPEND_CAPS_ENFORCED = 'false';
    const { checkCaps } = await import('@/lib/billing/spendCaps/spendGuard');
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -300 }]);
    pushDb([{ amount_credits: -300 }]);

    const decision = await checkCaps(admin as never, 't1');

    expect(decision.allowed).toBe(true);
  });
});

describe('maybeAlertCap', () => {
  beforeEach(() => {
    responses.length = 0;
    inserted.length = 0;
    updates.length = 0;
    from.mockClear();
    jest.clearAllMocks();
  });

  it('inserts a daily-cap notification once per day', async () => {
    const { maybeAlertCap } = await import('@/lib/billing/spendCaps/spendAlerts');
    pushDb({ budget_warned_on: null });

    await maybeAlertCap(admin as never, 't1', 'daily_cap');

    // notifications real columns: title/message/meta/read (no `type`). Kind lives in meta.
    expect(inserted.some((row) => row?.meta?.kind === 'spend_cap')).toBe(true);
    expect(updates.some((row) => 'budget_warned_on' in row)).toBe(true);
  });

  it('does not re-alert when already warned today', async () => {
    const { maybeAlertCap } = await import('@/lib/billing/spendCaps/spendAlerts');
    pushDb({ budget_warned_on: new Date().toISOString().slice(0, 10) });

    await maybeAlertCap(admin as never, 't1', 'daily_cap');

    expect(inserted).toHaveLength(0);
  });

  it('logs velocity cap without owner notification inserts', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { maybeAlertCap } = await import('@/lib/billing/spendCaps/spendAlerts');
    const { sendTelegramInfo } = jest.requireMock('@/lib/monitoring/telegramAlert') as {
      sendTelegramInfo: jest.Mock;
    };

    await maybeAlertCap(admin as never, 't1', 'velocity_cap');

    expect(inserted).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    expect(sendTelegramInfo).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
