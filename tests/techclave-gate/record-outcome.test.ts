const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordOutcome } = require('../../scripts/techclave-gate/record-outcome.cjs');

describe('Techclave Gate reviewer outcomes', () => {
  it('records an allowed reviewer outcome without raw evidence', () => {
    const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'techclave-gate-outcome-')), 'outcomes.ndjson');
    recordOutcome({ resultId: 'sha:abc123', ruleId: 'auth.changes', outcome: 'fixed', actor: 'ccemeka' }, logPath);

    const text = fs.readFileSync(logPath, 'utf8');
    expect(text).toContain('"outcome":"fixed"');
    expect(text).not.toContain('rawDiff');
  });

  it('rejects an unknown reviewer outcome', () => {
    const logPath = path.join(os.tmpdir(), 'techclave-gate-outcome-invalid.ndjson');
    expect(() => recordOutcome({ resultId: 'sha:abc', ruleId: 'x', outcome: 'ignored' }, logPath))
      .toThrow('invalid outcome');
  });
});
