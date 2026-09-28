import { createSupabaseAdminClient } from '@/lib/supabase/server';

const ROUTING_CODE_PATTERN = /\b([A-Z]{4}\d{2})\b/i;
const ROUTE_TTL_MS = 24 * 60 * 60 * 1000;

export type RouteDecision =
  | { status: 'routed'; tenantId: string; source: 'routing_code' | 'session' | 'dedicated_number'; strippedMessage: string }
  | { status: 'needs_code'; strippedMessage: string };

export interface RouteSessionStore {
  findEnabledTenantByRoutingCode(code: string): Promise<string | null>;
  findActiveSession(input: {
    channel: 'whatsapp'; gatewayScope: string; externalId: string; now: Date;
  }): Promise<{ tenantId: string; expiresAt: string } | null>;
  upsertSession(input: {
    tenantId: string; channel: 'whatsapp'; gatewayScope: string; externalId: string;
    source: 'routing_code'; expiresAt: string; routedAt: string;
  }): Promise<void>;
}

function createRouteSessionStore(): RouteSessionStore {
  const admin = createSupabaseAdminClient();
  return {
    async findEnabledTenantByRoutingCode(code) {
      const { data, error } = await admin.from('tenants').select('id')
        .eq('routing_code', code).eq('v2_enabled', true).maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    async findActiveSession({ channel, gatewayScope, externalId, now }) {
      const { data, error } = await admin.from('shared_channel_route_sessions')
        .select('tenant_id, expires_at')
        .eq('channel', channel)
        .eq('gateway_scope', gatewayScope)
        .eq('external_id', externalId)
        .gt('expires_at', now.toISOString())
        .maybeSingle();
      if (error) throw error;
      return data ? { tenantId: data.tenant_id, expiresAt: data.expires_at } : null;
    },
    async upsertSession(input) {
      const { error } = await admin.from('shared_channel_route_sessions').upsert({
        tenant_id: input.tenantId,
        channel: input.channel,
        gateway_scope: input.gatewayScope,
        external_id: input.externalId,
        source: input.source,
        expires_at: input.expiresAt,
        last_routed_at: input.routedAt,
        updated_at: input.routedAt,
      }, { onConflict: 'channel,gateway_scope,external_id' });
      if (error) throw error;
    },
  };
}

export async function resolveWhatsAppRoute(
  input: {
    externalId: string;
    gatewayPhoneNumberId: string;
    messageText: string;
    dedicatedTenantId?: string | null;
    now?: Date;
  },
  store: RouteSessionStore = createRouteSessionStore(),
): Promise<RouteDecision> {
  const now = input.now ?? new Date();
  const trimmed = input.messageText.trim();
  const codeMatch = trimmed.match(ROUTING_CODE_PATTERN);

  if (codeMatch) {
    const tenantId = await store.findEnabledTenantByRoutingCode(codeMatch[1].toUpperCase());
    if (tenantId) {
      const expiresAt = new Date(now.getTime() + ROUTE_TTL_MS).toISOString();
      await store.upsertSession({
        tenantId,
        channel: 'whatsapp',
        gatewayScope: input.gatewayPhoneNumberId,
        externalId: input.externalId,
        source: 'routing_code',
        expiresAt,
        routedAt: now.toISOString(),
      });
      const stripped = trimmed.replace(codeMatch[0], '').trim();
      return { status: 'routed', tenantId, source: 'routing_code', strippedMessage: stripped || trimmed };
    }
  }

  if (input.dedicatedTenantId) {
    return {
      status: 'routed', tenantId: input.dedicatedTenantId,
      source: 'dedicated_number', strippedMessage: trimmed,
    };
  }

  const session = await store.findActiveSession({
    channel: 'whatsapp', gatewayScope: input.gatewayPhoneNumberId,
    externalId: input.externalId, now,
  });
  if (session) {
    return { status: 'routed', tenantId: session.tenantId, source: 'session', strippedMessage: trimmed };
  }

  return { status: 'needs_code', strippedMessage: trimmed };
}
