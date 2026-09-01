const fs = require('fs');
const os = require('os');
const path = require('path');

const { replay } = require('../../scripts/techclave-gate/replay.cjs');

describe('Techclave Gate historical replay', () => {
  it('analyzes a git diff without checking out the historical head', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'techclave-gate-replay-'));
    const calls: string[][] = [];
    const execFileSync = (_command: string, args: string[]) => {
      calls.push(args);
      return args.includes('--name-only')
        ? Buffer.from('db/migrations/141_overdraft_reservation.sql\n')
        : Buffer.from('+ GRANT EXECUTE ON FUNCTION x() TO PUBLIC\n');
    };

    const result = await replay({
      base: 'base-sha',
      head: 'head-sha',
      outputRoot,
      execFileSync,
    });

    expect(result.decision).toBe('WOULD_BLOCK');
    expect(calls).toEqual(expect.arrayContaining([
      ['diff', '--no-ext-diff', '--name-only', 'base-sha...head-sha'],
      ['diff', '--no-ext-diff', 'base-sha...head-sha'],
    ]));
    expect(fs.existsSync(path.join(outputRoot, 'base-sha..head-sha', 'gate-result.json'))).toBe(true);
  });
});
