import { describe, it, expect } from '@jest/globals';
import { readdirSync } from 'fs';
import { join } from 'path';

/**
 * Migrations here are applied BY HAND on the VPS, in numeric order. Two files
 * sharing a number is therefore an operational hazard, not a cosmetic one: an
 * operator working from the number — or globbing `097_*` — can apply one and
 * silently skip the other, and the second one's tables simply never exist.
 *
 * Six collisions already exist and are grandfathered below. This test does not
 * try to renumber them, which would be worse: the numbers are already recorded
 * in runbooks and in whatever has been applied to live. It stops the set from
 * GROWING, which is the part still under our control.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'db', 'migrations');

/** Numbers already shipped with two files each. Do not add to this list. */
const GRANDFATHERED = new Set(['065', '077', '078', '079', '097', '122', '123']);

function migrationsByNumber(): Map<string, string[]> {
  const byNumber = new Map<string, string[]>();
  readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
    .forEach((f) => {
      const m = /^(\d+)_/.exec(f);
      if (!m) return;
      const list = byNumber.get(m[1]) ?? [];
      list.push(f);
      byNumber.set(m[1], list);
    });
  return byNumber;
}

describe('migration numbering', () => {
  it('has no NEW duplicate numbers', () => {
    const duplicates = [...migrationsByNumber().entries()]
      .filter(([, files]) => files.length > 1)
      .filter(([number]) => !GRANDFATHERED.has(number))
      .map(([number, files]) => `${number}: ${files.join(', ')}`);

    expect(duplicates).toEqual([]);
  });

  it('keeps the grandfathered list honest', () => {
    // If a collision is ever resolved, the entry must come off this list —
    // otherwise it silently licenses a future collision on the same number.
    const actual = new Set(
      [...migrationsByNumber().entries()]
        .filter(([, files]) => files.length > 1)
        .map(([number]) => number),
    );
    const stale = [...GRANDFATHERED].filter((n) => !actual.has(n));

    expect(stale).toEqual([]);
  });

  it('gives every migration a name an operator can order by', () => {
    // Three shapes are in use and all sort deterministically under a glob:
    //   123_name.sql   — the main sequence
    //   123b_name.sql  — a follow-up to that number, sorts right after it
    //   2026-07-26_name.sql — date-named; sorts after every numbered file
    // Anything else has no defined position in a hand-applied run.
    const UNORDERABLE = new Set(['create-audit-logs.sql']);

    const unorderable = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.includes('rollback'))
      .filter((f) => !/^\d+b?_/.test(f) && !/^\d{4}-\d{2}-\d{2}_/.test(f))
      .filter((f) => !UNORDERABLE.has(f));

    expect(unorderable).toEqual([]);
  });
});
