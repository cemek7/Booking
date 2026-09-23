import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const read = (file: string) => readFileSync(join(ROOT, 'db', 'migrations', file), 'utf8');

describe('migration 152 booking safety contract', () => {
  const migrationName = '152_booking_hours_reservation_safety.sql';
  const rollbackName = '152_booking_hours_reservation_safety_rollback.sql';

  it('fails closed when existing active reservations overlap', () => {
    const sql = read(migrationName);

    expect(sql).toMatch(/IF\s+EXISTS\s*\([\s\S]*FROM\s+public\.reservations\s+a[\s\S]*JOIN\s+public\.reservations\s+b/i);
    expect(sql).toMatch(/tstzrange\(a\.start_at,\s*a\.end_at,\s*'\[\)'\)\s*&&\s*tstzrange\(b\.start_at,\s*b\.end_at,\s*'\[\)'\)/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION[\s\S]*overlap/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?reservations/i);
  });

  it('backfills only missing canonical settings with metadata ahead of legacy rows', () => {
    const sql = read(migrationName);

    expect(sql).toMatch(/settings[\s\S]*business_hours/i);
    expect(sql).toMatch(/metadata\s*->\s*'business_hours'/i);
    expect(sql).toMatch(/FROM\s+public\.business_hours/i);
    expect(sql).toMatch(/NOT\s*\([\s\S]*settings[\s\S]*\?\s*'business_hours'/i);
    expect(sql.indexOf("metadata -> 'business_hours'")).toBeLessThan(sql.indexOf('legacy_hours'));
  });

  it('adds the active half-open exclusion constraint without pinning btree_gist', () => {
    const sql = read(migrationName);

    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+btree_gist\s*;/i);
    expect(sql).toMatch(/reservations_no_active_overlap/i);
    expect(sql).toMatch(/EXCLUDE\s+USING\s+gist/i);
    expect(sql).toMatch(/tenant_id\s+WITH\s+=/i);
    expect(sql).toMatch(/COALESCE\s*\(\s*staff_id\s*,\s*'00000000-0000-0000-0000-000000000000'::uuid\s*\)\s*\)?\s+WITH\s+=/i);
    expect(sql).toMatch(/tstzrange\s*\(\s*start_at\s*,\s*end_at\s*,\s*'\[\)'\s*\)\s*\)?\s+WITH\s+&&/i);
    expect(sql).toMatch(/WHERE\s*\([\s\S]*status\s+IN\s*\(\s*'pending'\s*,\s*'confirmed'\s*\)/i);
    expect(sql).not.toMatch(/btree_gist\s+VERSION/i);
  });

  it('rolls back only the constraint and preserves owner configuration', () => {
    const sql = read(rollbackName);

    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+reservations_no_active_overlap/i);
    expect(sql).not.toMatch(/DELETE|UPDATE\s+public\.tenants|DROP\s+EXTENSION/i);
  });
});
