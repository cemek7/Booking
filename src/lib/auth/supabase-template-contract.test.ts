import fs from 'node:fs';
import path from 'node:path';

const runbookPath = path.join(process.cwd(), 'docs/runbooks/booka-supabase-auth-templates.md');
const runbook = () => fs.readFileSync(runbookPath, 'utf8');

describe('Booka Supabase auth template runbook', () => {
  it('contains complete enabled template sections', () => {
    expect(runbook()).toMatch(/## Magic Link[\s\S]*<!doctype html>/i);
    expect(runbook()).toMatch(/## Confirm Signup[\s\S]*<!doctype html>/i);
    expect(runbook()).toMatch(/## Change Email[\s\S]*<!doctype html>/i);
  });

  it('uses server-verifiable callback links without raw printed URLs', () => {
    expect(runbook()).toContain('{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email');
    expect(runbook()).toContain('{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email_change');
    expect(runbook()).not.toContain('{{ .ConfirmationURL }}');
    expect(runbook()).toContain('Open secure sign-in link');
    expect(runbook()).toContain('Open secure confirmation link');
  });

  it('documents required dashboard configuration', () => {
    expect(runbook()).toContain('Supabase Invite and Recovery are unused');
    expect(runbook()).toContain('https://staging.app.techclave.cloud/booka/auth/callback**');
    expect(runbook()).toContain('https://app.techclave.cloud/booka/auth/callback**');
    expect(runbook()).toMatch(/Secure Email Change[^\n]*enabled/i);
  });
});
