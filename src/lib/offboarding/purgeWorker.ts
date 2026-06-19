import type { SupabaseClient } from '@supabase/supabase-js';
import { runTeardownTask, type OffboardingTaskRow } from './teardownTasks';
import { writeAuditLog } from '@/lib/audit/log';

// Operational/PII tables deleted in Phase 1. Names verified against the codebase
// schema (static audit). These tables FK-cascade on tenant delete, but Phase 1
// intentionally KEEPS the tenant row, so each must be purged explicitly here.
// Order is children-first where FK constraints require it. NOTE: deletes ignore
// per-table errors, so a not-yet-existing table is harmless.
const OPERATIONAL_TABLES = [
  'messages', 'chats', 'whatsapp_conversations', 'reservations', 'customers',
  'staff', 'services', 'leads', 'faqs', 'tenant_knowledge_articles', 'reviews',
  'whatsapp_configurations',
] as const;

export async function runDueTeardownTasks(admin: SupabaseClient): Promise<number> {
  const { data: tasks } = await admin
    .from('offboarding_tasks').select('*')
    .in('status', ['pending', 'failed']).lt('attempts', 5);
  let ran = 0;
  for (const t of (tasks ?? []) as OffboardingTaskRow[]) { await runTeardownTask(admin, t); ran++; }
  return ran;
}

export async function runOperationalPurge(admin: SupabaseClient): Promise<number> {
  const { data: due } = await admin
    .from('tenants').select('id, scheduled_purge_at')
    .eq('lifecycle_state', 'scheduled_for_deletion')
    .lte('scheduled_purge_at', new Date().toISOString());
  let purged = 0;
  for (const tenant of (due ?? []) as Array<{ id: string }>) {
    const { data: tasks } = await admin
      .from('offboarding_tasks').select('task_type, status').eq('tenant_id', tenant.id);
    const allSettled = ((tasks ?? []) as Array<{ status: string }>).every((t) => t.status === 'done' || t.status === 'skipped');
    if (!allSettled) continue;

    await admin.from('tenants').update({ lifecycle_state: 'purging' }).eq('id', tenant.id);
    for (const table of OPERATIONAL_TABLES) {
      await admin.from(table).delete().eq('tenant_id', tenant.id);
    }
    await admin.from('tenants').update({ lifecycle_state: 'purged' }).eq('id', tenant.id);
    await writeAuditLog(admin, { action: 'tenant.offboard.operational_purged', tenantId: tenant.id, userRole: 'system' });
    purged++;
  }
  return purged;
}

export async function runFinancialPurge(admin: SupabaseClient): Promise<number> {
  const { data: due } = await admin
    .from('tenants').select('id')
    .eq('lifecycle_state', 'purged')
    .lte('financials_purge_at', new Date().toISOString());
  let removed = 0;
  for (const tenant of (due ?? []) as Array<{ id: string }>) {
    await admin.from('transactions').delete().eq('tenant_id', tenant.id);
    await admin.from('offboarding_tasks').delete().eq('tenant_id', tenant.id);
    await writeAuditLog(admin, { action: 'tenant.offboard.financial_purged', tenantId: tenant.id, userRole: 'system' });
    await admin.from('tenants').delete().eq('id', tenant.id);
    removed++;
  }
  return removed;
}
