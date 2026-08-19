import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CFG, type Quality } from './config';
import { computeRiskScore } from './riskScore';

export interface NumberQualityLite {
  phoneNumberId: string;
  quality: Quality;
  limitPer24h: number;
}

export interface GovDecision {
  allow: boolean;
  reason: string;
}

export interface StatsRow {
  tenant_id: string;
  window_start: string;
  sent_24h: number;
  initiated_24h: number;
  initiated_recipients_24h: number;
  recipients_seen: string[];
  cold_outbound_24h: number;
  opt_outs_24h: number;
  failures_24h: number;
  risk_score: number;
  quarantined_until: string | null;
}

export const hashRecipient = (recipient: string) =>
  `h:${createHash('sha256').update(recipient).digest('hex').slice(0, 16)}`;

function windowExpired(start: string, now: number): boolean {
  return now - Date.parse(start) >= CFG.windowMs();
}

function freshStatsRow(tenantId: string, now = Date.now()): StatsRow {
  return {
    tenant_id: tenantId,
    window_start: new Date(now).toISOString(),
    sent_24h: 0,
    initiated_24h: 0,
    initiated_recipients_24h: 0,
    recipients_seen: [],
    cold_outbound_24h: 0,
    opt_outs_24h: 0,
    failures_24h: 0,
    risk_score: 0,
    quarantined_until: null,
  };
}

async function loadOrInit(admin: SupabaseClient, tenantId: string): Promise<StatsRow> {
  const { data } = await admin
    .from('tenant_messaging_stats')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  return data ? (data as StatsRow) : freshStatsRow(tenantId);
}

export function allocationFor(q: NumberQualityLite): number {
  return Math.max(1, Math.floor(q.limitPer24h * CFG.qualityFactor(q.quality) * CFG.tenantWeight()));
}

export async function evaluateSend(
  admin: SupabaseClient,
  tenantId: string,
  q: NumberQualityLite,
  recipient: string,
): Promise<GovDecision> {
  const now = Date.now();
  let row = await loadOrInit(admin, tenantId);
  if (windowExpired(row.window_start, now)) {
    row = freshStatsRow(tenantId, now);
  }

  if (row.quarantined_until && Date.parse(row.quarantined_until) > now) {
    return { allow: false, reason: 'quarantined' };
  }

  const allocation = allocationFor(q);
  const alreadySeen = (row.recipients_seen ?? []).includes(hashRecipient(recipient));
  if (!alreadySeen && row.initiated_recipients_24h >= allocation) {
    return { allow: false, reason: 'allocation_exhausted' };
  }

  const risk = computeRiskScore(
    {
      initiatedRecipients: row.initiated_recipients_24h,
      sent: row.sent_24h,
      initiated: row.initiated_24h,
      cold: row.cold_outbound_24h,
      optOuts: row.opt_outs_24h,
      failures: row.failures_24h,
    },
    allocation,
  );

  if (risk >= CFG.quarantineThreshold()) {
    const until = new Date(now + CFG.quarantineHours() * 3600e3).toISOString();
    await admin.from('tenant_messaging_stats').upsert({
      tenant_id: tenantId,
      risk_score: risk,
      quarantined_until: until,
      updated_at: new Date(now).toISOString(),
    });
    return { allow: false, reason: 'risk_quarantine' };
  }

  return { allow: true, reason: 'ok' };
}

export async function recordSend(
  admin: SupabaseClient,
  tenantId: string,
  event: { recipient: string; initiated: boolean; cold: boolean; failed: boolean },
): Promise<void> {
  const now = Date.now();
  let row = await loadOrInit(admin, tenantId);
  if (windowExpired(row.window_start, now)) {
    row = freshStatsRow(tenantId, now);
  }

  const seen = new Set(row.recipients_seen ?? []);
  const recipientHash = hashRecipient(event.recipient);
  const isNew = event.initiated && !seen.has(recipientHash);

  if (isNew && seen.size < 5000) {
    seen.add(recipientHash);
  }

  await admin.from('tenant_messaging_stats').upsert({
    tenant_id: tenantId,
    window_start: row.window_start,
    sent_24h: row.sent_24h + 1,
    initiated_24h: row.initiated_24h + (event.initiated ? 1 : 0),
    initiated_recipients_24h: row.initiated_recipients_24h + (isNew ? 1 : 0),
    recipients_seen: [...seen],
    cold_outbound_24h: row.cold_outbound_24h + (event.cold ? 1 : 0),
    failures_24h: row.failures_24h + (event.failed ? 1 : 0),
    updated_at: new Date(now).toISOString(),
  });
}
