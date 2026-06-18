import { describe, it, expect } from '@jest/globals';
import { buildOptInProofPatch } from '@/lib/whatsapp/v2/optInProof';

describe('buildOptInProofPatch', () => {
  it('records customer-initiated opt-in when not yet recorded', () => {
    const patch = buildOptInProofPatch({}, 'whatsapp');
    expect(patch).not.toBeNull();
    expect(patch!.opt_in.source).toBe('customer_initiated');
    expect(patch!.opt_in.basis).toBe('user_initiated_contact');
    expect(patch!.opt_in.channel).toBe('whatsapp');
    expect(typeof patch!.opt_in.at).toBe('string');
  });

  it('returns null when opt-in is already recorded', () => {
    const patch = buildOptInProofPatch(
      { opt_in: { at: '2026-06-16T00:00:00.000Z', source: 'customer_initiated', basis: 'user_initiated_contact', channel: 'whatsapp' } },
      'whatsapp',
    );
    expect(patch).toBeNull();
  });
});
