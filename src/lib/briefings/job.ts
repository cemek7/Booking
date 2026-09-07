import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import { buildMorningBriefing } from './morning';
import { buildWeeklyBriefing } from './weekly';

type BriefingType = 'morning' | 'weekly';

function localDateString(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function localTimeString(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

function weekKey(timezone: string, now = new Date()) {
  const businessDate = localDateString(timezone, now);
  const date = new Date(`${businessDate}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

async function findOwnerPhone(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from('tenant_users')
    .select('phone, users(phone)')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .maybeSingle();

  if (error) throw error;
  const row = data as { phone?: string | null; users?: { phone?: string | null } | null } | null;
  return row?.phone ?? row?.users?.phone ?? null;
}

async function alreadyArchived(admin: SupabaseClient, tenantId: string, type: BriefingType, periodKey: string) {
  const { data, error } = await admin
    .from('briefing_runs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('briefing_type', type)
    .contains('meta', { period_key: periodKey })
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

async function archiveRun(
  admin: SupabaseClient,
  tenantId: string,
  type: BriefingType,
  status: 'sent' | 'skipped' | 'failed',
  body: string | null,
  meta: Record<string, unknown>,
) {
  const { error } = await admin.from('briefing_runs').insert({
    tenant_id: tenantId,
    briefing_type: type,
    status,
    body,
    meta,
    sent_at: status === 'sent' ? new Date().toISOString() : null,
  });
  if (error) throw error;
}

export async function runDueBriefings(admin: SupabaseClient, now = new Date()) {
  const { data: schedules, error } = await admin
    .from('briefing_schedules')
    .select('tenant_id, briefing_type, schedule_time, enabled, tenants(name, timezone)')
    .eq('enabled', true);

  if (error) throw error;

  let sent = 0;
  let skipped = 0;

  for (const schedule of schedules ?? []) {
    const tenantId = String(schedule.tenant_id);
    const type = String(schedule.briefing_type) as BriefingType;
    const tenant = schedule.tenants as { name?: string | null; timezone?: string | null } | null;
    const timezone = tenant?.timezone ?? 'Africa/Lagos';
    const localTime = localTimeString(timezone, now);
    const dueTime = String(schedule.schedule_time ?? '08:00').slice(0, 5);
    if (localTime < dueTime) continue;

    if (type === 'weekly' && new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(now) !== 'Monday') {
      continue;
    }

    const periodKey = type === 'morning' ? localDateString(timezone, now) : weekKey(timezone, now);
    if (await alreadyArchived(admin, tenantId, type, periodKey)) continue;

    const payload = type === 'morning'
      ? await buildMorningBriefing(admin, tenantId, now)
      : await buildWeeklyBriefing(admin, tenantId, now);

    if (!payload) {
      await archiveRun(admin, tenantId, type, 'skipped', null, { period_key: periodKey, reason: 'empty' });
      skipped += 1;
      continue;
    }

    const ownerPhone = await findOwnerPhone(admin, tenantId);
    const client = ownerPhone ? await getTenantWhatsAppProviderClient(tenantId) : null;
    if (!ownerPhone || !client) {
      await archiveRun(admin, tenantId, type, 'failed', payload.body, { ...payload.meta, period_key: periodKey, reason: 'missing_delivery_target' });
      continue;
    }

    const result = await client.sendTextMessage(ownerPhone, payload.body);
    if (!result.success) {
      await archiveRun(admin, tenantId, type, 'failed', payload.body, { ...payload.meta, period_key: periodKey, reason: 'send_failed' });
      continue;
    }

    await archiveRun(admin, tenantId, type, 'sent', payload.body, { ...payload.meta, period_key: periodKey, owner_phone: ownerPhone });
    sent += 1;
  }

  return { sent, skipped };
}

export async function runDueBriefingsWithAdmin(now = new Date()) {
  const admin = createSupabaseAdminClient();
  return runDueBriefings(admin, now);
}
