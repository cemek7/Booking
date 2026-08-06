/**
 * Nightly Cron Job — Insights Aggregation + Backup
 *
 * Vercel Cron #2 — runs daily at 23:00 WAT (22:00 UTC).
 *
 * Two tasks:
 *   1. Aggregate yesterday's reservations into insights_daily
 *   2. Export tenant data to Cloudflare R2 (optional — skipped if R2 not configured)
 *
 * vercel.json cron config:
 *   { "path": "/api/cron/nightly", "schedule": "0 22 * * *" }
 */

import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { sendTelegramInfo, sendTelegramAlert } from '@/lib/monitoring/telegramAlert';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import type { WhatsAppProviderClient } from '@/lib/whatsapp/providers/types';
import { siasOperations } from '@/lib/sias-operations';
import { runDueSiasCampaigns } from '@/lib/siasCampaignRunner';
import { brandCustomerText } from '@/lib/whatsapp/v2/outboundBranding';
import { sendGovernedInitiated } from '@/lib/whatsapp/v2/deliverability/governedSend';
import { runGraduationAdvisor } from '@/lib/whatsapp/v2/deliverability/graduationAdvisor';
import { runDueTeardownTasks, runOperationalPurge, runFinancialPurge } from '@/lib/offboarding/purgeWorker';
import { recomputeProfile } from '@/lib/customers/profile';
import { normalizePhone } from '@/lib/customers/identity';

const supabaseAdmin = createSupabaseAdminClient();
type LooseRow = Record<string, unknown>;

type WeeklyInsightAccumulator = {
  totalBookings: number;
  completed: number;
  cancelled: number;
  noShows: number;
  revenue: number;
  topServices: Map<string, number>;
};

export const maxDuration = 300; // 5-minute budget for nightly job

function toTemplateParameters(paramMapping: unknown[]): Array<{ default: string }> {
  return paramMapping.map((entry) => {
    if (entry && typeof entry === 'object' && 'default' in entry) {
      return { default: String((entry as { default?: unknown }).default ?? '') };
    }

    return { default: String(entry ?? '') };
  });
}

export async function runOffboardingSweep(): Promise<{ teardown: number; operational: number; financial: number }> {
  const teardown = await runDueTeardownTasks(supabaseAdmin);
  const operational = await runOperationalPurge(supabaseAdmin);
  const financial = await runFinancialPurge(supabaseAdmin);
  return { teardown, operational, financial };
}

const WHATSAPP_SEND_CACHE = new Map<string, Promise<WhatsAppProviderClient | null>>();

function normalizeTenantSettings(
  metadata: unknown,
  toneConfig: unknown,
): Record<string, unknown> {
  const settings =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};

  if (
    toneConfig &&
    typeof toneConfig === 'object' &&
    !Array.isArray(toneConfig) &&
    settings.tone_config === undefined
  ) {
    settings.tone_config = toneConfig;
  }

  return settings;
}

export async function GET(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // ── Task 1: Aggregate insights ─────────────────────────────────────────────
  try {
    const aggregation = await aggregateInsights();
    results.insights = aggregation;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] insights aggregation failed', err);
    await sendTelegramAlert(`Nightly insights aggregation failed: ${msg}`);
    results.insights_error = msg;
  }

  // ── Task 2: 3-day follow-up messages ──────────────────────────────────────
  try {
    const followUps = await sendRebookingFollowUps();
    results.rebooking_followup = { sent: followUps };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] rebooking follow-ups failed', err);
    results.rebooking_followup_error = msg;
  }

  // ── Task 3: Cycle-interval rebooking nudges ────────────────────────────────
  try {
    const nudges = await sendRebookingNudges();
    results.rebooking_nudge = { sent: nudges };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] rebooking nudges failed', err);
    results.rebooking_nudge_error = msg;
  }

  // ── Task 4: Execute due SIAS campaign jobs ────────────────────────────────
  try {
    const campaigns = await runDueCampaignsForAllTenants();
    results.sias_campaigns = campaigns;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] SIAS campaign execution failed', err);
    results.sias_campaigns_error = msg;
  }

  // ── Task 5: R2 backup (optional) ───────────────────────────────────────────
  if (isR2Configured()) {
    try {
      const backedUp = await runR2Backup();
      results.backup = backedUp;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[cron/nightly] R2 backup failed', err);
      await sendTelegramAlert(`Nightly R2 backup failed: ${msg}`);
      results.backup_error = msg;
    }
  }

  // ── Task 6: Owner weekly digest ────────────────────────────────────────────
  try {
    const digests = await sendOwnerWeeklyDigest();
    results.owner_weekly_digest = { sent: digests };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] owner weekly digest failed', err);
    results.owner_weekly_digest_error = msg;
  }

  // ── Task 7: At-risk clients alert ──────────────────────────────────────────
  try {
    const alerts = await sendAtRiskClientsAlert();
    results.at_risk_clients_alert = { sent: alerts };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] at-risk clients alert failed', err);
    results.at_risk_clients_alert_error = msg;
  }

  // ── Task 8: Off-boarding lifecycle sweep ──────────────────────────────────
  try {
    results.offboarding = await runOffboardingSweep();
  } catch (e) {
    console.error('[cron/nightly] offboarding sweep failed', e);
  }

  // ── Task 9: Deliverability graduation advisor ─────────────────────────────
  try {
    results.deliverability_graduation = {
      advised: await runGraduationAdvisor(supabaseAdmin as never),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/nightly] deliverability graduation advisor failed', err);
    results.deliverability_graduation_error = msg;
  }

  await sendTelegramInfo(`Nightly cron complete ✅\n${JSON.stringify(results, null, 2)}`);

  return NextResponse.json(results);
}

async function runDueCampaignsForAllTenants(): Promise<{ processed: number; delivered: number; failed: number; tenants: number }> {
  const now = new Date().toISOString();
  const { data: rows } = await supabaseAdmin
    .from('sias_campaign_runs')
    .select('tenant_id')
    .in('status', ['pending', 'retry_scheduled'])
    .lte('scheduled_for', now)
    .limit(200);

  const tenantIds = [
    ...new Set(
      ((rows ?? []) as Array<{ tenant_id: string | null }>)
        .map((row) => row.tenant_id)
        .filter((tenantId): tenantId is string => Boolean(tenantId))
    ),
  ];
  let processed = 0;
  let delivered = 0;
  let failed = 0;

  for (const tenantId of tenantIds) {
    const result = await runDueSiasCampaigns(supabaseAdmin, tenantId, 25);
    processed += result.processed;
    delivered += result.delivered;
    failed += result.failed;
  }

  return { processed, delivered, failed, tenants: tenantIds.length };
}

async function loadConversationFlags(
  tenantId: string,
  phone: string,
): Promise<{ last_inbound_at: string | null; opted_out_at: string | null }> {
  const { data } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('last_inbound_at, opted_out_at')
    .eq('tenant_id', tenantId)
    .eq('phone_number', phone)
    .maybeSingle();

  return {
    last_inbound_at: typeof data?.last_inbound_at === 'string' ? data.last_inbound_at : null,
    opted_out_at: typeof data?.opted_out_at === 'string' ? data.opted_out_at : null,
  };
}

// ─── Insights aggregation ─────────────────────────────────────────────────────

async function aggregateInsights(): Promise<{
  tenants_processed: number;
  tenant_daily_summary_rows: number;
  customer_profile_summary_rows: number;
  service_performance_summary_rows: number;
  staff_performance_summary_rows: number;
  availability_snapshot_rows: number;
}> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // Get all v2-enabled tenants
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('v2_enabled', true);

  if (!tenants?.length) {
    return {
      tenants_processed: 0,
      tenant_daily_summary_rows: 0,
      customer_profile_summary_rows: 0,
      service_performance_summary_rows: 0,
      staff_performance_summary_rows: 0,
      availability_snapshot_rows: 0,
    };
  }

  let tenantDailySummaryRows = 0;
  let customerProfileSummaryRows = 0;
  let servicePerformanceSummaryRows = 0;
  let staffPerformanceSummaryRows = 0;
  let availabilitySnapshotRows = 0;

  for (const tenant of tenants) {
    await aggregateTenantDay(tenant.id, dateStr);
    tenantDailySummaryRows += await aggregateTenantDailySummary(tenant.id, dateStr);
    customerProfileSummaryRows += await aggregateCustomerProfiles(tenant.id);
    servicePerformanceSummaryRows += await aggregateServicePerformance(tenant.id);
    staffPerformanceSummaryRows += await aggregateStaffPerformance(tenant.id);
    availabilitySnapshotRows += await aggregateAvailabilitySnapshots(tenant.id, 3);
  }

  return {
    tenants_processed: tenants.length,
    tenant_daily_summary_rows: tenantDailySummaryRows,
    customer_profile_summary_rows: customerProfileSummaryRows,
    service_performance_summary_rows: servicePerformanceSummaryRows,
    staff_performance_summary_rows: staffPerformanceSummaryRows,
    availability_snapshot_rows: availabilitySnapshotRows,
  };
}

async function aggregateTenantDay(tenantId: string, date: string): Promise<void> {
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('status, start_at, service_id, tenant_staff_id')
    .eq('tenant_id', tenantId)
    .gte('start_at', startOfDay)
    .lte('start_at', endOfDay);

  if (!reservations) return;
  const reservationRows = reservations as LooseRow[];

  const total = reservationRows.length;
  const completed = reservationRows.filter((r: LooseRow) => r.status === 'completed').length;
  const cancelled = reservationRows.filter((r: LooseRow) => r.status === 'cancelled').length;
  const noShows = reservationRows.filter((r: LooseRow) => r.status === 'no_show').length;

  // Revenue from completed reservations
  const completedIds = reservationRows
    .filter((r: LooseRow) => r.status === 'completed')
    .map((r: LooseRow) => r.service_id)
    .filter(Boolean);

  let revenue = 0;
  if (completedIds.length) {
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id, price')
      .in('id', completedIds);

    const priceMap = Object.fromEntries(
      ((services ?? []) as LooseRow[])
        .filter((service) => typeof service.id === 'string')
        .map((service) => [service.id as string, Number(service.price ?? 0)]),
    ) as Record<string, number>;
    revenue = reservationRows
      .filter((r: LooseRow) => r.status === 'completed')
      .reduce((sum: number, r: LooseRow) => {
        const serviceId = typeof r.service_id === 'string' ? r.service_id : null;
        return sum + Number(serviceId ? priceMap[serviceId] ?? 0 : 0);
      }, 0);
  }

  // Busiest hour
  const hourCounts: Record<number, number> = {};
  for (const r of reservationRows) {
    const startAt = typeof r.start_at === 'string' ? r.start_at : null;
    if (!startAt) continue;
    const hour = new Date(startAt).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }
  const busiestHour = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

  // Top service by booking count
  const serviceCounts: Record<string, number> = {};
  for (const r of reservationRows.filter((r: LooseRow) => typeof r.service_id === 'string')) {
    const serviceId = r.service_id as string;
    serviceCounts[serviceId] = (serviceCounts[serviceId] ?? 0) + 1;
  }
  const topServiceId = Object.entries(serviceCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;

  await supabaseAdmin
    .from('insights_daily')
    .upsert(
      {
        tenant_id: tenantId,
        date,
        total_bookings: total,
        completed,
        cancelled,
        no_shows: noShows,
        revenue,
        busiest_hour: busiestHour ? parseInt(busiestHour, 10) : null,
        top_service_id: topServiceId,
      },
      { onConflict: 'tenant_id,date' }
    );
}

async function aggregateTenantDailySummary(tenantId: string, date: string): Promise<number> {
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('status, service_id, staff_id, tenant_staff_id, start_at')
    .eq('tenant_id', tenantId)
    .gte('start_at', startOfDay)
    .lte('start_at', endOfDay);

  if (!reservations) return 0;
  const reservationRows = reservations as LooseRow[];

  const total = reservationRows.length;
  const completed = reservationRows.filter((r: LooseRow) => r.status === 'completed').length;
  const cancelled = reservationRows.filter((r: LooseRow) => r.status === 'cancelled').length;
  const noShows = reservationRows.filter((r: LooseRow) => r.status === 'no_show').length;

  const serviceIds = reservationRows
    .map((reservation: LooseRow) => reservation.service_id)
    .filter((value): value is string => typeof value === 'string');

  const staffIds = reservationRows
    .map((reservation: LooseRow) => reservation.staff_id)
    .filter((value): value is string => typeof value === 'string');

  const [{ data: services }, { data: staffRows }] = await Promise.all([
    serviceIds.length
      ? supabaseAdmin
          .from('services')
          .select('id, name, price')
          .in('id', serviceIds)
      : Promise.resolve({ data: [] }),
    staffIds.length
      ? supabaseAdmin
          .from('tenant_users')
          .select('id, user_id, name, phone')
      : Promise.resolve({ data: [] }),
  ]);

  const serviceMap = new Map(((services ?? []) as LooseRow[]).map((service: LooseRow) => [service.id, service]));
  const staffMap = new Map(((staffRows ?? []) as LooseRow[]).map((staff: LooseRow) => [staff.id, staff]));

  let estimatedRevenue = 0;
  const serviceCounts = new Map<string, number>();
  const staffCounts = new Map<string, number>();

  for (const reservation of reservationRows) {
    const service = typeof reservation.service_id === 'string'
      ? serviceMap.get(reservation.service_id)
      : null;
    if (reservation.status === 'completed') {
      estimatedRevenue += Number(service?.price ?? 0);
    }

    const serviceName = typeof service?.name === 'string' ? service.name : null;
    if (serviceName) {
      serviceCounts.set(serviceName, (serviceCounts.get(serviceName) ?? 0) + 1);
    }

    const reservationStaffId = typeof reservation.tenant_staff_id === 'string'
      ? reservation.tenant_staff_id
      : typeof reservation.staff_id === 'string'
        ? reservation.staff_id
        : null;
    if (reservationStaffId) {
      const staff = staffMap.get(reservationStaffId) ?? [...staffMap.values()].find((row: LooseRow) => row.user_id === reservationStaffId);
      const staffName = typeof staff?.name === 'string'
        ? staff.name
        : (typeof staff?.phone === 'string' ? staff.phone : reservationStaffId);
      staffCounts.set(staffName, (staffCounts.get(staffName) ?? 0) + 1);
    }
  }

  const topService = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topStaff = [...staffCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  await supabaseAdmin
    .from('tenant_daily_summary')
    .upsert({
      tenant_id: tenantId,
      date,
      bookings_count: total,
      completed_count: completed,
      cancelled_count: cancelled,
      no_show_count: noShows,
      estimated_revenue: estimatedRevenue,
      top_service: topService,
      top_staff: topStaff,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,date' });

  return 1;
}

async function aggregateCustomerProfiles(tenantId: string): Promise<number> {
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .is('merged_into', null);

  if (!customers?.length) return 0;

  for (const customer of customers as Array<{ id: string }>) {
    await recomputeProfile(supabaseAdmin, tenantId, customer.id);
  }

  return customers.length;
}

async function aggregateServicePerformance(tenantId: string): Promise<number> {
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, price')
    .eq('tenant_id', tenantId);

  if (!services?.length) return 0;

  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('service_id, status')
    .eq('tenant_id', tenantId);

  const rows = (services as LooseRow[]).map((service: LooseRow) => {
    const related = ((reservations ?? []) as LooseRow[]).filter((reservation: LooseRow) => reservation.service_id === service.id);
    const bookings = related.length;
    const completed = related.filter((reservation: LooseRow) => reservation.status === 'completed').length;
    const cancellations = related.filter((reservation: LooseRow) => reservation.status === 'cancelled').length;
    const revenue = completed * Number(service.price ?? 0);

    return {
      tenant_id: tenantId,
      service_id: service.id,
      bookings,
      revenue,
      cancellations,
      completion_rate: bookings > 0 ? completed / bookings : 0,
      generated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    await supabaseAdmin
      .from('service_performance_summary')
      .upsert(rows, { onConflict: 'tenant_id,service_id' });
  }

  return rows.length;
}

async function aggregateStaffPerformance(tenantId: string): Promise<number> {
  const { data: staff } = await supabaseAdmin
    .from('tenant_users')
    .select('id, user_id')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff']);

  if (!staff?.length) return 0;

  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('staff_id, tenant_staff_id, service_id, status')
    .eq('tenant_id', tenantId);

  const serviceIds = [...new Set(((reservations ?? []) as LooseRow[]).map((reservation: LooseRow) => reservation.service_id).filter((value): value is string => typeof value === 'string'))];
  const { data: services } = serviceIds.length
      ? await supabaseAdmin
        .from('services')
        .select('id, price')
        .in('id', serviceIds)
    : { data: [] };
  const servicePriceMap = new Map(((services ?? []) as LooseRow[]).map((service: LooseRow) => [service.id, Number(service.price ?? 0)]));

  const rows = (staff as LooseRow[]).map((staffMember: LooseRow) => {
    const related = ((reservations ?? []) as LooseRow[]).filter((reservation: LooseRow) =>
      reservation.tenant_staff_id === staffMember.id ||
      (reservation.tenant_staff_id == null && reservation.staff_id === staffMember.user_id)
    );
    const bookings = related.length;
    const completed = related.filter((reservation: LooseRow) => reservation.status === 'completed').length;
    const estimatedRevenue = related
      .filter((reservation: LooseRow) => reservation.status === 'completed')
      .reduce((sum: number, reservation: LooseRow) => sum + (typeof reservation.service_id === 'string' ? (servicePriceMap.get(reservation.service_id) ?? 0) : 0), 0);

    return {
      tenant_id: tenantId,
      staff_id: staffMember.id,
      bookings,
      completion_rate: bookings > 0 ? completed / bookings : 0,
      estimated_revenue: estimatedRevenue,
      generated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    await supabaseAdmin
      .from('staff_performance_summary')
      .upsert(rows, { onConflict: 'tenant_id,staff_id' });
  }

  return rows.length;
}

async function aggregateAvailabilitySnapshots(tenantId: string, daysAhead: number): Promise<number> {
  const { data: staff } = await supabaseAdmin
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff']);

  if (!staff?.length) return 0;

  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, duration')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (!services?.length) return 0;

  const { data: staffServices } = await supabaseAdmin
    .from('staff_services')
    .select('staff_user_id, service_id')
    .eq('tenant_id', tenantId);

  const serviceMap = new Map<string, number>(
    ((services ?? []) as LooseRow[])
      .filter((service) => typeof service.id === 'string')
      .map((service) => [service.id as string, Number(service.duration ?? 60)]),
  );
  const mappedServicesByStaff = new Map<string, string[]>();
  for (const row of staffServices ?? []) {
    const current = mappedServicesByStaff.get(row.staff_user_id) ?? [];
    current.push(row.service_id);
    mappedServicesByStaff.set(row.staff_user_id, current);
  }

  const rows: Array<Record<string, unknown>> = [];

  for (const staffMember of staff) {
    const serviceIds = mappedServicesByStaff.get(staffMember.id) ?? (services as LooseRow[])
      .map((service: LooseRow) => service.id)
      .filter((serviceId): serviceId is string => typeof serviceId === 'string');
    for (let offset = 0; offset < daysAhead; offset++) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const dateStr = date.toISOString().slice(0, 10);
      const dayContext = await loadAvailabilityDayContext(tenantId, staffMember.id, dateStr);

      for (const serviceId of serviceIds) {
        const availableSlots = calculateAvailabilityForDuration(
          dayContext,
          serviceMap.get(serviceId) ?? 60,
        );

        rows.push({
          tenant_id: tenantId,
          staff_id: staffMember.id,
          service_id: serviceId,
          date: dateStr,
          available_slots: availableSlots,
          generated_at: new Date().toISOString(),
        });
      }
    }
  }

  if (rows.length > 0) {
    for (let index = 0; index < rows.length; index += 500) {
      await supabaseAdmin
        .from('availability_snapshot')
        .upsert(rows.slice(index, index + 500), { onConflict: 'tenant_id,staff_id,service_id,date' });
    }
  }

  return rows.length;
}

async function loadAvailabilityDayContext(
  tenantId: string,
  staffId: string,
  date: string
): Promise<{
  shiftStart: string | null;
  shiftEnd: string | null;
  blockedRanges: Array<{ start: number; end: number }>;
}> {
  const dayOfWeek = new Date(date).getDay();

  const [{ data: tenant }, { data: override }, { data: scheduleRows }, { data: reservations }, { data: locks }] = await Promise.all([
    supabaseAdmin
      .from('tenants')
      .select('buffer_minutes')
      .eq('id', tenantId)
      .maybeSingle(),
    supabaseAdmin
      .from('schedule_overrides')
      .select('is_blocked, custom_start, custom_end')
      .eq('tenant_staff_id', staffId)
      .eq('date', date)
      .maybeSingle(),
    supabaseAdmin
      .from('staff_schedules')
      .select('start_time, end_time, break_start, break_end')
      .eq('tenant_user_id', staffId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true),
    supabaseAdmin
      .from('reservations')
      .select('start_at, end_at')
      .eq('tenant_staff_id', staffId)
      .gte('start_at', `${date}T00:00:00`)
      .lt('start_at', `${date}T23:59:59`)
      .not('status', 'in', '("cancelled","no_show")'),
    supabaseAdmin
      .from('slot_locks')
      .select('start_time, end_time')
      .eq('tenant_staff_id', staffId)
      .eq('date', date)
      .gt('expires_at', new Date().toISOString()),
  ]);

  if (override?.is_blocked) {
    return { shiftStart: null, shiftEnd: null, blockedRanges: [] };
  }
  if (!scheduleRows || scheduleRows.length === 0) {
    return { shiftStart: null, shiftEnd: null, blockedRanges: [] };
  }

  const schedule = scheduleRows[0];
  const shiftStart = override?.custom_start ?? schedule.start_time;
  const shiftEnd = override?.custom_end ?? schedule.end_time;
  if (!shiftStart || !shiftEnd) {
    return { shiftStart: null, shiftEnd: null, blockedRanges: [] };
  }

  const bufferMinutes = tenant?.buffer_minutes ?? 15;
  const blockedRanges: Array<{ start: number; end: number }> = [];

  for (const reservation of reservations ?? []) {
    blockedRanges.push({
      start: timeToMinutes(String(reservation.start_at).slice(11, 16)),
      end: timeToMinutes(String(reservation.end_at).slice(11, 16)) + bufferMinutes,
    });
  }

  for (const lock of locks ?? []) {
    blockedRanges.push({
      start: timeToMinutes(String(lock.start_time)),
      end: timeToMinutes(String(lock.end_time)) + bufferMinutes,
    });
  }

  if (schedule.break_start && schedule.break_end) {
    blockedRanges.push({
      start: timeToMinutes(schedule.break_start),
      end: timeToMinutes(schedule.break_end),
    });
  }

  return { shiftStart, shiftEnd, blockedRanges };
}

function calculateAvailabilityForDuration(
  context: {
    shiftStart: string | null;
    shiftEnd: string | null;
    blockedRanges: Array<{ start: number; end: number }>;
  },
  durationMinutes: number
): string[] {
  if (!context.shiftStart || !context.shiftEnd) return [];

  const slots: string[] = [];
  let current = timeToMinutes(context.shiftStart);
  const shiftEndMinutes = timeToMinutes(context.shiftEnd);

  while (current + durationMinutes <= shiftEndMinutes) {
    const slotEnd = current + durationMinutes;
    const blocked = context.blockedRanges.some((range) => current < range.end && slotEnd > range.start);
    if (!blocked) {
      slots.push(minutesToTime(current));
    }
    current += 30;
  }

  return slots;
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + (minutes ?? 0);
}

function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

// ─── Rebooking engine ─────────────────────────────────────────────────────────

/**
 * Task 2: 3-day follow-up
 *
 * For every completed reservation 3–4 days ago where the service has a
 * rebooking_interval_days value, send a "How are your [service] looking?" message
 * — unless we already sent one (tracked in customers.metadata).
 */
export async function sendRebookingFollowUps(): Promise<number> {
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const fourDaysAgo  = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();

  // Reservations completed 3–4 days ago with a service that has rebooking enabled
  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select(`
      id,
      tenant_id,
      customer_id,
      customer_number,
      start_at,
      service_id,
      services ( name, rebooking_interval_days ),
      tenants ( v2_enabled, metadata, tone_config )
    `)
    .eq('status', 'completed')
    .gte('start_at', fourDaysAgo)
    .lt('start_at', threeDaysAgo)
    .not('service_id', 'is', null);

  if (!reservations?.length) return 0;

  let sent = 0;

  for (const res of reservations) {
    const reservation = res as {
      id: string;
      services?: { name?: string; rebooking_interval_days?: number | null } | null;
      tenants?: { v2_enabled?: boolean; metadata?: Record<string, unknown> | null; tone_config?: Record<string, unknown> | null } | null;
      customer_id?: string | null;
      customer_number?: string | null;
      service_id?: string | null;
      tenant_id: string;
      start_at?: string;
    };
    const service = reservation.services;
    const tenant = reservation.tenants;

    if (!tenant?.v2_enabled) continue;
    if (!service?.rebooking_interval_days) continue;
    const recipientPhone = normalizePhone(reservation.customer_number) ?? reservation.customer_number;
    if (!recipientPhone) continue;
    const serviceId = reservation.service_id as string;

    const { data: customer } = reservation.customer_id
      ? await supabaseAdmin
          .from('customers')
          .select('id, name, customer_name')
          .eq('tenant_id', reservation.tenant_id)
          .eq('id', reservation.customer_id)
          .maybeSingle()
      : { data: null };

    const { data: priorFollowUp } = await supabaseAdmin
      .from('sias_campaign_runs')
      .select('id')
      .eq('tenant_id', reservation.tenant_id)
      .eq('target_phone', recipientPhone)
      .eq('source_event', 'cron.rebooking_followup')
      .contains('metadata', { service_id: serviceId })
      .in('status', ['sent', 'retry_scheduled'])
      .limit(1);

    if (priorFollowUp?.length) continue;

    // Check no newer reservation exists for same customer + service
    const { count: newerCount } = await supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', reservation.tenant_id)
      .eq('customer_number', recipientPhone)
      .eq('service_id', serviceId)
      .gt('start_at', reservation.start_at ?? threeDaysAgo);

    if ((newerCount ?? 0) > 0) continue;

    // Send message via the configured WhatsApp provider
    const client = await getTenantProviderClient(reservation.tenant_id);
    if (!client) continue;

    const serviceName = service.name as string;
    const tenantSettings = normalizeTenantSettings(tenant.metadata, tenant.tone_config);
    const customerName = customer?.name ?? customer?.customer_name ?? '';
    const greeting = String(tenantSettings.ai_personality ?? '').includes('casual')
      ? `How are your ${serviceName} looking? 😊`
      : `Hi${customerName ? ` ${customerName}` : ''}! How are you enjoying your ${serviceName}? 😊`;

    const conv = await loadConversationFlags(reservation.tenant_id, recipientPhone);
    const sendRes = await sendGovernedInitiated(supabaseAdmin as never, {
      tenantId: reservation.tenant_id,
      recipient: recipientPhone,
      messageType: 'rebooking_followup',
      lastInboundAt: conv.last_inbound_at,
      optedOutAt: conv.opted_out_at,
      buildFreeform: () => greeting,
      sendFreeform: async (text) => {
        const branded = await brandCustomerText(
          reservation.tenant_id,
          recipientPhone,
          text,
          { initiated: true, conv },
        );
        if (!branded) return false;
        const response = await client.sendTextMessage(recipientPhone, branded);
        return response.success;
      },
      sendTemplate: async (name, language, paramMapping) => {
        if (!client.sendTemplateMessage) return false;
        const response = await client.sendTemplateMessage(
          recipientPhone,
          name,
          toTemplateParameters(paramMapping),
          language,
        );
        return response.success;
      },
    });

    if (!sendRes.sent) {
      if (sendRes.reason !== 'send_failed') continue;
      console.warn('[cron/nightly] follow-up send failed', { tenant_id: reservation.tenant_id, phone: recipientPhone });
      await siasOperations.recordCampaignRun({
        tenantId: reservation.tenant_id,
        campaignType: 'reactivation',
        action: 'send_reactivation',
        targetPhone: recipientPhone,
        targetBookingId: reservation.id,
        sourceEvent: 'cron.rebooking_followup',
        status: 'retry_scheduled',
        metadata: {
          service_id: serviceId,
          reason: 'follow_up',
        },
        attribution: {
          signal: 'revenue_recovery',
          source_event: 'cron.rebooking_followup',
        },
      });
      continue;
    }

    await siasOperations.recordCampaignRun({
      tenantId: reservation.tenant_id,
      campaignType: 'reactivation',
      action: 'send_reactivation',
      targetPhone: recipientPhone,
      targetBookingId: reservation.id,
      sourceEvent: 'cron.rebooking_followup',
      status: 'sent',
      metadata: {
        service_id: serviceId,
        reason: 'follow_up',
      },
      attribution: {
        signal: 'revenue_recovery',
        source_event: 'cron.rebooking_followup',
      },
    });

    sent++;
  }

  return sent;
}

/**
 * Task 3: Cycle-interval rebooking nudge
 *
 * For every completed reservation older than rebooking_interval_days where the
 * customer has no newer booking for the same service, send a rebooking nudge.
 * Throttled: won't re-send within rebooking_interval_days / 2 days.
 */
export async function sendRebookingNudges(): Promise<number> {
  const now = new Date();

  // Find v2-enabled tenants with at least one service with rebooking enabled
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('v2_enabled', true);

  if (!tenants?.length) return 0;

  let sent = 0;

  for (const tenant of tenants) {
    // Get services with rebooking enabled for this tenant
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id, name, rebooking_interval_days')
      .eq('tenant_id', tenant.id)
      .not('rebooking_interval_days', 'is', null)
      .eq('is_active', true);

    if (!services?.length) continue;

    const client = await getTenantProviderClient(tenant.id);
    if (!client) continue;

    for (const service of services) {
      const intervalDays = service.rebooking_interval_days as number;
      const cutoff = new Date(now.getTime() - intervalDays * 24 * 60 * 60 * 1000).toISOString();

      // Find customers whose last booking for this service is older than the interval
      const { data: reservations } = await supabaseAdmin
        .from('reservations')
        .select('id, customer_id, customer_number, start_at')
        .eq('tenant_id', tenant.id)
        .eq('service_id', service.id)
        .eq('status', 'completed')
        .lt('start_at', cutoff);

      if (!reservations?.length) continue;

      // Deduplicate — take the most recent reservation per customer
      const latestByPhone = new Map<string, (typeof reservations)[number]>();
      for (const r of reservations) {
        const normalizedPhone = normalizePhone(r.customer_number) ?? r.customer_number;
        if (!normalizedPhone) continue;
        const existing = latestByPhone.get(normalizedPhone);
        if (!existing || r.start_at > existing.start_at) {
          latestByPhone.set(normalizedPhone, r);
        }
      }

      for (const [phone, lastRes] of latestByPhone) {
        // Skip if customer has a newer reservation for this service
        const { count: newerCount } = await supabaseAdmin
          .from('reservations')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('customer_number', phone)
          .eq('service_id', service.id)
          .gt('start_at', lastRes.start_at);

        if ((newerCount ?? 0) > 0) continue;

        // Load customer metadata to check throttle
        const { data: customer } = lastRes.customer_id
          ? await supabaseAdmin
              .from('customers')
              .select('name, customer_name')
              .eq('tenant_id', tenant.id)
              .eq('id', lastRes.customer_id)
              .maybeSingle()
          : { data: null };

        const { data: priorNudges } = await supabaseAdmin
          .from('sias_campaign_runs')
          .select('created_at')
          .eq('tenant_id', tenant.id)
          .eq('target_phone', phone)
          .eq('source_event', 'cron.rebooking_nudge')
          .contains('metadata', { service_id: service.id })
          .in('status', ['sent', 'retry_scheduled'])
          .order('created_at', { ascending: false })
          .limit(1);

        const lastNudge = priorNudges?.[0]?.created_at as string | undefined;

        // Throttle: don't re-nudge within interval / 2 days
        if (lastNudge) {
          const throttleDays = Math.ceil(intervalDays / 2);
          const throttleCutoff = new Date(now.getTime() - throttleDays * 24 * 60 * 60 * 1000);
          if (new Date(lastNudge) > throttleCutoff) continue;
        }

        const customerName = customer?.name ?? customer?.customer_name ?? '';
        const nudge = `Hi${customerName ? ` ${customerName}` : ''}! Time for your next ${service.name}? 📅 Reply *BOOK* to get started.`;

        const conv = await loadConversationFlags(tenant.id, phone);
        const sendRes = await sendGovernedInitiated(supabaseAdmin as never, {
          tenantId: tenant.id,
          recipient: phone,
          messageType: 'rebooking_nudge',
          lastInboundAt: conv.last_inbound_at,
          optedOutAt: conv.opted_out_at,
          buildFreeform: () => nudge,
          sendFreeform: async (text) => {
            const branded = await brandCustomerText(tenant.id, phone, text, { initiated: true, conv });
            if (!branded) return false;
            const response = await client.sendTextMessage(phone, branded);
            return response.success;
          },
          sendTemplate: async (name, language, paramMapping) => {
            if (!client.sendTemplateMessage) return false;
            const response = await client.sendTemplateMessage(
              phone,
              name,
              toTemplateParameters(paramMapping),
              language,
            );
            return response.success;
          },
        });

        if (!sendRes.sent) {
          if (sendRes.reason !== 'send_failed') continue;
          console.warn('[cron/nightly] nudge send failed', { tenant_id: tenant.id, phone });
          await siasOperations.recordCampaignRun({
            tenantId: tenant.id,
            campaignType: 'reactivation',
            action: 'send_reactivation',
            targetPhone: phone,
            targetBookingId: lastRes.id,
            sourceEvent: 'cron.rebooking_nudge',
            status: 'retry_scheduled',
            metadata: {
              service_id: service.id,
              interval_days: intervalDays,
            },
            attribution: {
              signal: 'reactivation_lift',
              source_event: 'cron.rebooking_nudge',
            },
          });
          continue;
        }

        await siasOperations.recordCampaignRun({
          tenantId: tenant.id,
          campaignType: 'reactivation',
          action: 'send_reactivation',
          targetPhone: phone,
          targetBookingId: lastRes.id,
          sourceEvent: 'cron.rebooking_nudge',
          status: 'sent',
          metadata: {
            service_id: service.id,
            interval_days: intervalDays,
          },
          attribution: {
            signal: 'reactivation_lift',
            source_event: 'cron.rebooking_nudge',
          },
        });

        sent++;
      }
    }
  }

  return sent;
}

/**
 * Task 5: Weekly owner digest
 */
export async function sendOwnerWeeklyDigest(): Promise<number> {
  if (!isMondayInLagos()) return 0;

  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - 7);
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('v2_enabled', true);

  if (!tenants?.length) return 0;

  let sent = 0;

  for (const tenant of tenants) {
    const ownerPhone = await getTenantOwnerPhone(tenant.id);
    if (!ownerPhone) continue;

    const { data: insights } = await supabaseAdmin
      .from('insights_daily')
      .select('total_bookings, completed, cancelled, no_shows, revenue, top_service_id')
      .eq('tenant_id', tenant.id)
      .gte('date', startStr)
      .lte('date', endStr);

    if (!insights?.length) continue;

    const summary = (insights as LooseRow[]).reduce<WeeklyInsightAccumulator>(
      (acc, row) => {
        acc.totalBookings += Number(row.total_bookings ?? 0);
        acc.completed += Number(row.completed ?? 0);
        acc.cancelled += Number(row.cancelled ?? 0);
        acc.noShows += Number(row.no_shows ?? 0);
        acc.revenue += Number(row.revenue ?? 0);
        const serviceId = row.top_service_id as string | null;
        if (serviceId) {
          acc.topServices.set(serviceId, (acc.topServices.get(serviceId) ?? 0) + 1);
        }
        return acc;
      },
      { totalBookings: 0, completed: 0, cancelled: 0, noShows: 0, revenue: 0, topServices: new Map<string, number>() }
    );

    if (summary.completed <= 0) continue;

    const lostRevenue = await getNoShowRevenue(tenant.id, startStr, endStr);
    const topServiceId = [...summary.topServices.entries()].sort(([, a], [, b]) => b - a)[0]?.[0] ?? null;
    const topServiceName = topServiceId ? await getServiceName(tenant.id, topServiceId) : null;
    const client = await getTenantProviderClient(tenant.id);
    if (!client) continue;

    const message =
      `📊 *Your week at ${tenant.name ?? 'your business'}*\n\n` +
      `✅ Bookings: ${summary.completed} completed\n` +
      `❌ No-shows: ${summary.noShows}${lostRevenue > 0 ? ` (₦${lostRevenue.toLocaleString()} lost)` : ''}\n` +
      `💰 Revenue: ₦${Math.round(summary.revenue).toLocaleString()}\n` +
      `🔁 Top service: ${topServiceName ?? 'N/A'}\n\n` +
      `Reply *INSIGHTS* for more details.`;

    const result = await client.sendTextMessage(ownerPhone, message);
    if (!result.success) continue;
    sent++;
  }

  return sent;
}

/**
 * Task 6: At-risk client re-engagement alert
 */
export async function sendAtRiskClientsAlert(): Promise<number> {
  if (!isMondayInLagos()) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 45);
  const cutoffIso = cutoff.toISOString();

  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id, name')
    .eq('v2_enabled', true);

  if (!tenants?.length) return 0;

  let sent = 0;

  for (const tenant of tenants) {
    const ownerPhone = await getTenantOwnerPhone(tenant.id);
    if (!ownerPhone) continue;

    const { data: completedReservations } = await supabaseAdmin
      .from('reservations')
      .select('customer_id, customer_number, service_id, start_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .lt('start_at', cutoffIso)
      .not('customer_number', 'is', null);

    if (!completedReservations?.length) continue;

    const { data: upcomingReservations } = await supabaseAdmin
      .from('reservations')
      .select('customer_number')
      .eq('tenant_id', tenant.id)
      .gt('start_at', new Date().toISOString())
      .not('customer_number', 'is', null)
      .not('status', 'in', '("cancelled","no_show")');

    const upcomingPhones = new Set(
      ((upcomingReservations ?? []) as LooseRow[])
        .map((row: LooseRow) => normalizePhone(row.customer_number as string | null) ?? (row.customer_number as string | null))
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    );
    const lastCompletedByPhone = new Map<string, { customer_id: string | null; service_id: string | null; start_at: string }>();

    for (const reservation of completedReservations) {
      const phone = normalizePhone(reservation.customer_number as string | null) ?? (reservation.customer_number as string | null);
      if (!phone || upcomingPhones.has(phone)) continue;

      const existing = lastCompletedByPhone.get(phone);
      if (!existing || reservation.start_at > existing.start_at) {
        lastCompletedByPhone.set(phone, {
          customer_id: (reservation.customer_id as string | null) ?? null,
          service_id: (reservation.service_id as string | null) ?? null,
          start_at: reservation.start_at as string,
        });
      }
    }

    const atRisk = [...lastCompletedByPhone.entries()]
      .map(([phone, info]) => ({ phone, ...info }))
      .filter((item) => item.start_at < cutoffIso)
      .sort((a, b) => b.start_at.localeCompare(a.start_at))
      .slice(0, 10);

    if (!atRisk.length) continue;

    const serviceIds = [...new Set(atRisk.map((item) => item.service_id).filter(Boolean) as string[])];
    const serviceNameMap = await getServiceNameMap(serviceIds);
    const customerIds = [...new Set(atRisk.map((item) => item.customer_id).filter(Boolean) as string[])];
    const customerMap = new Map<string, { name: string | null; customer_name: string | null }>();
    if (customerIds.length) {
      const { data: customers } = await supabaseAdmin
        .from('customers')
        .select('id, name, customer_name')
        .in('id', customerIds);
      for (const customer of customers ?? []) {
        customerMap.set(customer.id as string, {
          name: (customer.name as string | null) ?? null,
          customer_name: (customer.customer_name as string | null) ?? null,
        });
      }
    }
    const client = await getTenantProviderClient(tenant.id);
    if (!client) continue;

    const lines = atRisk.map((item) => {
      const visitDate = new Date(item.start_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      });
      const serviceName = item.service_id ? (serviceNameMap.get(item.service_id) ?? 'their service') : 'their service';
      const customer = item.customer_id ? customerMap.get(item.customer_id) : null;
      const customerName = customer?.name ?? customer?.customer_name ?? item.phone;
      return `• ${customerName} — last visit: ${visitDate} (${serviceName})`;
    });

    const message =
      `⚠️ *Clients to re-engage at ${tenant.name ?? 'your business'}*\n\n` +
      `These regulars haven't been back in 45+ days:\n` +
      `${lines.join('\n')}\n\n` +
      `Reply *REACTIVATE* to send them a special offer.`;

    const result = await client.sendTextMessage(ownerPhone, message);
    if (!result.success) continue;
    sent++;
  }

  return sent;
}

/** Test-only: clear the per-tenant provider-client cache between cases. */
export function __resetWhatsAppSendCache(): void {
  WHATSAPP_SEND_CACHE.clear();
}

async function getTenantProviderClient(tenantId: string): Promise<WhatsAppProviderClient | null> {
  const cached = WHATSAPP_SEND_CACHE.get(tenantId);
  if (cached) return cached;

  const promise = (async () => {
    return getTenantWhatsAppProviderClient(tenantId);
  })();

  WHATSAPP_SEND_CACHE.set(tenantId, promise);
  return promise;
}

async function getTenantOwnerPhone(tenantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('phone')
    .eq('tenant_id', tenantId)
    .eq('role', 'owner')
    .maybeSingle();

  return typeof data?.phone === 'string' && data.phone.trim() ? data.phone : null;
}

async function getServiceNameMap(serviceIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!serviceIds.length) return map;

  const { data } = await supabaseAdmin
    .from('services')
    .select('id, name')
    .in('id', serviceIds);

  for (const service of data ?? []) {
    map.set(service.id as string, service.name as string);
  }

  return map;
}

async function getServiceName(tenantId: string, serviceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('services')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', serviceId)
    .maybeSingle();

  return typeof data?.name === 'string' ? data.name : null;
}

async function getNoShowRevenue(tenantId: string, startDate: string, endDate: string): Promise<number> {
  const { data: reservations } = await supabaseAdmin
    .from('reservations')
    .select('service_id, start_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'no_show')
    .gte('start_at', `${startDate}T00:00:00`)
    .lte('start_at', `${endDate}T23:59:59`)
    .not('service_id', 'is', null);

  if (!reservations?.length) return 0;

  const serviceIds = [...new Set((reservations as LooseRow[]).map((row: LooseRow) => row.service_id as string))];
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, price')
    .in('id', serviceIds);

  const priceMap = new Map<string, number>();
  for (const service of services ?? []) {
    priceMap.set(service.id as string, Number(service.price ?? 0));
  }

  return (reservations as LooseRow[]).reduce((sum: number, row: LooseRow) => sum + Number(priceMap.get(row.service_id as string) ?? 0), 0);
}

function isMondayInLagos(): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', weekday: 'long' }).format(new Date()) === 'Monday';
}

// ─── R2 backup ────────────────────────────────────────────────────────────────

function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  );
}

async function runR2Backup(): Promise<Record<string, number>> {
  const date = new Date().toISOString().slice(0, 10);
  const counts: Record<string, number> = {};

  const tables = ['tenants', 'reservations', 'customers', 'tenant_users'] as const;

  for (const table of tables) {
    const { data } = await supabaseAdmin.from(table).select('*');
    if (!data) continue;

    counts[table] = data.length;

    const key = `backups/${date}/${table}.json`;
    await uploadToR2(key, JSON.stringify(data));
  }

  return counts;
}

async function uploadToR2(key: string, body: string): Promise<void> {
  const accountId = process.env.R2_ACCOUNT_ID!;
  const bucket = process.env.R2_BUCKET!;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!;
  const url = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;

  // Simple AWS S3-compatible PUT (R2 uses S3 API)
  // For production, use @aws-sdk/client-s3 or @cloudflare/r2
  // This is a minimal implementation using fetch + HMAC signing
  const date = new Date().toUTCString();
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Date: date,
      // Note: In production, replace with proper AWS Signature V4 signing
      // using @aws-sdk/signature-v4 or similar
      Authorization: `AWS ${accessKeyId}:placeholder-signature`,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`R2 upload failed: ${response.status} ${await response.text()}`);
  }
}
