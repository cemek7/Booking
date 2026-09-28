/**
 * Identity Resolver + Tenant Router
 *
 * Implements the full routing decision tree:
 *
 * Tenant routing is deliberately completed before this module is called. This
 * resolver may determine the role/customer identity inside one tenant, but it
 * must never choose or change the tenant from conversation history or text.
 *
 * Returns tenantId, role, and whether a routing code was found in the message.
 */

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ConvChannel } from './conversationState';

const supabaseAdmin = createSupabaseAdminClient();

export type ResolvedIdentity = {
  tenantId: string | null;
  role: 'owner' | 'staff' | 'customer' | 'unknown';
  tenantUserId: string | null;
  userId: string | null;
  routingCodeFound: boolean;
  strippedMessage: string; // message with routing code removed (if found)
};

export async function resolveIncoming(
  channel: ConvChannel,
  externalId: string,
  messageText: string,
  routedTenantId: string
): Promise<ResolvedIdentity> {
  const baseResult: ResolvedIdentity = {
    tenantId: routedTenantId,
    role: 'customer',
    tenantUserId: null,
    userId: null,
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
    .eq('tenant_id', routedTenantId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (existingConvs && existingConvs.length > 0) {
    const conv = existingConvs[0];
    // Role may be overridden below if phone is in tenant_users (WhatsApp only)
    let resolvedRole = (conv.role as ResolvedIdentity['role']) ?? 'customer';

    if (channel === 'whatsapp') {
      // Check if phone is actually an owner/staff (takes precedence over stored role)
      const staffIdentity = await resolveStaffRole(externalId, routedTenantId);
      if (staffIdentity) {
        resolvedRole = staffIdentity.role;
        return {
          ...baseResult,
          tenantId: routedTenantId,
          role: resolvedRole,
          tenantUserId: staffIdentity.tenantUserId,
          userId: staffIdentity.userId,
        };
      }
    }

    return {
      ...baseResult,
      tenantId: routedTenantId,
      role: resolvedRole,
    };
  }

  // ── WhatsApp-only: owner/staff phone shortcut inside the routed tenant ───
  if (channel === 'whatsapp') {
    const staffResult = await resolveByPhone(externalId, routedTenantId);
    if (staffResult) return { ...baseResult, ...staffResult };
  }

  // A new customer in an already-routed tenant is still a valid identity.
  return baseResult;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveByPhone(
  phone: string,
  tenantId: string
): Promise<Omit<ResolvedIdentity, 'strippedMessage'> | null> {
  const { data: staffRow } = await supabaseAdmin
    .from('tenant_users')
    .select('id, user_id, tenant_id, role')
    .eq('phone', phone)
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff', 'manager'])
    .maybeSingle();

  if (!staffRow) return null;

  return {
    tenantId: staffRow.tenant_id,
    role: staffRow.role === 'owner' ? 'owner' : 'staff',
    tenantUserId: staffRow.id ?? null,
    userId: staffRow.user_id ?? null,
    routingCodeFound: false,
  };
}

async function resolveStaffRole(
  phone: string,
  tenantId: string
): Promise<{ role: 'owner' | 'staff'; tenantUserId: string | null; userId: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('tenant_users')
    .select('id, user_id, role')
    .eq('phone', phone)
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'staff', 'manager'])
    .maybeSingle();

  if (!data) return null;
  return {
    role: data.role === 'owner' ? 'owner' : 'staff',
    tenantUserId: data.id ?? null,
    userId: data.user_id ?? null,
  };
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
