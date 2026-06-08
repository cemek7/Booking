// src/__tests__/lib/whatsapp/v2/optOut.test.ts
import { detectOptOutKeyword, isOptedOut } from '@/lib/whatsapp/v2/optOut';

describe('detectOptOutKeyword', () => {
  it.each(['STOP', 'stop', '  Stop  ', 'UNSUBSCRIBE', 'stopp'])('detects stop for %p', (t) => {
    expect(detectOptOutKeyword(t)).toBe('stop');
  });

  it.each(['START', 'resume', 'UNSTOP'])('detects start for %p', (t) => {
    expect(detectOptOutKeyword(t)).toBe('start');
  });

  it('does NOT match keywords embedded in a sentence', () => {
    expect(detectOptOutKeyword('stop by at 5')).toBeNull();
    expect(detectOptOutKeyword('can I start my booking')).toBeNull();
  });

  it('returns null for unrelated text', () => {
    expect(detectOptOutKeyword('book a haircut')).toBeNull();
  });
});

describe('isOptedOut', () => {
  it('true when opted_out_at is set', () => {
    expect(isOptedOut({ opted_out_at: '2026-06-01T00:00:00Z' })).toBe(true);
  });
  it('false when opted_out_at is null', () => {
    expect(isOptedOut({ opted_out_at: null })).toBe(false);
  });
});
