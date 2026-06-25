import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { checkCaps } from '@/lib/billing/spendCaps/spendGuard';

// ── queue-based supabase mock ────────────────────────────────────────────────
type Resp = { data: unknown; error: unknown } | { __err: true };
const responses: Resp[] = [];
function pushDb(data: unknown) { responses.push({ data, error: null }); }
function pushErr() { responses.push({ __err: true }); }
function consume(): { data: unknown; error: unknown } {
  const r = responses.shift() ?? { data: null, error: null };
  if ((r as { __err?: true }).__err) throw new Error('mock query error');
  return r as { data: unknown; error: unknown };
}
function makeChain(): any {
  const chain: any = {};
  ['select', 'eq', 'neq', 'gte', 'lt', 'in'].forEach((m) => { chain[m] = () => chain; });
  chain.maybeSingle = async () => consume();
  chain.single = async () => consume();
  chain.then = (f: any, r: any) => Promise.resolve().then(() => consume()).then(f, r);
  return chain;
}
const admin: any = { from: jest.fn(() => makeChain()) };

describe('checkCaps', () => {
  beforeEach(() => { responses.length = 0; jest.clearAllMocks(); process.env.SPEND_CAPS_ENFORCED = 'true'; });

  it('allows under budget', async () => {
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -10 }]);
    pushDb([{ amount_credits: -50 }]);
    const d = await checkCaps(admin, 't1');
    expect(d).toMatchObject({ allowed: true, reason: 'ok', softWarn: false });
  });

  it('blocks on velocity (spend >= 200 in window)', async () => {
    pushDb({ daily_budget_credits: 2000, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -150 }, { amount_credits: -80 }]); // 230
    pushDb([{ amount_credits: -230 }]);
    const d = await checkCaps(admin, 't1');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('velocity_cap');
  });

  it('blocks on daily (spend >= budget)', async () => {
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -5 }]);
    pushDb([{ amount_credits: -120 }]);
    const d = await checkCaps(admin, 't1');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('daily_cap');
  });

  it('flags softWarn at >=80% of daily', async () => {
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -5 }]);
    pushDb([{ amount_credits: -85 }]);
    const d = await checkCaps(admin, 't1');
    expect(d).toMatchObject({ allowed: true, softWarn: true });
  });

  it('fails OPEN on query error', async () => {
    pushErr();
    const d = await checkCaps(admin, 't1');
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe('ok');
  });

  it('metering mode never blocks', async () => {
    process.env.SPEND_CAPS_ENFORCED = 'false';
    pushDb({ daily_budget_credits: 100, velocity_credits_override: null });
    pushDb({ timezone: 'UTC' });
    pushDb([{ amount_credits: -300 }]);
    pushDb([{ amount_credits: -300 }]);
    const d = await checkCaps(admin, 't1');
    expect(d.allowed).toBe(true);
  });
});
