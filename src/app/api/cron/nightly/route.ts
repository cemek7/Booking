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

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 300; // 5-minute budget for nightly job

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

  // ── Task 4: R2 backup (optional) ───────────────────────────────────────────
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

  await sendTelegramInfo(`Nightly cron complete ✅\n${JSON.stringify(results, null, 2)}`);

  return NextResponse.json(results);
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
async function sendRebookingFollowUps(): Promise<number> {
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
    const service = (res as any).services;
    const tenant  = (res as any).tenants;

    if (!tenant?.v2_enabled) continue;
    if (!service?.rebooking_interval_days) continue;
    if (!res.customer_phone) continue;

    const serviceId = res.service_id as string;

    // Check if follow-up was already sent for this customer + service
    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('id, metadata')
      .eq('tenant_id', res.tenant_id)
      .eq('phone', res.customer_phone)
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
      .eq('tenant_id', res.tenant_id)
      .eq('customer_phone', res.customer_phone)
      .eq('service_id', serviceId)
      .gt('start_at', (res as any).start_at ?? threeDaysAgo);

    if ((newerCount ?? 0) > 0) continue;

    // Send message via Evolution API
    const { data: waConfig } = await supabaseAdmin
      .from('whatsapp_configs')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', res.tenant_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!waConfig) continue;

    const serviceName = service.name as string;
    const greeting = tenant.settings?.ai_personality?.includes('casual')
      ? `How are your ${serviceName} looking? 😊`
      : `Hi${res.customer_name ? ` ${res.customer_name}` : ''}! How are you enjoying your ${serviceName}? 😊`;

    const sendUrl = `${waConfig.api_url}/message/sendText/${waConfig.instance_name}`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: waConfig.api_key },
      body: JSON.stringify({ number: res.customer_phone, text: greeting }),
    });

    if (!sendRes.ok) {
      console.warn('[cron/nightly] follow-up send failed', { tenant_id: res.tenant_id, phone: res.customer_phone });
      continue;
    }

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
async function sendRebookingNudges(): Promise<number> {
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

    const { data: waConfig } = await supabaseAdmin
      .from('whatsapp_configs')
      .select('instance_name, api_url, api_key')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!waConfig) continue;

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
      const latestByPhone = new Map<string, (typeof reservations)[number]>();
      for (const r of reservations) {
        if (!r.customer_phone) continue;
        const existing = latestByPhone.get(r.customer_phone);
        if (!existing || r.start_at > existing.start_at) {
          latestByPhone.set(r.customer_phone, r);
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

        const sendRes = await fetch(
          `${waConfig.api_url}/message/sendText/${waConfig.instance_name}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: waConfig.api_key },
            body: JSON.stringify({ number: phone, text: nudge }),
          }
        );

        if (!sendRes.ok) {
          console.warn('[cron/nightly] nudge send failed', { tenant_id: tenant.id, phone });
          continue;
        }

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
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!;

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
