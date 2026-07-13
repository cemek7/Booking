// src/lib/whatsapp/v2/outboundBranding.ts
/**
 * I/O seam between the pipeline's outbound paths and the pure brand logic.
 * Loads tenant brand fields + conversation flags, applies the opt-out gate,
 * and returns the branded text — or null when the send should be SKIPPED
 * (an initiated message to an opted-out customer).
 */
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  resolveBrandContext,
  applyBrandIdentity,
  type TenantBrandFields,
  type ConversationBrandFields,
} from './brandIdentity';
import { isOptedOut } from './optOut';

const supabaseAdmin = createSupabaseAdminClient();

type ConvFlags = ConversationBrandFields & { opted_out_at: string | null };

export interface BrandOpts {
  initiated: boolean;
  /** Pass the already-loaded conversation to preserve read-before-write of last_inbound_at. */
  conv?: ConvFlags | null;
  now?: Date;
}

export async function brandCustomerText(
  tenantId: string,
  phone: string,
  reply: string,
  opts: BrandOpts
): Promise<string | null> {
  const now = opts.now ?? new Date();

  let conv: ConvFlags = opts.conv ?? { last_inbound_at: null, opted_out_at: null };
  if (!opts.conv) {
    const { data } = await supabaseAdmin
      .from('whatsapp_conversations')
      .select('last_inbound_at, opted_out_at')
      .eq('tenant_id', tenantId)
      .eq('phone_number', phone)
      .maybeSingle();
    if (data) conv = data as ConvFlags;
  }

  // Opt-out blocks business-initiated sends only; inbound replies always go through.
  if (opts.initiated && isOptedOut(conv)) return null;

  const { data: tenant } = await supabaseAdmin
    .from('tenants')
    .select('name, display_name, brand_emoji, previous_names, renamed_at')
    .eq('id', tenantId)
    .maybeSingle();

  if (!tenant) return reply; // fail-open: send unbranded rather than drop the message

  const ctx = resolveBrandContext(tenant as TenantBrandFields, conv, {
    initiated: opts.initiated,
    now,
  });
  return applyBrandIdentity(reply, ctx);
}
