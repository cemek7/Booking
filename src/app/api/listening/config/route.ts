export const dynamic = 'force-dynamic';

import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

const PLATFORM_VALUES = ['instagram', 'facebook', 'linkedin', 'tiktok', 'twitter', 'x'] as const;

const UpdateListeningConfigSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  handles: z.array(z.string().trim().min(1).max(100)).max(20),
  keywords: z.array(z.string().trim().min(1).max(100)).max(40),
  platforms: z.array(z.enum(PLATFORM_VALUES)).min(1).max(10),
  enabled: z.boolean(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('No tenant in context');
    }

    const admin = createSupabaseAdminClient();
    const [{ data: config, error: configError }, { data: tenant, error: tenantError }] = await Promise.all([
      admin
        .from('tenant_listening_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      admin
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle(),
    ]);

    if (configError) throw configError;
    if (tenantError) throw tenantError;

    return {
      config: config
        ? {
            businessName: config.business_name,
            handles: config.handles ?? [],
            keywords: config.keywords ?? [],
            platforms: config.platforms ?? [],
            enabled: config.enabled ?? false,
            lastPolledAt: config.last_polled_at ?? null,
          }
        : {
            businessName: tenant?.name ?? '',
            handles: [],
            keywords: [],
            platforms: ['instagram'],
            enabled: false,
            lastPolledAt: null,
          },
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);

export const PATCH = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('No tenant in context');
    }

    const body = await ctx.request.json();
    const parsed = UpdateListeningConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(parsed.error.flatten().fieldErrors);
    }

    const admin = createSupabaseAdminClient();
    const payload = {
      tenant_id: tenantId,
      business_name: parsed.data.businessName,
      handles: parsed.data.handles,
      keywords: parsed.data.keywords,
      platforms: parsed.data.platforms,
      enabled: parsed.data.enabled,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await admin
      .from('tenant_listening_config')
      .upsert(payload, { onConflict: 'tenant_id' })
      .select('*')
      .single();

    if (error) throw error;

    return {
      config: {
        businessName: data.business_name,
        handles: data.handles ?? [],
        keywords: data.keywords ?? [],
        platforms: data.platforms ?? [],
        enabled: data.enabled ?? false,
        lastPolledAt: data.last_polled_at ?? null,
      },
    };
  },
  'PATCH',
  { auth: true, roles: ['owner', 'manager'] }
);
