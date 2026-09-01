const fs = require('fs');
const os = require('os');
const path = require('path');

const { runGate } = require('../../scripts/techclave-gate/run.cjs');

describe('Techclave Gate offline runner', () => {
  it('writes an advisory summary and redacted JSON artifact', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'techclave-gate-'));

    const result = await runGate({
      files: ['db/migrations/141_overdraft_reservation.sql'],
      diff: '+ GRANT EXECUTE ON FUNCTION x() TO PUBLIC\n',
      outputDir,
    });

    expect(result.decision).toBe('WOULD_BLOCK');
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'gate-result.json'), 'utf8')).decision)
      .toBe('WOULD_BLOCK');
    expect(fs.readFileSync(path.join(outputDir, 'gate-summary.md'), 'utf8'))
      .toContain('TECHCLAVE GATE · Advisory');
  });
});
