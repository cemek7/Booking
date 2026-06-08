// src/lib/whatsapp/v2/brandIdentity.ts
/**
 * Pure brand-identity logic for customer-facing WhatsApp messages.
 * No I/O — fully unit-testable. The I/O seam lives in outboundBranding.ts.
 */

export interface TenantBrandFields {
  name: string;
  display_name: string | null;
  brand_emoji: string | null;
  previous_names: Array<{ name: string; renamed_at: string }> | null;
  renamed_at: string | null;
}

export interface ConversationBrandFields {
  last_inbound_at: string | null;
}

export interface BrandContext {
  displayName: string;
  emoji: string | null;
  previousName: string | null;
  stampHeader: boolean;
}

export interface ResolveOpts {
  initiated: boolean;
  now: Date;
  sessionGapMs?: number;
}

const DEFAULT_SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const FOOTER = '— automated assistant · reply STOP to opt out';

export function resolveBrandContext(
  tenant: TenantBrandFields,
  conv: ConversationBrandFields,
  opts: ResolveOpts
): BrandContext {
  const displayName = tenant.display_name ?? tenant.name;
  const emoji = tenant.brand_emoji ?? null;
  const sessionGap = opts.sessionGapMs ?? DEFAULT_SESSION_GAP_MS;

  const lastInbound = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : null;
  const isSessionOpen = lastInbound === null || opts.now.getTime() - lastInbound > sessionGap;
  const stampHeader = opts.initiated || isSessionOpen;

  let previousName: string | null = null;
  if (
    tenant.renamed_at &&
    Array.isArray(tenant.previous_names) &&
    tenant.previous_names.length > 0 &&
    lastInbound !== null &&
    lastInbound < new Date(tenant.renamed_at).getTime()
  ) {
    previousName = tenant.previous_names[tenant.previous_names.length - 1].name;
  }

  return { displayName, emoji, previousName, stampHeader };
}

export function applyBrandIdentity(reply: string, ctx: BrandContext): string {
  if (!ctx.stampHeader) return reply;

  // Idempotency guard — already branded (e.g. retry).
  if (reply.startsWith(`*${ctx.displayName}*`)) return reply;

  const header = ctx.emoji ? `*${ctx.displayName}* ${ctx.emoji}` : `*${ctx.displayName}*`;
  const lines: string[] = [header];
  if (ctx.previousName) lines.push(`_(formerly ${ctx.previousName})_`);
  lines.push('', reply, '', `_${FOOTER}_`);
  return lines.join('\n');
}
