import { computeRiskScore } from '@/lib/whatsapp/v2/deliverability/riskScore';

describe('computeRiskScore', () => {
  it('is ~0 for clean low-volume tenant', () => {
    const score = computeRiskScore(
      { initiatedRecipients: 1, sent: 5, initiated: 5, cold: 0, optOuts: 0, failures: 0 },
      100,
    );

    expect(score).toBeLessThan(0.1);
  });

  it('a 2% opt-out rate alone pushes optOut component to its max weight', () => {
    const score = computeRiskScore(
      { initiatedRecipients: 10, sent: 100, initiated: 100, cold: 0, optOuts: 2, failures: 0 },
      1000,
    );

    expect(score).toBeGreaterThanOrEqual(0.20 - 0.001);
  });

  it('exhausted allocation + all-cold + high optout/fail approaches 1', () => {
    const score = computeRiskScore(
      { initiatedRecipients: 1000, sent: 1000, initiated: 1000, cold: 1000, optOuts: 50, failures: 100 },
      1000,
    );

    expect(score).toBeGreaterThan(0.9);
  });
});
