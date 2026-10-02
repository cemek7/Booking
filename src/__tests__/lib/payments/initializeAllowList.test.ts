import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import path from 'path';

const repoRoot = path.resolve(__dirname, '../../../..');

const grep = (pattern: string) =>
  execSync(`git grep -l -E "${pattern}" -- 'src/**/*.ts' 'src/**/*.tsx' ':!src/__tests__/**' ':!**/*.test.ts' ':!**/*.test.tsx' || true`, { encoding: 'utf8', cwd: repoRoot })
    .split('\n').filter(Boolean).sort();

describe('Paystack initialize allow-list (spec 2026-10-02 §5)', () => {
  it('only paystack.ts names the initialize endpoint', () => {
    expect(grep('transaction/initialize')).toEqual(['src/lib/paystack.ts']);
  });
  it('only the wallet top-up calls initializeTransaction', () => {
    expect(grep('initializeTransaction\\(')).toEqual(['src/lib/billing/walletTopup.ts', 'src/lib/paystack.ts']);
  });
  it('only tenantSettlement calls initializeSplitTransaction', () => {
    expect(grep('initializeSplitTransaction\\(')).toEqual(['src/lib/payments/tenantSettlement.ts', 'src/lib/paystack.ts']);
  });
  it('only wallet billing calls chargeAuthorization', () => {
    expect(grep('chargeAuthorization\\(').every((f) => f === 'src/lib/paystack.ts' || f.startsWith('src/lib/billing/'))).toBe(true);
  });
  it('nothing reads the tenant-writable metadata subaccount at runtime', () => {
    expect(grep('paystack_subaccount_code')).toEqual([]);
  });
});
