const { scanDiff } = require('../../scripts/techclave-gate/deterministic.cjs');

const emptyClassification = { classes: [], requirements: [] };
const migrationClassification = {
  classes: ['database_migrations'],
  requirements: ['forward_fix_note', 'rls_and_function_privilege_review'],
};

describe('Techclave Gate deterministic evidence', () => {
  it('emits a deterministic critical finding for an added GitHub token', () => {
    const result = scanDiff(
      '+ const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890"\n',
      emptyClassification,
    );

    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId: 'secret.github-token',
      severity: 'critical',
      confidence: 100,
    }));
  });

  it('requires function privilege review for a new SQL function without a public revoke', () => {
    const result = scanDiff(
      '+ CREATE OR REPLACE FUNCTION reserve_credit() RETURNS void AS $$ $$ LANGUAGE sql;\n',
      migrationClassification,
    );

    expect(result.missingProof).toContain('rls_and_function_privilege_review');
  });
});
