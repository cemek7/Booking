import fs from 'node:fs';
import path from 'node:path';

const governedFiles = [
  'src/lib/auth/issue-tenant-invitation.ts',
  'src/lib/auth/email-callback.ts',
  'src/app/api/account/email/route.ts',
  'src/app/api/invitations/open/route.ts',
  'src/app/api/invitations/status/route.ts',
  'src/app/api/invitations/accept/route.ts',
];

describe('unified Supabase client contract', () => {
  it.each(governedFiles)('%s uses Booka client factories', (relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    expect(source).not.toContain("from '@supabase/supabase-js'");
    expect(source).not.toMatch(/\bcreateClient\s*\(/);
  });
});
