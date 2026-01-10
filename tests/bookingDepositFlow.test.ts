// Jest globals are available without import
import { initiateDepositForReservation, PaymentsAdapter } from '@/lib/paymentsAdapter';
import type { SupabaseClient } from '@supabase/supabase-js';

interface TenantRow { id: string; metadata: { deposit_pct: number }; }
interface TransactionRow { amount: number; raw: Record<string, unknown>; }
// Minimal stub cast to SupabaseClient for test purposes
function makeSupabaseStub(depositPct: number) {
  return {
    from(table: string) {
      if (table === 'tenants') {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle(): Promise<{ data: TenantRow; error: null }> {
            return Promise.resolve({ data: { id: 't1', metadata: { deposit_pct: depositPct } }, error: null });
          }
        };
      }
      if (table === 'transactions') {
        return {
          insert(row: TransactionRow) {
            (globalThis as unknown as { __lastTxn?: TransactionRow }).__lastTxn = row;
            return Promise.resolve({ data: [row], error: null });
          }
        };
      }
      return { select() { return this; } };
    }
  } as unknown; // cast later to satisfy function signature
}

describe('initiateDepositForReservation', () => {
  beforeEach(() => {
    // ensure test isolation for global marker used by stub insert
    delete (globalThis as { __lastTxn?: TransactionRow }).__lastTxn;
  });
  it('calculates deposit amount and records transaction', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = makeSupabaseStub(25) as unknown as SupabaseClient<any, 'public', 'public'>;
    const adapter = new PaymentsAdapter();
    adapter.providers = {
      paystack: {
        name: 'paystack',
        async createDepositIntent() { return { id: 'ref123', status: 'created', provider: 'paystack', payment_url: 'https://pay' }; }
      }
    };
    const baseMinor = 10000; // 100.00
    const res = await initiateDepositForReservation(supabase, adapter, 't1', 'r1', baseMinor, 'NGN');
    expect(res.status).toBe('created');
    const inserted = (globalThis as { __lastTxn?: TransactionRow }).__lastTxn;
    expect(inserted).toBeTruthy();
    expect(inserted!.amount).toBe(25); // 25% of 100.00
    expect(inserted!.raw.provider).toBe('paystack');
    expect(inserted!.raw.reservation_id).toBe('r1');
  });

  it('skips when deposit_pct invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = makeSupabaseStub(0) as unknown as SupabaseClient<any, 'public', 'public'>;
    const adapter = new PaymentsAdapter();
    adapter.providers = {
      paystack: {
        name: 'paystack',
        async createDepositIntent() { return { id: 'x', status: 'created', provider: 'paystack', payment_url: null }; }
      }
    };
    const res = await initiateDepositForReservation(supabase, adapter, 't1', 'r1', 5000, 'NGN');
    expect((res as unknown as { skipped?: string }).skipped).toBe('invalid_deposit_pct');
    expect((globalThis as { __lastTxn?: TransactionRow }).__lastTxn).toBeUndefined();
  });
});
