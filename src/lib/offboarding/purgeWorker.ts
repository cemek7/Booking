import type { SupabaseClient } from '@supabase/supabase-js';
import { runTeardownTask, type OffboardingTaskRow } from './teardownTasks';
import { writeAuditLog } from '@/lib/audit/log';

// Operational/PII tables deleted in Phase 1 (verified against the live schema).
// These FK-cascade on tenant delete, but Phase 1 intentionally KEEPS the tenant
// row, so each is purged explicitly. Ordered CHILDREN-FIRST so FK references are
// cleared before their parents. Deletes ignore per-table errors, so a table that
// only exists after a pending migration is harmless. EXCLUDES financial/compliance
// data (transactions, *_ledger, ai_wallets, audit_logs, offboarding_tasks) and
// membership (tenant_users) — those are handled by Phase 2 / retention.
const OPERATIONAL_TABLES = [
  // Reservation/review/feedback children
  'reservation_services', 'reservation_logs', 'reviews', 'customer_feedback',
  // Analytics / ML / ratings (tenant-scoped derived data)
  'staff_ratings', 'service_ratings', 'customer_analytics', 'ml_predictions',
  'anomaly_detections', 'revenue_optimizations', 'module_feature_usage',
  'analytics_events', 'analytics_metrics_cache', 'performance_metrics',
  'bi_dashboards', 'ml_models', 'insights_daily', 'reservation_trends',
  // Staff operational
  'staff_skills', 'staff_services', 'staff_schedules', 'schedule_overrides',
  'availability_slots', 'slot_locks',
  // Messaging / conversations
  'whatsapp_media', 'whatsapp_message_queue', 'whatsapp_sessions',
  'whatsapp_connection_logs', 'whatsapp_connection_metrics', 'messages',
  'dialog_sessions', 'chats', 'whatsapp_conversations', 'whatsapp_connections',
  // Support (support_messages/support_assignments have NO tenant_id — they are
  // scoped via ticket_id and purged separately in purgeSupportChildren below).
  'support_tickets',
  // Notifications / reminders
  'booking_notifications', 'scheduled_notifications', 'notifications', 'reminders',
  // Marketing / SIAS / escalation
  'sias_outcome_attributions', 'sias_campaign_runs', 'sias_operational_memory',
  'escalation_queue',
  // Content (FAQ / knowledge / showcase / skills)
  'faqs', 'tenant_knowledge_articles', 'whatsapp_showcase_pack_items',
  'whatsapp_showcase_packs', 'skills',
  // Core entities
  'reservations', 'bookings', 'customers', 'services', 'leads', 'tasks',
  // Per-tenant config + provider secrets
  'whatsapp_provider_secrets', 'whatsapp_configurations',
  'tenant_reminder_settings', 'tenant_tone_profiles', 'tenant_modules',
] as const;

/**
 * Purge support_messages + support_assignments, which have no tenant_id and are
 * scoped only via ticket_id. Deletes them for every support ticket owned by the
 * tenant (don't rely on an unverified FK cascade — this is PII).
 */
async function purgeSupportChildren(admin: SupabaseClient, tenantId: string): Promise<void> {
  const { data: tickets } = await admin
    .from('support_tickets').select('id').eq('tenant_id', tenantId);
  const ticketIds = ((tickets ?? []) as Array<{ id: string }>).map((t) => t.id);
  if (ticketIds.length === 0) return;
  await admin.from('support_messages').delete().in('ticket_id', ticketIds);
  await admin.from('support_assignments').delete().in('ticket_id', ticketIds);
}

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
    // Ticket-scoped children first (no tenant_id of their own).
    await purgeSupportChildren(admin, tenant.id);
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
