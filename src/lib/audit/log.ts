import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditEntry {
  action: string;
  tenantId: string;
  userId?: string | null;
  userRole?: string | null;
  result?: string;
  metadata?: Record<string, unknown>;
}

/** Best-effort audit write. Never throws — auditing must not break the action it records. */
export async function writeAuditLog(admin: SupabaseClient, entry: AuditEntry): Promise<void> {
  try {
    const now = new Date().toISOString();
    // The audit_logs table has NOT NULL columns geared at permission checks
    // (event_type, resource, permission, security_level, timestamp) and a JSONB
    // `result`. Populate them so lifecycle events insert cleanly.
    const { error } = await admin.from('audit_logs').insert({
      action: entry.action,
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      user_role: entry.userRole ?? null,
      event_type: 'tenant_lifecycle',
      resource: 'tenant',
      permission: entry.action,
      security_level: 'info',
      timestamp: now,
      result: { status: entry.result ?? 'success' },
      metadata: entry.metadata ?? {},
    });
    if (error) console.warn('[audit] write failed', { action: entry.action, error: error.message });
  } catch (err) {
    console.warn('[audit] write threw', { action: entry.action, err });
  }
}
