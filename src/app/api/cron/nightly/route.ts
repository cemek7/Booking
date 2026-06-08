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
import { createClient } from '@supabase/supabase-js';
import { sendTelegramInfo, sendTelegramAlert } from '@/lib/monitoring/telegramAlert';
import { getTenantWhatsAppProviderClient } from '@/lib/whatsapp/providers/providerSelection';
import type { WhatsAppProviderClient } from '@/lib/whatsapp/providers/types';
import { siasOperations } from '@/lib/sias-operations';
import { runDueSiasCampaigns } from '@/lib/siasCampaignRunner';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 300; // 5-minute budget for nightly job

const WHATSAPP_SEND_CACHE = new Map<string, Promise<WhatsAppProviderClient | null>>();

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
    const tenantsAggregated = await aggregateInsights();
    results.insights = { tenants_processed: tenantsAggregated };
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

  const tenantIds = [...new Set((rows ?? []).map((row) => row.tenant_id).filter(Boolean))];
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

// ─── Insights aggregation ─────────────────────────────────────────────────────

async function aggregateInsights(): Promise<number> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // Get all v2-enabled tenants
  const { data: tenants } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('v2_enabled', true);

  if (!tenants?.length) return 0;

  for (const tenant of tenants) {
    await aggregateTenantDay(tenant.id, dateStr);
  }

  return tenants.length;
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

  const total = reservations.length;
  const completed = reservations.filter((r) => r.status === 'completed').length;
  const cancelled = reservations.filter((r) => r.status === 'cancelled').length;
  const noShows = reservations.filter((r) => r.status === 'no_show').length;

  // Revenue from completed reservations
  const completedIds = reservations
    .filter((r) => r.status === 'completed')
    .map((r) => r.service_id)
    .filter(Boolean);

  let revenue = 0;
  if (completedIds.length) {
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id, price_cents')
      .in('id', completedIds);

    const priceMap = Object.fromEntries((services ?? []).map((s) => [s.id, s.price_cents ?? 0]));
    revenue = reservations
      .filter((r) => r.status === 'completed')
      .reduce((sum, r) => sum + Math.round((priceMap[r.service_id] ?? 0) / 100), 0);
  }

  // Busiest hour
  const hourCounts: Record<number, number> = {};
  for (const r of reservations) {
    const hour = new Date(r.start_at).getHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }
  const busiestHour = Object.entries(hourCounts).sort(([, a], [, b]) => b - a)[0]?.[0];

  // Top service by booking count
  const serviceCounts: Record<string, number> = {};
  for (const r of reservations.filter((r) => r.service_id)) {
    serviceCounts[r.service_id] = (serviceCounts[r.service_id] ?? 0) + 1;
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
      customer_phone,
      customer_name,
      service_id,
      services ( name, rebooking_interval_days ),
      tenants ( v2_enabled, settings )
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
      tenants?: { v2_enabled?: boolean; settings?: { ai_personality?: string } | null } | null;
      customer_phone?: string | null;
      customer_name?: string | null;
      service_id?: string | null;
      tenant_id: string;
      start_at?: string;
    };
    const service = reservation.services;
    const tenant = reservation.tenants;

    if (!tenant?.v2_enabled) continue;
    if (!service?.rebooking_interval_days) continue;
    if (!reservation.customer_phone) continue;

    const serviceId = reservation.service_id as string;

    // Check if follow-up was already sent for this customer + service
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id, metadata')
      .eq('tenant_id', reservation.tenant_id)
      .eq('phone', reservation.customer_phone)
      .maybeSingle();

    if (!customer) continue;

    const meta = (customer.metadata ?? {}) as Record<string, unknown>;
    const followupKey = `rebooking_followup_sent_at`;
    const sentMap = (meta[followupKey] ?? {}) as Record<string, string>;
    if (sentMap[serviceId]) continue; // Already sent

    // Check no newer reservation exists for same customer + service
    const { count: newerCount } = await supabaseAdmin
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', reservation.tenant_id)
      .eq('customer_phone', reservation.customer_phone)
      .eq('service_id', serviceId)
      .gt('start_at', reservation.start_at ?? threeDaysAgo);

    if ((newerCount ?? 0) > 0) continue;

    // Send message via the configured WhatsApp provider
    const client = await getTenantProviderClient(reservation.tenant_id);
    if (!client) continue;

    const serviceName = service.name as string;
    const greeting = tenant.settings?.ai_personality?.includes('casual')
      ? `How are your ${serviceName} looking? 😊`
      : `Hi${reservation.customer_name ? ` ${reservation.customer_name}` : ''}! How are you enjoying your ${serviceName}? 😊`;

    const sendRes = await client.sendTextMessage(reservation.customer_phone, greeting);

    if (!sendRes.success) {
      console.warn('[cron/nightly] follow-up send failed', { tenant_id: reservation.tenant_id, phone: reservation.customer_phone });
      await siasOperations.recordCampaignRun({
        tenantId: reservation.tenant_id,
        campaignType: 'reactivation',
        action: 'send_reactivation',
        targetPhone: reservation.customer_phone,
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
      targetPhone: reservation.customer_phone,
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

    // Mark as sent
    sentMap[serviceId] = now.toISOString();
    await supabaseAdmin
      .from('customers')
      .update({ metadata: { ...meta, [followupKey]: sentMap } })
      .eq('id', customer.id);

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
    .select('id, settings')
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
        .select('customer_phone, customer_name, start_at')
        .eq('tenant_id', tenant.id)
        .eq('service_id', service.id)
        .eq('status', 'completed')
        .lt('start_at', cutoff);

      if (!reservations?.length) continue;

      // Deduplicate — take the most recent reservation per customer
      const latestByPhone = new Map<string, (typeof reservations)[number] & { id: string }>();
      for (const r of reservations) {
        if (!r.customer_phone) continue;
        const existing = latestByPhone.get(r.customer_phone);
        if (!existing || r.start_at > existing.start_at) {
          latestByPhone.set(r.customer_phone, r as (typeof reservations)[number] & { id: string });
        }
      }

      for (const [phone, lastRes] of latestByPhone) {
        // Skip if customer has a newer reservation for this service
        const { count: newerCount } = await supabaseAdmin
          .from('reservations')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenant.id)
          .eq('customer_phone', phone)
          .eq('service_id', service.id)
          .gt('start_at', lastRes.start_at);

        if ((newerCount ?? 0) > 0) continue;

        // Load customer metadata to check throttle
        const { data: customer } = await supabaseAdmin
          .from('customers')
          .select('id, metadata')
          .eq('tenant_id', tenant.id)
          .eq('phone', phone)
          .maybeSingle();

        if (!customer) continue;

        const meta = (customer.metadata ?? {}) as Record<string, unknown>;
        const nudgeKey = 'rebooking_nudge_sent_at';
        const nudgeMap = (meta[nudgeKey] ?? {}) as Record<string, string>;
        const lastNudge = nudgeMap[service.id];

        // Throttle: don't re-nudge within interval / 2 days
        if (lastNudge) {
          const throttleDays = Math.ceil(intervalDays / 2);
          const throttleCutoff = new Date(now.getTime() - throttleDays * 24 * 60 * 60 * 1000);
          if (new Date(lastNudge) > throttleCutoff) continue;
        }

        const customerName = lastRes.customer_name ?? '';
        const nudge = `Hi${customerName ? ` ${customerName}` : ''}! Time for your next ${service.name}? 📅 Reply *BOOK* to get started.`;

        const sendRes = await client.sendTextMessage(phone, nudge);

        if (!sendRes.success) {
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

        // Record nudge timestamp
        nudgeMap[service.id] = now.toISOString();
        await supabaseAdmin
          .from('customers')
          .update({ metadata: { ...meta, [nudgeKey]: nudgeMap } })
          .eq('id', customer.id);

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
    .select('id, name, settings')
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

    const summary = insights.reduce(
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
      .select('customer_phone, customer_name, service_id, start_at')
      .eq('tenant_id', tenant.id)
      .eq('status', 'completed')
      .lt('start_at', cutoffIso)
      .not('customer_phone', 'is', null);

    if (!completedReservations?.length) continue;

    const { data: upcomingReservations } = await supabaseAdmin
      .from('reservations')
      .select('customer_phone')
      .eq('tenant_id', tenant.id)
      .gt('start_at', new Date().toISOString())
      .not('customer_phone', 'is', null)
      .not('status', 'in', '("cancelled","no_show")');

    const upcomingPhones = new Set((upcomingReservations ?? []).map((row) => row.customer_phone as string));
    const lastCompletedByPhone = new Map<string, { customer_name: string | null; service_id: string | null; start_at: string }>();

    for (const reservation of completedReservations) {
      const phone = reservation.customer_phone as string | null;
      if (!phone || upcomingPhones.has(phone)) continue;

      const existing = lastCompletedByPhone.get(phone);
      if (!existing || reservation.start_at > existing.start_at) {
        lastCompletedByPhone.set(phone, {
          customer_name: (reservation.customer_name as string | null) ?? null,
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
    const client = await getTenantProviderClient(tenant.id);
    if (!client) continue;

    const lines = atRisk.map((item) => {
      const visitDate = new Date(item.start_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      });
      const serviceName = item.service_id ? (serviceNameMap.get(item.service_id) ?? 'their service') : 'their service';
      const customerName = item.customer_name ?? item.phone;
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

  const serviceIds = [...new Set(reservations.map((row) => row.service_id as string))];
  const { data: services } = await supabaseAdmin
    .from('services')
    .select('id, price_cents')
    .in('id', serviceIds);

  const priceMap = new Map<string, number>();
  for (const service of services ?? []) {
    priceMap.set(service.id as string, Number(service.price_cents ?? 0));
  }

  return reservations.reduce((sum, row) => sum + Math.round((priceMap.get(row.service_id as string) ?? 0) / 100), 0);
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
