import fs from 'fs';
import path from 'path';

const sql = fs.readFileSync(
  path.join(process.cwd(), 'db/migrations/154_channel_identity_runtime_hardening.sql'),
  'utf8',
);

describe('channel identity runtime hardening migration', () => {
  it('allows non-phone channel customers without manufacturing a phone number', () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.customers\s+ALTER COLUMN phone DROP NOT NULL/i,
    );
  });

  it('gives the service role explicit access to all continuity tables', () => {
    for (const table of [
      'shared_channel_route_sessions',
      'customer_channel_identities',
      'conversation_threads',
      'customer_memory_facts',
      'conversation_effects',
    ]) {
      expect(sql).toMatch(new RegExp(`GRANT ALL ON TABLE public\\.${table} TO service_role`, 'i'));
    }
  });

  it('keeps route sessions server-only and gives members read-only table privileges', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.shared_channel_route_sessions FROM PUBLIC, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /GRANT SELECT ON TABLE[\s\S]+customer_channel_identities[\s\S]+TO authenticated/i,
    );
    expect(sql).not.toMatch(
      /GRANT SELECT ON TABLE public\.shared_channel_route_sessions TO authenticated/i,
    );
  });
});
