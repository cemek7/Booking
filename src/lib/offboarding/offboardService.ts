import type { SupabaseClient } from '@supabase/supabase-js';
import { assertTransition } from './stateMachine';
import { TEARDOWN_TASK_TYPES, GRACE_DAYS, RETENTION_YEARS, type LifecycleState, type OffboardingReason } from './types';
import { writeAuditLog } from '@/lib/audit/log';
import { defaultLogger } from '@/lib/logger';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EnterParams {
  tenantId: string;
  reason: OffboardingReason;
  actorUserId: string;
  actorRole: string;
}

export async function enterOffboarding(admin: SupabaseClient, p: EnterParams): Promise<{ lifecycleState: LifecycleState }> {
  const { data: tenant } = await admin
    .from('tenants').select('id, name, lifecycle_state').eq('id', p.tenantId).single();
  if (!tenant) throw new Error(`enterOffboarding: tenant ${p.tenantId} not found`);

  assertTransition(tenant.lifecycle_state as LifecycleState, 'scheduled_for_deletion');

  const now = Date.now();
  const graceMs = p.reason === 'gdpr_erasure' ? 0 : GRACE_DAYS() * DAY_MS;
  const scheduledPurgeAt = new Date(now + graceMs).toISOString();
  const financialsPurgeAt = new Date(now + graceMs + RETENTION_YEARS() * 365 * DAY_MS).toISOString();

  await admin.from('tenants').update({
    lifecycle_state: 'scheduled_for_deletion',
    offboarding_reason: p.reason,
    offboarded_by: p.actorUserId,
    offboarded_at: new Date(now).toISOString(),
    scheduled_purge_at: scheduledPurgeAt,
    financials_purge_at: financialsPurgeAt,
  }).eq('id', p.tenantId);

  await admin.from('offboarding_tasks').insert(
    TEARDOWN_TASK_TYPES.map((task_type) => ({ tenant_id: p.tenantId, task_type, status: 'pending' as const })),
  );

  await writeAuditLog(admin, {
    action: 'tenant.offboard.scheduled', tenantId: p.tenantId,
    userId: p.actorUserId, userRole: p.actorRole, result: 'success',
    metadata: { reason: p.reason, scheduled_purge_at: scheduledPurgeAt },
  });

  return { lifecycleState: 'scheduled_for_deletion' };
}

export interface ReactivateParams { tenantId: string; actorUserId: string; actorRole: string; }

export async function reactivate(admin: SupabaseClient, p: ReactivateParams): Promise<void> {
  const { data: tenant } = await admin
    .from('tenants').select('id, lifecycle_state').eq('id', p.tenantId).single();
  if (!tenant) throw new Error(`reactivate: tenant ${p.tenantId} not found`);

  assertTransition(tenant.lifecycle_state as LifecycleState, 'active');

  await admin.from('tenants').update({
    lifecycle_state: 'active',
    offboarding_reason: null,
    offboarded_by: null,
    offboarded_at: null,
    scheduled_purge_at: null,
    financials_purge_at: null,
  }).eq('id', p.tenantId);

  await admin.from('offboarding_tasks').update({ status: 'skipped' })
    .eq('tenant_id', p.tenantId).in('status', ['pending', 'failed']);

  // Off-boarding suspended the payment account. Reactivation returns it to
  // 'pending' so the owner re-verifies it in Settings → Payments; it never
  // jumps straight back to 'active'.
  const { error: accountError } = await admin.from('tenant_payment_accounts')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('tenant_id', p.tenantId)
    .eq('status', 'suspended');
  if (accountError) {
    defaultLogger.error('[offboarding] could not reset suspended payment account on reactivation', {
      tenantId: p.tenantId, error: accountError.message,
    });
  }

  await writeAuditLog(admin, {
    action: 'tenant.offboard.reactivated', tenantId: p.tenantId,
    userId: p.actorUserId, userRole: p.actorRole, result: 'success',
  });
}
