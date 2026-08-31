const {
  DECISIONS,
  createFinding,
  validatePolicy,
} = require('../../scripts/techclave-gate/types.cjs');

describe('Techclave Gate policy contracts', () => {
  it('rejects a blocking rule without deterministic evidence', () => {
    expect(() => validatePolicy({
      version: 1,
      rules: [{ id: 'production.secrets', block: true }],
    })).toThrow('blocking rules require deterministic evidence');
  });

  it('normalizes a confirmed secret finding as advisory would-block evidence', () => {
    expect(createFinding({
      ruleId: 'secret.github-token',
      severity: 'critical',
      evidenceKind: 'deterministic',
    })).toMatchObject({
      confidence: 100,
      decisionEligible: DECISIONS.WOULD_BLOCK,
    });
  });
});
