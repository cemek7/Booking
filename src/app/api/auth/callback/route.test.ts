import fs from 'node:fs';
import path from 'node:path';

describe('auth callback public origin contract', () => {
  it('uses the shared validated origin resolver', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/auth/callback/route.ts'),
      'utf8'
    );

    expect(source).toContain("from '@/lib/http/public-origin'");
    expect(source).not.toMatch(/function getPublicOrigin\(/);
    expect(source).not.toMatch(/function firstForwardedValue\(/);
    expect(source).not.toMatch(/function isInternalHostname\(/);
  });

  it('synchronizes membership email only after verified email-change sessions', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/auth/callback/route.ts'),
      'utf8'
    );

    expect(source).toContain('syncConfirmedLoginEmail');
    expect(source).toMatch(/verifyEmailTokenHash[\s\S]*syncConfirmedLoginEmail/);
  });
});
