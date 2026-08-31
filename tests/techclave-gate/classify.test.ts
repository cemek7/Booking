const fs = require('fs');
const path = require('path');

const { classifyFiles } = require('../../scripts/techclave-gate/classify.cjs');

const policy = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), '.techclave/gate-policy.json'),
  'utf8',
));

describe('Techclave Gate change classifier', () => {
  it('marks a Meta webhook route as webhook-sensitive', () => {
    expect(classifyFiles(['src/app/api/webhooks/whatsapp/meta/route.ts'], policy).classes)
      .toContain('webhook_changes');
  });

  it('marks a migration and demands privilege review', () => {
    expect(classifyFiles(['db/migrations/141_overdraft_reservation.sql'], policy).requirements)
      .toContain('rls_and_function_privilege_review');
  });
});
