import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultLogger } from '@/lib/logger';
import { BUSINESS_EVENT_ACTIONS, recordBusinessEvent } from '@/lib/audit/businessEvents';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { buildDefaultWhatsAppProviderConfig, getProviderClient } from '@/lib/whatsapp/providers';
import { computeDailyClose } from './reconciliationService';
import { formatCloseReportText } from './formatCloseReport';

function localDateString(timezone: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(now);
}

function localTimeString(timezone: string, now = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  return formatter.format(now);
}

async function findOwnerPhone(admin: SupabaseClient, tenantId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('tenant_users')
    .select('users!inner(phone)')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error) {
    defaultLogger.warn('[closeReportJob] owner phone lookup failed', {
      tenantId,
      error: error.message,
    });
    return null;
  }

  return (data?.users as { phone?: string | null } | null)?.phone ?? null;
}

export async function runCloseReportForTenant(
  admin: SupabaseClient,
  tenantId: string,
  now = new Date()
): Promise<void> {
  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .select('timezone, close_report_enabled, close_report_time')
    .eq('id', tenantId)
    .single();

  if (tenantError) throw tenantError;
  if (!tenant?.close_report_enabled) return;

  const timezone = tenant.timezone ?? 'Africa/Lagos';
  const businessDate = localDateString(timezone, now);
  const { runId } = await computeDailyClose(admin, tenantId, businessDate, timezone);

  const [{ data: run, error: runError }, { data: items, error: itemsError }] = await Promise.all([
    admin.from('reconciliation_runs').select('*').eq('id', runId).single(),
    admin.from('reconciliation_items').select('*').eq('run_id', runId),
  ]);

  if (runError) throw runError;
  if (itemsError) throw itemsError;
  if ((run?.expected_revenue_cents ?? 0) === 0 && (run?.recorded_payments_cents ?? 0) === 0) return;
  if (run?.delivered_at) return;

  const ownerPhone = await findOwnerPhone(admin, tenantId);
  if (!ownerPhone) return;

  const config = buildDefaultWhatsAppProviderConfig();
  if (!config) {
    defaultLogger.warn('[closeReportJob] no default provider config available');
    return;
  }

  const client = getProviderClient(config);
  await client.sendTextMessage(ownerPhone, formatCloseReportText(run, items ?? []));

  await admin
    .from('reconciliation_runs')
    .update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId);

  await recordBusinessEvent(admin, {
    tenantId,
    actorType: 'system',
    action: BUSINESS_EVENT_ACTIONS.RECONCILIATION_DELIVERED,
    entityType: 'reconciliation_run',
    entityId: runId,
    source: 'system',
    metadata: {
      businessDate,
      reviewItemCount: (items ?? []).length,
      sentTo: ownerPhone,
    },
  });
}

export async function runDueCloseReports(admin: SupabaseClient, now = new Date()): Promise<number> {
  const { data: tenants, error } = await admin
    .from('tenants')
    .select('id, timezone, close_report_enabled, close_report_time')
    .eq('close_report_enabled', true);

  if (error) throw error;

  let sent = 0;
  for (const tenant of tenants ?? []) {
    const timezone = tenant.timezone ?? 'Africa/Lagos';
    const closeTime = String(tenant.close_report_time ?? '20:00').slice(0, 5);
    const localTime = localTimeString(timezone, now);
    if (localTime < closeTime) continue;

    const businessDate = localDateString(timezone, now);
    const { data: existingRun } = await admin
      .from('reconciliation_runs')
      .select('id, delivered_at')
      .eq('tenant_id', tenant.id)
      .eq('business_date', businessDate)
      .maybeSingle();

    if (existingRun?.delivered_at) continue;

    try {
      await runCloseReportForTenant(admin, tenant.id, now);
      sent += 1;
    } catch (jobError) {
      defaultLogger.error('[closeReportJob] tenant close report failed', {
        tenantId: tenant.id,
        error: jobError instanceof Error ? jobError.message : String(jobError),
      });
    }
  }

  return sent;
}

export async function runDueCloseReportsWithAdmin(now = new Date()) {
  const admin = createSupabaseAdminClient();
  return runDueCloseReports(admin, now);
}
