import { describe, it, expect, jest } from '@jest/globals';
import { ensureDisclosure, sendDisclosureIfNeeded } from '@/lib/whatsapp/v2/aiDisclosure';

describe('ensureDisclosure', () => {
  it('returns disclosure text + patch on first contact (flag unset)', () => {
    const result = ensureDisclosure({}, { businessName: 'Glow Salon' });
    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/automated assistant/i);
    expect(result!.text).toContain('Glow Salon');
    expect(typeof result!.flowDataPatch.ai_disclosure_sent_at).toBe('string');
  });

  it('returns null when disclosure was already sent', () => {
    const result = ensureDisclosure(
      { ai_disclosure_sent_at: '2026-06-16T00:00:00.000Z' },
      { businessName: 'Glow Salon' },
    );
    expect(result).toBeNull();
  });

  it('works without a business name', () => {
    const result = ensureDisclosure({});
    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/automated assistant/i);
  });
});

describe('sendDisclosureIfNeeded', () => {
  it('sends then persists on first contact (send before persist)', async () => {
    const order: string[] = [];
    const send = jest.fn(async () => { order.push('send'); });
    const persist = jest.fn(async () => { order.push('persist'); });

    const sent = await sendDisclosureIfNeeded({ flowData: {}, send, persist });

    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['send', 'persist']);
  });

  it('does nothing when disclosure was already sent', async () => {
    const send = jest.fn(async () => {});
    const persist = jest.fn(async () => {});

    const sent = await sendDisclosureIfNeeded({
      flowData: { ai_disclosure_sent_at: '2026-06-16T00:00:00.000Z' },
      send,
      persist,
    });

    expect(sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not persist when the send throws', async () => {
    const send = jest.fn(async () => { throw new Error('send failed'); });
    const persist = jest.fn(async () => {});

    await expect(sendDisclosureIfNeeded({ flowData: {}, send, persist })).rejects.toThrow('send failed');
    expect(persist).not.toHaveBeenCalled();
  });
});
