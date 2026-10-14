import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.join(
  process.cwd(),
  'db/migrations/161_secure_tenant_invitations.sql'
);
const verifyPath = path.join(
  process.cwd(),
  'db/migrations/161_secure_tenant_invitations_verify.sql'
);

describe('secure tenant invitation migration', () => {
  const migration = () => fs.readFileSync(migrationPath, 'utf8');
  const verifier = () => fs.readFileSync(verifyPath, 'utf8');

  it('stores only a constrained SHA-256 token hash', () => {
    expect(migration()).toMatch(/token_hash\s+text\s+not\s+null\s+unique/i);
    expect(migration()).toMatch(/token_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i);
    expect(migration()).not.toMatch(/\btoken\s+text/i);
  });

  it('limits roles and protects the table with forced RLS', () => {
    expect(migration()).toMatch(/role\s+in\s*\('manager',\s*'staff'\)/i);
    expect(migration()).toMatch(/enable\s+row\s+level\s+security/i);
    expect(migration()).toMatch(/force\s+row\s+level\s+security/i);
  });

  it('uses invoker rights and restricts execution to service_role', () => {
    expect(migration()).toMatch(/security\s+invoker/i);
    expect(migration()).toMatch(/set\s+search_path\s*=\s*''/i);
    expect(migration()).toMatch(/revoke\s+execute[\s\S]*from\s+public/i);
    expect(migration()).toMatch(/revoke\s+execute[\s\S]*from\s+anon/i);
    expect(migration()).toMatch(/revoke\s+execute[\s\S]*from\s+authenticated/i);
    expect(migration()).toMatch(/grant\s+execute[\s\S]*to\s+service_role/i);
  });

  it('ships a verifier for schema, RLS, indexes, and grants', () => {
    expect(verifier()).toMatch(/tenant_invitations/i);
    expect(verifier()).toMatch(/relrowsecurity/i);
    expect(verifier()).toMatch(/relforcerowsecurity/i);
    expect(verifier()).toMatch(/service_role/i);
    expect(verifier()).toMatch(/has_function_privilege/i);
  });
});
