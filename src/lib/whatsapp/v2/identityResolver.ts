/**
 * Identity Resolver + Tenant Router
 *
 * Implements the full routing decision tree:
 *
 *   1. Phone already has a whatsapp_conversations row → use stored tenant_id
 *   2. Phone matches tenant_users.phone → owner or staff shortcut
 *   3. Message contains routing code pattern [A-Z]{4}\d{2} → look up tenants
 *   4. Everything else → unknown, needs routing code
 *
 * Returns tenantId, role, and whether a routing code was found in the message.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ConvChannel } from './conversationState';

const supabaseAdmin = createSupabaseAdminClient();

export type ResolvedIdentity = {
  tenantId: string | null;
  role: 'owner' | 'staff' | 'customer' | 'unknown';
  routingCodeFound: boolean;
  strippedMessage: string; // message with routing code removed (if found)
};

const ROUTING_CODE_PATTERN = /\b([A-Z]{4}\d{2})\b/;

export async function resolveIncoming(
  channel: ConvChannel,
  externalId: string,
  messageText: string
): Promise<ResolvedIdentity> {
  const baseResult: ResolvedIdentity = {
    tenantId: null,
    role: 'unknown',
    routingCodeFound: false,
    strippedMessage: messageText.trim(),
  };

  // ── Step 1: Existing conversation (all channels) ──────────────────────────
  // If we already know this externalId+channel belongs to a tenant, use that.
  const { data: existingConvs } = await supabaseAdmin
    .from('whatsapp_conversations')
    .select('tenant_id, role')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .not('tenant_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (existingConvs && existingConvs.length > 0) {
    const conv = existingConvs[0];
    // Role may be overridden below if phone is in tenant_users (WhatsApp only)
    let resolvedRole = (conv.role as ResolvedIdentity['role']) ?? 'customer';

    if (channel === 'whatsapp') {
      // Check if phone is actually an owner/staff (takes precedence over stored role)
      const staffRole = await resolveStaffRole(externalId, conv.tenant_id);
      if (staffRole) resolvedRole = staffRole;
    }

    return {
      ...baseResult,
      tenantId: conv.tenant_id,
      role: resolvedRole,
    };
  }

  // ── WhatsApp-only: owner/staff phone shortcut + routing code ──────────────
  if (channel === 'whatsapp') {
    // Check if this phone belongs to an owner or staff member regardless of message
    const staffResult = await resolveByPhone(externalId);
    if (staffResult) return { ...baseResult, ...staffResult };

    // Routing code in message
    const codeMatch = messageText.match(ROUTING_CODE_PATTERN);
    if (codeMatch) {
      const code = codeMatch[1];
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .eq('routing_code', code)
        .eq('v2_enabled', true)
        .maybeSingle();

      if (tenant) {
        const stripped = messageText.replace(codeMatch[0], '').trim();
        return {
          tenantId: tenant.id,
          role: 'customer',
          routingCodeFound: true,
          strippedMessage: stripped || messageText.trim(),
        };
      }
    }
  }

  // ── No match ───────────────────────────────────────────────────────────────
  return baseResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveByPhone(
  phone: string
): Promise<Omit<ResolvedIdentity, 'strippedMessage'> | null> {
  const { data: staffRow } = await supabaseAdmin
    .from('tenant_users')
    .select('tenant_id, role')
    .eq('phone', phone)
    .in('role', ['owner', 'staff', 'manager'])
    .maybeSingle();

  if (!staffRow) return null;

  return {
    tenantId: staffRow.tenant_id,
    role: staffRow.role as 'owner' | 'staff',
    routingCodeFound: false,
  };
}

async function resolveStaffRole(
  phone: string,
  tenantId: string
): Promise<'owner' | 'staff' | null> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('role')
    .eq('phone', phone)
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff', 'manager'])
    .maybeSingle();

  if (!data) return null;
  return data.role === 'owner' ? 'owner' : 'staff';
}

// ─── Routing code generator ───────────────────────────────────────────────────

/**
 * Generates a unique 6-char routing code for a tenant.
 * Format: first 4 letters of business name (uppercase) + 2-digit suffix.
 * Checks uniqueness before returning.
 */
export async function generateRoutingCode(businessName: string): Promise<string> {
  const prefix = businessName
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, 'X');

  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = String(Math.floor(Math.random() * 100)).padStart(2, '0');
    const code = `${prefix}${suffix}`;

    const { data: existing } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('routing_code', code)
      .maybeSingle();

    if (!existing) return code;
  }

  // Fallback: full random alphanumeric (extremely rare)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
