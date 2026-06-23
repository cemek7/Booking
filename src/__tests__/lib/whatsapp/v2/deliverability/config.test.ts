import { CFG } from '@/lib/whatsapp/v2/deliverability/config';

describe('deliverability config', () => {
  it('exposes window + danger + quarantine defaults', () => {
    expect(CFG.windowMs()).toBe(24 * 60 * 60 * 1000);
    expect(CFG.optOutDanger()).toBeCloseTo(0.02);
    expect(CFG.failureDanger()).toBeCloseTo(0.05);
    expect(CFG.quarantineThreshold()).toBeCloseTo(0.8);
  });

  it('maps quality to allocation factor', () => {
    expect(CFG.qualityFactor('GREEN')).toBe(1.0);
    expect(CFG.qualityFactor('YELLOW')).toBe(0.5);
    expect(CFG.qualityFactor('RED')).toBe(0.25);
    expect(CFG.qualityFactor('UNKNOWN')).toBe(0.5);
  });
});
