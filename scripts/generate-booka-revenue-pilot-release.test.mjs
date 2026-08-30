import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildBookaRevenuePilotSql,
  outputPath,
} from './generate-booka-revenue-pilot-release.mjs';

test('committed SQL bundle exactly matches generated output', () => {
  assert.equal(readFileSync(outputPath, 'utf8'), buildBookaRevenuePilotSql());
});

test('bundle is atomic, guarded, verified, and excludes disposable setup', () => {
  const sql = buildBookaRevenuePilotSql();

  assert.equal((sql.match(/^begin;$/gim) ?? []).length, 1);
  assert.equal((sql.match(/^commit;$/gim) ?? []).length, 1);
  assert.match(sql, /to_regclass\('public\.sias_outcome_attributions'\)/);
  assert.match(sql, /booka_revenue_requests missing columns/);
  assert.match(sql, /sias_outcome_attributions missing columns/);
  assert.doesNotMatch(sql, /create role anon/i);
  assert.ok(
    sql.lastIndexOf('sias_outcome_attributions missing columns') <
      sql.lastIndexOf('commit;'),
  );
  assert.equal(sql.endsWith('\n'), true);
  assert.equal(sql.endsWith('\n\n'), false);
});
