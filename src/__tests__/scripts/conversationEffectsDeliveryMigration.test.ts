import fs from 'fs';
import path from 'path';

const migrationPath = path.join(process.cwd(), 'db/migrations/156_conversation_effect_delivery_hardening.sql');
const releasePath = path.join(process.cwd(), 'db/releases/2026-09-29-conversation-effect-delivery-hardening.sql');

describe.each([migrationPath, releasePath])('%s', (sqlPath) => {
  it('fails closed on duplicate outbound idempotency keys before adding uniqueness', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/GROUP BY tenant_id, idempotency_key[\s\S]*HAVING count\(\*\) > 1/i);
    expect(sql).toMatch(/RAISE EXCEPTION/i);
  });

  it('enforces tenant-scoped uniqueness for outbound intents', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX[\s\S]*ON public\.messages\s*\(tenant_id, idempotency_key\)[\s\S]*WHERE idempotency_key IS NOT NULL/i);
  });
});
