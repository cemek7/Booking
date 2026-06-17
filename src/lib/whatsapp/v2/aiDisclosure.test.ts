import { describe, it, expect } from '@jest/globals';
import { ensureDisclosure } from '@/lib/whatsapp/v2/aiDisclosure';

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
