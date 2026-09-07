import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  computeOutboundReadiness,
  isWindowOpen,
} from '@/lib/chats/outboundReadiness';

const hasMessagingConsent = jest.fn<(...args: unknown[]) => Promise<boolean>>();

afterEach(() => {
  jest.useRealTimers();
});

jest.mock('@/lib/optin/messagingConsent', () => ({
  hasMessagingConsent: (...args: unknown[]) => hasMessagingConsent(...args),
}));

function makeSupabase(lastInboundAt: string | null) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: { last_inbound_at: lastInboundAt },
      error: null,
    }),
  };

  return {
    from: () => chain,
  } as never;
}

describe('isWindowOpen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
  });

  it('returns true for timestamps inside the window', () => {
    expect(isWindowOpen('2026-07-03T11:00:00.000Z', 2 * 60 * 60 * 1000)).toBe(true);
  });

  it('returns false for expired or missing timestamps', () => {
    expect(isWindowOpen('2026-07-01T11:00:00.000Z', 2 * 60 * 60 * 1000)).toBe(false);
    expect(isWindowOpen(null, 2 * 60 * 60 * 1000)).toBe(false);
  });
});

describe('computeOutboundReadiness', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
    hasMessagingConsent.mockReset();
  });

  it('allows instagram replies inside the service window', async () => {
    const result = await computeOutboundReadiness(makeSupabase('2026-07-03T11:00:00.000Z'), {
      tenantId: 't1',
      externalId: 'IGSID_1',
      channel: 'instagram',
    });

    expect(result).toMatchObject({ allowed: true, mode: 'reply_window' });
  });

  it('blocks instagram replies outside the service window', async () => {
    const result = await computeOutboundReadiness(makeSupabase('2026-07-01T11:00:00.000Z'), {
      tenantId: 't1',
      externalId: 'IGSID_1',
      channel: 'instagram',
    });

    expect(result).toMatchObject({ allowed: false, mode: 'blocked_instagram_window' });
  });

  it('allows whatsapp replies inside the standard window', async () => {
    const result = await computeOutboundReadiness(makeSupabase('2026-07-03T11:00:00.000Z'), {
      tenantId: 't1',
      externalId: '+2348000000000',
      channel: 'whatsapp',
    });

    expect(result).toMatchObject({ allowed: true, mode: 'reply_window' });
  });

  it('allows consented whatsapp follow-up outside the window', async () => {
    hasMessagingConsent.mockResolvedValue(true);

    const result = await computeOutboundReadiness(makeSupabase('2026-07-01T11:00:00.000Z'), {
      tenantId: 't1',
      externalId: '+2348000000000',
      channel: 'whatsapp',
    });

    expect(hasMessagingConsent).toHaveBeenCalled();
    expect(result).toMatchObject({ allowed: true, mode: 'consented_followup' });
  });

  it('blocks whatsapp follow-up without consent outside the window', async () => {
    hasMessagingConsent.mockResolvedValue(false);

    const result = await computeOutboundReadiness(makeSupabase('2026-07-01T11:00:00.000Z'), {
      tenantId: 't1',
      externalId: '+2348000000000',
      channel: 'whatsapp',
    });

    expect(result).toMatchObject({ allowed: false, mode: 'blocked_consent_required' });
  });
});
