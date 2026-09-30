import { readFileSync } from 'fs';
import { join } from 'path';

const migrationPath = 'db/migrations/159_retail_fulfillment_handoff.sql';
const releasePath = 'db/releases/2026-09-30-retail-fulfillment-handoff.sql';

function read(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe.each([migrationPath, releasePath])('retail fulfillment handoff schema: %s', (path) => {
  it('adds tenant-safe order escalation identity and replay protection', () => {
    const sql = read(path);

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS retail_order_id uuid/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reason_code text/i);
    expect(sql).toMatch(/UNIQUE \(tenant_id, id\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(tenant_id, retail_order_id\)[\s\S]+REFERENCES public\.retail_orders \(tenant_id, id\)/i);
    expect(sql).toMatch(/reason_code IS NULL OR reason_code IN \('retail_fulfillment'\)/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_escalation_retail_fulfillment/i);
    expect(sql).toMatch(/WHERE retail_order_id IS NOT NULL[\s\S]+reason_code = 'retail_fulfillment'/i);
  });

  it('adds an explicit backwards-compatible human handling mode', () => {
    const sql = read(path);

    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS human_handling_mode text/i);
    expect(sql).toMatch(/human_handling_mode IS NULL\s+OR human_handling_mode IN \('timed', 'until_released'\)/i);
    expect(sql).toMatch(/SET human_handling_mode = 'timed'/i);
    expect(sql).toMatch(/WHERE human_handling_until IS NOT NULL[\s\S]+human_handling_mode IS NULL/i);
  });

  it('does not add broad grants or destructive table operations', () => {
    const sql = read(path);

    expect(sql).not.toMatch(/GRANT ALL[\s\S]+TO (PUBLIC|anon|authenticated)/i);
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/i);
  });
});

describe('retail fulfillment release verification', () => {
  it('keeps verification state out of the constraint creation block', () => {
    const sql = read(releasePath);
    const constraintsBlock = sql.match(/DO \$constraints\$([\s\S]+?)\$constraints\$;/i)?.[1];

    expect(constraintsBlock).toBeDefined();
    expect(constraintsBlock).not.toMatch(/missing\s*:=/i);
    expect((sql.match(/^BEGIN;$/gim) ?? [])).toHaveLength(1);
    expect((sql.match(/^COMMIT;$/gim) ?? [])).toHaveLength(1);
  });

  it('verifies constraints, index, RLS and readiness without ambiguous catalog references', () => {
    const sql = read(releasePath);

    expect(sql).toMatch(/pg_catalog\.pg_constraint AS constraint_info/i);
    expect(sql).toMatch(/pg_catalog\.pg_get_constraintdef\(constraint_info\.oid\)/i);
    expect(sql).toMatch(/retail_orders_tenant_id_id_key/i);
    expect(sql).toMatch(/pg_catalog\.pg_indexes AS index_info/i);
    expect(sql).toMatch(/relation_info\.relrowsecurity/i);
    expect(sql).toMatch(/retail_fulfillment_handoff_schema_ready/i);
    expect(sql).not.toMatch(/\n\s+(AND|WHERE) (table_name|column_name|conname|relname)\s*=/i);
  });
});
