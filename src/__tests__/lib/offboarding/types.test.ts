import { LIFECYCLE_STATES, TEARDOWN_TASK_TYPES, GRACE_DAYS, RETENTION_YEARS } from '@/lib/offboarding/types';

describe('offboarding constants', () => {
  it('defines the four lifecycle states in order', () => {
    expect(LIFECYCLE_STATES).toEqual(['active', 'scheduled_for_deletion', 'purging', 'purged']);
  });
  it('defines all seven teardown task types', () => {
    expect(TEARDOWN_TASK_TYPES).toEqual([
      'export_data', 'cancel_billing', 'refund_wallet_cash', 'revoke_whatsapp',
      'revoke_instagram', 'revoke_calendar', 'close_paystack_subaccount',
    ]);
  });
  it('reads grace/retention from env with defaults', () => {
    expect(GRACE_DAYS()).toBe(30);
    expect(RETENTION_YEARS()).toBe(7);
  });
});
