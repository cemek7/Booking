export const LIFECYCLE_STATES = ['active', 'scheduled_for_deletion', 'purging', 'purged'] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const OFFBOARDING_REASONS = ['voluntary', 'non_payment', 'gdpr_erasure', 'superadmin'] as const;
export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number];

export const TEARDOWN_TASK_TYPES = [
  'export_data', 'cancel_billing', 'refund_wallet_cash', 'revoke_whatsapp',
  'revoke_instagram', 'revoke_calendar', 'close_paystack_subaccount',
] as const;
export type TeardownTaskType = (typeof TEARDOWN_TASK_TYPES)[number];

/** Non-financial tasks that gate Phase-1 purge (all task types must settle). */
export const PURGE_GATING_TASKS: TeardownTaskType[] = [...TEARDOWN_TASK_TYPES];

export function GRACE_DAYS(): number {
  return Number(process.env.OFFBOARDING_GRACE_DAYS ?? 30);
}
export function RETENTION_YEARS(): number {
  return Number(process.env.FINANCIAL_RETENTION_YEARS ?? 7);
}
