export const dynamic = 'force-dynamic';
import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { defaultLogger } from '@/lib/logger';
import { getProviderClient } from '@/lib/whatsapp/providers';
import { whatsappConnectionManager } from '@/lib/whatsapp/connectionManager';
import { getStoredProviderApiKey, upsertStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';
import { suggestEmojiForVertical } from '@/lib/whatsapp/v2/tenantBrand';
import {
  buildProviderWebhookUrl,
  ensureTenantWahaProvisioning,
  isAllowedWahaBaseUrl,
  resolveWahaRuntimeConfig,
} from '@/lib/whatsapp/wahaProvisioning';

function resolveMetaGraphBase(baseUrl: string, apiVersion: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/v\d+(\.\d+)?$/i.test(normalized)) return normalized;
  return `${normalized}/${apiVersion}`;
}

async function activateV2(tenantId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('id, name, routing_code, v2_enabled, brand_emoji, settings')
    .eq('id', tenantId)
    .maybeSingle();
  const updates: Record<string, unknown> = { v2_enabled: true, updated_at: new Date().toISOString() };
  if (!tenantRow?.routing_code && tenantRow?.name) {
    const { generateRoutingCode } = await import('@/lib/whatsapp/v2/identityResolver');
    updates.routing_code = await generateRoutingCode(tenantRow.name);
  }
  // Default the customer-facing brand emoji from the tenant's vertical when unset.
  // Header still works without it; the owner can override later.
  if (!tenantRow?.brand_emoji) {
    const vertical = (tenantRow?.settings as { vertical?: string | null } | null)?.vertical;
    const emoji = suggestEmojiForVertical(vertical);
    if (emoji) updates.brand_emoji = emoji;
  }
  await admin.from('tenants').update(updates).eq('id', tenantId);
}

const ConnectBodySchema = z.object({
  instanceName: z.string().optional(),
  provider:     z.enum(['evolution', 'waha', 'meta']).optional(),
  phoneNumber:  z.string().optional(),
  metaPhoneNumberId: z.string().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const rawBody = await ctx.request.json().catch(() => ({}));
    const parsed = ConnectBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }
    const body = parsed.data;

    const admin = createSupabaseAdminClient();
    const { data: existingConfig } = await admin
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .maybeSingle();

    const defaultProvider: 'evolution' | 'waha' | 'meta' =
      process.env.DEFAULT_WHATSAPP_PROVIDER === 'waha'
        ? 'waha'
        : process.env.DEFAULT_WHATSAPP_PROVIDER === 'meta'
        ? 'meta'
        : 'evolution';
    const effectiveProvider: 'evolution' | 'waha' | 'meta' =
      body.provider ?? (existingConfig?.provider as 'evolution' | 'waha' | 'meta' | undefined) ?? defaultProvider;

    if (effectiveProvider === 'waha' && !existingConfig) {
      try {
        await ensureTenantWahaProvisioning(admin, tenantId);
      } catch (error) {
        defaultLogger.warn('[whatsapp/connect] WAHA auto-provisioning attempt failed', {
          tenantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { data: refreshedConfig } = await admin
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .maybeSingle();
    const liveConfig = refreshedConfig ?? existingConfig;
    const liveConfigProvider = (liveConfig?.provider as 'evolution' | 'waha' | 'meta' | undefined) ?? 'evolution';
    const liveConfigApiKey = liveConfig
      ? await getStoredProviderApiKey(
          admin,
          tenantId,
          liveConfigProvider,
          (liveConfig.provider_api_key ?? liveConfig.evolution_api_key) as string | null
        )
      : '';
    const existingMetaConfig =
      liveConfig?.provider === 'meta' && !!liveConfig.meta_phone_number_id && liveConfig.meta_phone_number_id === (body.metaPhoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || liveConfig.meta_phone_number_id);
    if (effectiveProvider === 'waha' && !liveConfig && process.env.WAHA_AUTO_PROVISION_REQUIRED === 'true') {
      throw ApiErrorFactory.internalServerError(
        new Error('WAHA endpoint provisioning is required but no tenant mapping is available')
      );
    }

    const EVOLUTION_BASE_URL = process.env.EVOLUTION_API_BASE || 'http://localhost:8080';
    const EVOLUTION_API_KEY  = process.env.EVOLUTION_API_KEY  || '';
    const WAHA_BASE_URL      = process.env.WAHA_API_BASE      || 'http://localhost:3100';
    const WAHA_API_KEY       = process.env.WAHA_API_KEY       || '';
    const META_BASE_URL_RAW  = process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com';
    const META_API_VERSION   = process.env.WHATSAPP_API_VERSION || 'v18.0';
    const META_BASE_URL      = resolveMetaGraphBase(META_BASE_URL_RAW, META_API_VERSION);
    const META_ACCESS_TOKEN  = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const metaPhoneNumberId =
      body.metaPhoneNumberId ||
      liveConfig?.meta_phone_number_id ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      '';
    const wahaRuntime = resolveWahaRuntimeConfig(
      tenantId,
      (liveConfig ?? null) as Record<string, unknown> | null,
      liveConfigApiKey,
      WAHA_BASE_URL,
      WAHA_API_KEY
    );
    const providerBaseUrl =
      effectiveProvider === 'waha'
        ? wahaRuntime.baseUrl
        : effectiveProvider === 'meta'
        ? META_BASE_URL
        : EVOLUTION_BASE_URL;
    const providerApiKey =
      effectiveProvider === 'waha'
        ? wahaRuntime.apiKey
        : effectiveProvider === 'meta'
        ? META_ACCESS_TOKEN
        : EVOLUTION_API_KEY;

    if (!providerApiKey) {
      throw ApiErrorFactory.internalServerError(
        new Error(`${effectiveProvider.toUpperCase()}_API_KEY is not configured on the server`)
      );
    }
    if (effectiveProvider === 'meta' && existingMetaConfig) {
      await admin.from('whatsapp_connections').upsert(
        {
          tenant_id: tenantId,
          instance_name: liveConfig!.instance_name,
          status: 'connected',
          phone_number: liveConfig!.meta_phone_number_id,
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,instance_name' }
      );
      activateV2(tenantId).catch(() => {});
      return {
        status: 'connected',
        instanceName: liveConfig!.instance_name,
        phone: liveConfig!.meta_phone_number_id,
        message: 'Meta provider already configured for this tenant.',
      };
    }
    if (effectiveProvider === 'waha' && !isAllowedWahaBaseUrl(providerBaseUrl)) {
      throw ApiErrorFactory.forbidden('Configured WAHA endpoint is not allowlisted');
    }
    if (effectiveProvider === 'meta' && !metaPhoneNumberId) {
      throw ApiErrorFactory.validationError({
        metaPhoneNumberId: 'Meta phone_number_id is required (body.metaPhoneNumberId or WHATSAPP_PHONE_NUMBER_ID env)',
      });
    }

    const generatedInstanceName = `booka-${tenantId.slice(0, 8)}`;
    const requestedInstanceName =
      body.instanceName ||
      (liveConfig?.provider === 'evolution' ? liveConfig.instance_name : generatedInstanceName) ||
      generatedInstanceName;
    const instanceName =
      effectiveProvider === 'waha' ? 'default' : effectiveProvider === 'meta' ? metaPhoneNumberId : requestedInstanceName;
    const baseWebhookUrl =
      process.env.EVOLUTION_WEBHOOK_URL ||
      `${process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/whatsapp`;
    const webhookUrl = buildProviderWebhookUrl(baseWebhookUrl, effectiveProvider, tenantId);
    const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET || '';

    const previousProvider = liveConfig?.provider ?? 'evolution';
    if (liveConfig && previousProvider !== effectiveProvider) {
      const oldBaseUrl = liveConfig.provider_base_url ?? liveConfig.evolution_base_url;
      const oldApiKey = await getStoredProviderApiKey(
        admin,
        tenantId,
        previousProvider as 'evolution' | 'waha' | 'meta',
        (liveConfig.provider_api_key ?? liveConfig.evolution_api_key) as string | null
      );
      getProviderClient({
        provider: previousProvider as 'evolution' | 'waha' | 'meta',
        baseUrl: oldBaseUrl,
        apiKey: oldApiKey,
        instanceName: liveConfig.instance_name,
      }).deleteInstance().catch(() => {});

      await admin
        .from('whatsapp_connections')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .eq('instance_name', liveConfig.instance_name);
    }

    const { error: upsertError } = await admin
      .from('whatsapp_configurations')
      .upsert(
        {
          tenant_id:          tenantId,
          instance_name:      instanceName,
          evolution_base_url: EVOLUTION_BASE_URL,
          evolution_api_key:  '',
          provider:           effectiveProvider,
          provider_base_url:  providerBaseUrl,
          provider_api_key:   null,
          meta_phone_number_id: effectiveProvider === 'meta' ? metaPhoneNumberId : null,
          webhook_url:        webhookUrl,
          active:             true,
          updated_at:         new Date().toISOString(),
        },
        { onConflict: 'tenant_id' }
      );

    if (upsertError) throw ApiErrorFactory.databaseError(upsertError);
    await upsertStoredProviderApiKey(admin, tenantId, effectiveProvider, providerApiKey);

    const client = getProviderClient({
      provider: effectiveProvider,
      baseUrl: providerBaseUrl,
      apiKey: providerApiKey,
      instanceName,
    });

    if (effectiveProvider !== 'meta') {
      await client.createInstance(webhookUrl, webhookSecret);
    }

    const statusResult = await client.getConnectionStatus();
    if (statusResult.connected || effectiveProvider === 'meta') {
      await admin.from('whatsapp_connections').upsert(
        {
          tenant_id: tenantId,
          instance_name: instanceName,
          status: 'connected',
          phone_number: statusResult.phone ?? (effectiveProvider === 'meta' ? metaPhoneNumberId : undefined),
          last_seen: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,instance_name' }
      );
      activateV2(tenantId).catch(() => {});
      if (effectiveProvider === 'evolution') {
        whatsappConnectionManager.startMonitoring(tenantId).catch(() => {});
      }
      return {
        status: 'connected',
        instanceName,
        phone: statusResult.phone,
        message:
          effectiveProvider === 'meta'
            ? 'Meta provider configured. Confirm webhook subscription and test inbound messages.'
            : 'WhatsApp already connected.',
      };
    }

    const qrCode = await client.getQrCode();

    await admin.from('whatsapp_connections').upsert(
      { tenant_id: tenantId, instance_name: instanceName, status: 'connecting', qr_code: qrCode, webhook_url: webhookUrl, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,instance_name' }
    );

    activateV2(tenantId).catch(() => {});
    if (effectiveProvider === 'evolution') {
      whatsappConnectionManager.startMonitoring(tenantId).catch(() => {});
    }

    let pairingCode: string | null = null;
    if (body.phoneNumber) {
      pairingCode = await client.requestPairingCode(body.phoneNumber).catch(() => null);
    }

    return {
      status: qrCode ? 'pending_scan' : 'connecting',
      instanceName,
      provider: effectiveProvider,
      qrCode: qrCode ?? undefined,
      pairingCode: pairingCode ?? undefined,
      webhookUrl,
      message: pairingCode
        ? 'Enter the pairing code in WhatsApp > Linked Devices > Link with phone number.'
        : qrCode
        ? 'Scan the QR code with your WhatsApp to connect.'
        : 'Waiting for QR code — it will arrive shortly via webhook.',
    };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const admin = createSupabaseAdminClient();
    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single();

    if (configError || !config) {
      return { status: 'not_configured', message: 'No WhatsApp configuration found. Call POST first.' };
    }

    if (config.provider === 'meta') {
      const { data: conn } = await ctx.supabase
        .from('whatsapp_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('instance_name', config.instance_name)
        .maybeSingle();

      return {
        status: 'connected',
        instanceName: config.instance_name,
        phone: conn?.phone_number ?? config.meta_phone_number_id,
        profileName: conn?.profile_name,
        provider: 'meta',
        message: 'Meta provider configured for this tenant. Send a test inbound message to continue onboarding.',
      };
    }

    const { data: conn } = await ctx.supabase
      .from('whatsapp_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('instance_name', config.instance_name)
      .single();

    if (conn?.status === 'connected') {
      return { status: 'connected', instanceName: config.instance_name, phone: conn.phone_number, profileName: conn.profile_name };
    }

    let qrCode = conn?.qr_code ?? null;

    if (!qrCode && config.provider !== 'meta') {
      const provider = (config.provider ?? 'evolution') as 'evolution' | 'waha' | 'meta';
      const providerApiKey = await getStoredProviderApiKey(
        admin,
        tenantId,
        provider,
        (config.provider_api_key ?? config.evolution_api_key) as string | null
      );
      const client = getProviderClient({
        provider,
        baseUrl:  config.provider_base_url ?? config.evolution_base_url,
        apiKey:   providerApiKey,
        instanceName: config.instance_name,
      });
      qrCode = await client.getQrCode();

      if (qrCode) {
        await admin
          .from('whatsapp_connections')
          .upsert(
            { tenant_id: tenantId, instance_name: config.instance_name, status: 'connecting', qr_code: qrCode, updated_at: new Date().toISOString() },
            { onConflict: 'tenant_id,instance_name' }
          );
      }
    }

    return {
      status: conn?.status ?? 'not_connected',
      instanceName: config.instance_name,
      provider: config.provider ?? 'evolution',
      qrCode,
      message:
        config.provider === 'meta'
          ? 'Meta provider configured. Verify webhook in Meta dashboard and send a test inbound message.'
          : qrCode
          ? 'Scan the QR code with WhatsApp.'
          : 'No QR code available yet — try again in a few seconds.',
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
