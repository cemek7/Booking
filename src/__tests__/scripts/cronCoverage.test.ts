import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Every worker route must actually be scheduled, and the deploy script must
 * install what the runbook documents.
 *
 * deploy-vps.sh REWRITES its cron block on every deploy, stripping everything
 * between its start/end markers. So a worker missing from that script is not
 * merely unscheduled — any line someone adds by hand is deleted on the next
 * deploy. The message-charge sweeper was documented in vps-crontab.txt and
 * absent from the script, which means it had never run: reservations were never
 * released, and its released count is the only early warning that Meta has
 * stopped delivering delivery statuses.
 */

const ROOT = process.cwd();
const DEPLOY = readFileSync(join(ROOT, 'deployment/scripts/deploy-vps.sh'), 'utf8');
const RUNBOOK = readFileSync(join(ROOT, 'deployment/vps-crontab.txt'), 'utf8');

function workerRoutes(): string[] {
  const base = join(ROOT, 'src/app/api/worker');
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(base, d.name, 'route.ts')))
    .map((d) => `api/worker/${d.name}`);
}

describe('cron coverage', () => {
  it.each(workerRoutes())('%s is installed by the deploy script', (route) => {
    expect(DEPLOY).toContain(route);
  });

  it.each(workerRoutes())('%s is documented in the runbook', (route) => {
    expect(RUNBOOK).toContain(route);
  });

  it('installs everything the runbook documents', () => {
    // Drift the other way is just as bad: an operator reading the runbook would
    // believe a job runs when the deploy never installs it.
    const documented = [...RUNBOOK.matchAll(/\/(api\/(?:worker|cron|jobs)\/[a-z-]+)/g)]
      .map((m) => m[1]);
    const missing = [...new Set(documented)].filter((r) => !DEPLOY.includes(r));
    expect(missing).toEqual([]);
  });

  it('still guards the cron block with the markers the script strips on', () => {
    // Without these the awk that removes the previous block matches nothing and
    // every deploy appends a duplicate set of jobs.
    expect(DEPLOY).toContain('techclave-${TARGET}-start');
    expect(DEPLOY).toContain('techclave-${TARGET}-end');
  });

  it('strips the old block by PREFIX, so a generation change still replaces it', () => {
    // The start marker carries a generation suffix. Matching it with equality
    // would fail to recognise a block written by an earlier generation, leaving
    // those jobs in the crontab beside the new ones — every job running twice.
    // The awk lives inside a double-quoted bash string, so $ and " are escaped
    // in the file itself.
    expect(DEPLOY).toContain('index(\\$0, \\"# techclave-${TARGET}-start\\") == 1');
    expect(DEPLOY).not.toContain('\\$0 == \\"# techclave-${TARGET}-start\\"');
  });

  it('reinstalls the wrapper when run from the repo', () => {
    // bootstrap-vps.sh copies this script to /usr/local/bin/techclave-deploy
    // ONCE at provisioning and nothing ever re-copied it, so every later edit
    // to the cron block was invisible to the box. That is exactly how four
    // workers shipped and never ran.
    expect(DEPLOY).toContain('/usr/local/bin/techclave-deploy');
    expect(DEPLOY).toMatch(/install -m 755 "\$\{BASH_SOURCE\[0\]\}"/);
  });

  it('bootstrap installs the wrapper from the same file the deploy maintains', () => {
    // If these ever diverge, provisioning a new box and updating an existing
    // one would install different scripts.
    const bootstrap = readFileSync(join(ROOT, 'deployment/scripts/bootstrap-vps.sh'), 'utf8');
    expect(bootstrap).toContain('deployment/scripts/deploy-vps.sh');
    expect(bootstrap).toContain('/usr/local/bin/techclave-deploy');
  });
});
