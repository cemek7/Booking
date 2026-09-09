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
});
