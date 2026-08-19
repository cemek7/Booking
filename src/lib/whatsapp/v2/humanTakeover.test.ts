import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const getConversation = jest.fn<
  (externalId: string, tenantId: string, channel: string) => Promise<{ flow_data?: Record<string, unknown> } | null>
>();
const updateConversation = jest.fn<
  (
    externalId: string,
    tenantId: string,
    patch: { flow_data: Record<string, unknown> },
    channel: string
  ) => Promise<void>
>();

jest.mock('@/lib/whatsapp/v2/conversationState', () => ({
  getConversation,
  updateConversation,
}));

import {
  clearHumanHandling,
  isHumanHandling,
  setHumanHandling,
} from '@/lib/whatsapp/v2/humanTakeover';

describe('isHumanHandling', () => {
  const now = Date.parse('2026-06-30T12:00:00.000Z');

  it('returns true when human_handling_until is in the future', () => {
    expect(
      isHumanHandling({ human_handling_until: '2026-06-30T12:30:00.000Z' }, now)
    ).toBe(true);
  });

  it('returns false when the flag is expired or missing', () => {
    expect(
      isHumanHandling({ human_handling_until: '2026-06-30T11:30:00.000Z' }, now)
    ).toBe(false);
    expect(isHumanHandling({}, now)).toBe(false);
    expect(isHumanHandling(null, now)).toBe(false);
  });
});

describe('setHumanHandling / clearHumanHandling', () => {
  beforeEach(() => {
    getConversation.mockReset();
    updateConversation.mockReset();
  });

  it('merges a future timestamp into flow_data', async () => {
    getConversation.mockResolvedValue({ flow_data: { opt_in: { at: 'x' } } });

    await setHumanHandling({
      externalId: '234',
      tenantId: 't1',
      channel: 'whatsapp',
      minutes: 30,
    });

    const [externalId, tenantId, patch, channel] = updateConversation.mock.calls[0] as [
      string,
      string,
      { flow_data: Record<string, unknown> },
      string,
    ];

    expect(externalId).toBe('234');
    expect(tenantId).toBe('t1');
    expect(channel).toBe('whatsapp');
    expect(patch.flow_data.opt_in).toEqual({ at: 'x' });
    expect(typeof patch.flow_data.human_handling_until).toBe('string');
  });

  it('removes the takeover flag when clearing', async () => {
    getConversation.mockResolvedValue({
      flow_data: { human_handling_until: 'x', opt_in: 1 },
    });

    await clearHumanHandling({
      externalId: '234',
      tenantId: 't1',
      channel: 'whatsapp',
    });

    const [, , patch] = updateConversation.mock.calls[0] as [
      string,
      string,
      { flow_data: Record<string, unknown> },
      string,
    ];

    expect(patch.flow_data.human_handling_until).toBeUndefined();
    expect(patch.flow_data.opt_in).toBe(1);
  });

  it('no-ops when the conversation does not exist', async () => {
    getConversation.mockResolvedValue(null);

    await setHumanHandling({
      externalId: 'x',
      tenantId: 't',
      channel: 'whatsapp',
      minutes: 30,
    });

    expect(updateConversation).not.toHaveBeenCalled();
  });
});
