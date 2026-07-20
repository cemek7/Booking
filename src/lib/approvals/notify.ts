import type { SupabaseClient } from '@supabase/supabase-js';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { defaultLogger } from '@/lib/logger';
import { getEffectivePermissions } from '@/lib/permissions/effectivePermissions';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';

const DEFAULT_DEBOUNCE_MINUTES = 10;

type ApprovalRequestRow = {
  id: string;
  tenant_id: string;
  request_type: string;
  requested_by?: string | null;
  required_permission: string;
};

async function hasRecentAlert(admin: SupabaseClient, tenantId: string, requestId: string, sinceIso: string) {
  const { data, error } = await admin
    .from('business_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('action', BUSINESS_EVENT_ACTIONS.APPROVAL_ALERTED)
    .eq('entity_id', requestId)
    .gte('created_at', sinceIso)
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.id);
}

export async function notifyPendingApprovalRequest(
  admin: SupabaseClient,
  request: ApprovalRequestRow
) {
  const debounceMinutes = Number(process.env.BOOKA_APPROVAL_ALERT_DEBOUNCE_MINUTES ?? DEFAULT_DEBOUNCE_MINUTES);
  const sinceIso = new Date(Date.now() - debounceMinutes * 60 * 1000).toISOString();
  if (await hasRecentAlert(admin, request.tenant_id, request.id, sinceIso)) return;

  const { data: approvers, error } = await admin
    .from('tenant_users')
    .select('id, phone, role')
    .eq('tenant_id', request.tenant_id)
    .in('role', ['owner', 'manager']);

  if (error || !approvers?.length) return;

  const client = await getTenantWhatsAppProviderClient(request.tenant_id);
  if (!client) return;

  for (const approver of approvers) {
    const tenantUserId = String((approver as { id?: string }).id ?? '');
    const phone = String((approver as { phone?: string | null }).phone ?? '');
    if (!tenantUserId || !phone || tenantUserId === request.requested_by) continue;

    const perms = await getEffectivePermissions(admin, request.tenant_id, tenantUserId);
    if (!perms.has(request.required_permission)) continue;

    try {
      await client.sendTextMessage(
        phone,
        `Booka approval needed\n\n${request.request_type.replaceAll('_', ' ')} request is waiting for your decision.\nApproval ID: ${request.id}`
      );

      await recordBusinessEvent(admin, {
        tenantId: request.tenant_id,
        actorType: 'system',
        action: BUSINESS_EVENT_ACTIONS.APPROVAL_ALERTED,
        entityType: 'approval_request',
        entityId: request.id,
        source: 'system',
        metadata: {
          sent_to: phone,
          required_permission: request.required_permission,
        },
      });
      return;
    } catch (notifyError) {
      defaultLogger.warn('[approvals.notify] failed', {
        tenantId: request.tenant_id,
        requestId: request.id,
        error: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }
}
