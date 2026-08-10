export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getStoredProviderApiKey, upsertStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';
import { subscribeMetaWaba, verifyMetaPhone, verifyMetaPhoneBelongsToWaba } from '@/lib/whatsapp/metaConnectionValidation';

const CompletionSchema = z.object({
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  businessAccountId: z.string().min(1).optional(),
});

const DirectConnectionSchema = z.object({
  connectionSource: z.literal('direct'),
  accessToken: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
  businessAccountId: z.string().min(1).optional(),
  tokenExpiresAt: z.string().datetime().optional(),
});

function metaApiConfig() {
  const baseUrl = (process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com').replace(/\/+$/, '');
  const version = process.env.WHATSAPP_API_VERSION || 'v18.0';
  return { apiBase: `${baseUrl}/${version}` };
}

function metaConfig() {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || process.env.WHATSAPP_APP_SECRET || '';
  if (!appId || !appSecret) return null;
  return { appId, appSecret, ...metaApiConfig() };
}

async function exchangeCode(config: NonNullable<ReturnType<typeof metaConfig>>, code: string): Promise<{ accessToken: string; expiresAt: string | null }> {
  const params = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
  });
  const response = await fetchWithTimeout(`${config.apiBase}/oauth/access_token?${params.toString()}`, {
    timeoutMs: 15_000,
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
  if (!response.ok || !body.access_token) {
    throw new Error(body.error?.message || `Meta token exchange failed (${response.status})`);
  }
  return {
    accessToken: body.access_token,
    expiresAt: typeof body.expires_in === 'number' ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
  };
}

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    if (ctx.user!.role !== 'superadmin' && ctx.user!.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const { data, error } = await ctx.supabase
      .from('whatsapp_configurations')
      .select('provider, active, meta_connection_source, meta_connection_status, meta_billing_owner, meta_phone_number_id, meta_waba_id, meta_connected_at, meta_disconnected_at, meta_last_error, meta_last_validated_at')
      .eq('tenant_id', tenantId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (error) throw ApiErrorFactory.databaseError(error);

    return {
      configured: Boolean(metaConfig()),
      // These are Meta public identifiers, not secrets. Returning them from an
      // authenticated endpoint keeps the browser configuration available when
      // deployment secrets are injected after the Next.js image is built.
      embeddedSignup: process.env.META_APP_ID && process.env.META_EMBEDDED_SIGNUP_CONFIG_ID
        ? { appId: process.env.META_APP_ID, configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID }
        : null,
      connection: data ?? null,
      billing: {
        owner: 'client',
        note: 'Meta may charge the tenant directly for eligible business template messages. Booka does not collect payment-card details.',
      },
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    if (ctx.user!.role !== 'superadmin' && ctx.user!.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const requestBody = await parseJsonBody<Record<string, unknown>>(ctx.request);
    const direct = DirectConnectionSchema.safeParse(requestBody);
    if (direct.success) {
      if (ctx.user!.role !== 'superadmin') {
        throw ApiErrorFactory.forbidden('Direct Meta connections are restricted to Booka support administrators');
      }

      const admin = createSupabaseAdminClient();
      const now = new Date().toISOString();
      const config = metaApiConfig();
      const { accessToken, wabaId, phoneNumberId, businessAccountId, tokenExpiresAt } = direct.data;
      try {
        await verifyMetaPhone(config, phoneNumberId, accessToken);
        await verifyMetaPhoneBelongsToWaba(config, wabaId, phoneNumberId, accessToken);
        await subscribeMetaWaba(config, wabaId, accessToken);
        const { error: configError } = await admin.from('whatsapp_configurations').upsert({
          tenant_id: tenantId,
          instance_name: phoneNumberId,
          evolution_base_url: process.env.EVOLUTION_API_BASE || 'http://localhost:8080',
          evolution_api_key: '',
          provider: 'meta',
          provider_base_url: config.apiBase,
          provider_api_key: null,
          meta_phone_number_id: phoneNumberId,
          meta_waba_id: wabaId,
          meta_business_account_id: businessAccountId ?? null,
          meta_connection_source: 'direct',
          meta_connection_status: 'connected',
          meta_billing_owner: 'client',
          meta_connected_at: now,
          meta_disconnected_at: null,
          meta_webhook_subscribed_at: now,
          meta_last_validated_at: now,
          meta_last_error: null,
          active: true,
          updated_at: now,
        }, { onConflict: 'tenant_id' });
        if (configError) throw configError;

        await upsertStoredProviderApiKey(admin, tenantId, 'meta', accessToken);
        const { error: secretError } = await admin.from('whatsapp_provider_secrets')
          .update({ token_expires_at: tokenExpiresAt ?? null, last_validated_at: now, revoked_at: null })
          .eq('tenant_id', tenantId).eq('provider', 'meta');
        if (secretError) throw secretError;

        await admin.from('tenant_meta_connection_events').insert({
          tenant_id: tenantId,
          event_type: 'connection_connected',
          connection_source: 'direct',
          actor_user_id: ctx.user!.id,
          meta_waba_id: wabaId,
          meta_phone_number_id: phoneNumberId,
          metadata: { billing_owner: 'client', webhook_subscribed: true },
        });
        return { status: 'connected', connectionSource: 'direct', phoneNumberId, wabaId, billingOwner: 'client' };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Meta direct connection failed';
        await admin.from('whatsapp_configurations').update({
          meta_connection_source: 'direct', meta_connection_status: 'failed', meta_last_error: message.slice(0, 500), updated_at: now,
        }).eq('tenant_id', tenantId).eq('provider', 'meta');
        await admin.from('tenant_meta_connection_events').insert({
          tenant_id: tenantId, event_type: 'connection_failed', connection_source: 'direct', actor_user_id: ctx.user!.id,
          metadata: { reason: message.slice(0, 500) },
        });
        throw ApiErrorFactory.internalServerError(new Error(message));
      }
    }

    const parsed = CompletionSchema.safeParse(requestBody);
    if (!parsed.success) throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    const config = metaConfig();
    if (!config) throw ApiErrorFactory.internalServerError(new Error('Meta Embedded Signup is not configured on this environment'));

    // The caller has already passed the tenant/role check above. Credentials and
    // provisioning events are deliberately service-role-only, so do not attempt
    // to write them through the caller-scoped Supabase client.
    const admin = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const { code, wabaId, phoneNumberId, businessAccountId } = parsed.data;
    try {
      const { accessToken, expiresAt } = await exchangeCode(config, code);
      await verifyMetaPhone(config, phoneNumberId, accessToken);
      await verifyMetaPhoneBelongsToWaba(config, wabaId, phoneNumberId, accessToken);
      await subscribeMetaWaba(config, wabaId, accessToken);

      const { error: configError } = await admin
        .from('whatsapp_configurations')
        .upsert({
          tenant_id: tenantId,
          instance_name: phoneNumberId,
          evolution_base_url: process.env.EVOLUTION_API_BASE || 'http://localhost:8080',
          evolution_api_key: '',
          provider: 'meta',
          provider_base_url: config.apiBase,
          provider_api_key: null,
          meta_phone_number_id: phoneNumberId,
          meta_waba_id: wabaId,
          meta_business_account_id: businessAccountId ?? null,
          meta_connection_source: 'embedded_signup',
          meta_connection_status: 'connected',
          meta_billing_owner: 'client',
          meta_connected_at: now,
          meta_disconnected_at: null,
          meta_webhook_subscribed_at: now,
          meta_last_validated_at: now,
          meta_last_error: null,
          active: true,
          updated_at: now,
        }, { onConflict: 'tenant_id' });
      if (configError) throw configError;

      await upsertStoredProviderApiKey(admin, tenantId, 'meta', accessToken);
      const { error: secretError } = await admin
        .from('whatsapp_provider_secrets')
        .update({ token_expires_at: expiresAt, last_validated_at: now, revoked_at: null })
        .eq('tenant_id', tenantId)
        .eq('provider', 'meta');
      if (secretError) throw secretError;

      await admin.from('tenant_meta_connection_events').insert({
        tenant_id: tenantId,
        event_type: 'connection_connected',
        connection_source: 'embedded_signup',
        actor_user_id: ctx.user!.id,
        meta_waba_id: wabaId,
        meta_phone_number_id: phoneNumberId,
        metadata: { billing_owner: 'client', webhook_subscribed: true },
      });

      return { status: 'connected', phoneNumberId, wabaId, billingOwner: 'client' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Meta connection failed';
      await admin.from('whatsapp_configurations').update({
        meta_connection_source: 'embedded_signup',
        meta_connection_status: 'failed',
        meta_last_error: message.slice(0, 500),
        updated_at: now,
      }).eq('tenant_id', tenantId).eq('provider', 'meta');
      await admin.from('tenant_meta_connection_events').insert({
        tenant_id: tenantId,
        event_type: 'connection_failed',
        connection_source: 'embedded_signup',
        actor_user_id: ctx.user!.id,
        metadata: { reason: message.slice(0, 500) },
      });
      throw ApiErrorFactory.internalServerError(new Error(message));
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);

export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    if (ctx.user!.role !== 'superadmin' && ctx.user!.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');

    const admin = createSupabaseAdminClient();
    const { data: connection, error } = await admin
      .from('whatsapp_configurations')
      .select('meta_waba_id, meta_connection_source, provider, active')
      .eq('tenant_id', tenantId)
      .eq('provider', 'meta')
      .maybeSingle();
    if (error) throw ApiErrorFactory.databaseError(error);
    if (!connection) return { status: 'disconnected', alreadyDisconnected: true };

    const now = new Date().toISOString();
    const token = await getStoredProviderApiKey(admin, tenantId, 'meta');
    let unsubscribed = false;
    let unsubscribeWarning: string | null = null;
    if (connection.meta_waba_id && token) {
      try {
        const response = await fetchWithTimeout(
          `${metaApiConfig().apiBase}/${encodeURIComponent(connection.meta_waba_id)}/subscribed_apps`,
          { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 }
        );
        unsubscribed = response.ok;
        if (!response.ok) unsubscribeWarning = `Meta webhook unsubscribe failed (${response.status})`;
      } catch {
        unsubscribeWarning = 'Meta webhook unsubscribe could not be confirmed';
      }
    }

    const { error: updateError } = await admin.from('whatsapp_configurations').update({
      active: false,
      meta_connection_status: 'disconnected',
      meta_disconnected_at: now,
      meta_last_error: unsubscribeWarning,
      updated_at: now,
    }).eq('tenant_id', tenantId).eq('provider', 'meta');
    if (updateError) throw ApiErrorFactory.databaseError(updateError);

    const { error: revokeError } = await admin.from('whatsapp_provider_secrets').update({
      api_key: null,
      encrypted_api_key: null,
      encryption_iv: null,
      encryption_key_version: null,
      token_expires_at: null,
      revoked_at: now,
      updated_at: now,
    }).eq('tenant_id', tenantId).eq('provider', 'meta');
    if (revokeError) throw ApiErrorFactory.databaseError(revokeError);

    await admin.from('tenant_meta_connection_events').insert({
      tenant_id: tenantId,
      event_type: 'connection_disconnected',
      connection_source: connection.meta_connection_source === 'embedded_signup' ? 'embedded_signup' : 'direct',
      actor_user_id: ctx.user!.id,
      metadata: { webhook_unsubscribed: unsubscribed, unsubscribe_warning: unsubscribeWarning },
    });

    return { status: 'disconnected', unsubscribed, warning: unsubscribeWarning };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager', 'superadmin'] }
);
