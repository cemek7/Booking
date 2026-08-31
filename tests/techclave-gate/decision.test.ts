const { decideRelease } = require('../../scripts/techclave-gate/decision.cjs');

describe('Techclave Gate release decision', () => {
  it('never lets model-only evidence produce WOULD_BLOCK', () => {
    expect(decideRelease({
      findings: [{ evidenceKind: 'model', severity: 'critical', confidence: 99 }],
    }).decision).toBe('REVIEW_REQUIRED');
  });

  it('returns VALIDATION_INCOMPLETE when a required scanner failed', () => {
    expect(decideRelease({ scannerFailures: ['npm-audit'], findings: [] }).decision)
      .toBe('VALIDATION_INCOMPLETE');
  });
});
