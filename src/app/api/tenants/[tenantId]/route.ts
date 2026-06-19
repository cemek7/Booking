export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';

/**
 * DELETE /api/tenants/[tenantId]
 * Hard-delete a tenant and all associated data.
 * Restricted to the tenant owner only.
 * Cascades via DB foreign keys: tenant_users, services, reservations,
 * whatsapp_configurations, whatsapp_connections, messages, chats.
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId as string;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    const admin = createSupabaseAdminClient();

    // Verify tenant exists
    const { data: tenant, error: fetchError } = await admin
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .single();

    if (fetchError || !tenant) {
      throw ApiErrorFactory.notFound('Tenant not found');
    }

    // Delete Evolution instance if configured (fire-and-forget, non-blocking)
    admin
      .from('whatsapp_configurations')
      .select('provider, instance_name, provider_base_url, evolution_base_url, provider_api_key, evolution_api_key')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single()
      .then(async ({ data: config }: { data: Record<string, unknown> | null }) => {
        if (config) {
          const provider = (config.provider ?? 'evolution') as 'evolution' | 'waha' | 'meta';
          const apiKey = await getStoredProviderApiKey(
            admin,
            tenantId,
            provider,
            (config.provider_api_key ?? config.evolution_api_key) as string | null
          );
          const baseUrl = config.provider_base_url ?? config.evolution_base_url;
          fetch(`${baseUrl}/instance/delete/${config.instance_name}`, {
            method: 'DELETE',
            headers: { apikey: apiKey },
          }).catch(() => {});
        }
      });

    // Hard delete — cascades to all child tables via FK constraints
    const { error } = await admin
      .from('tenants')
      .delete()
      .eq('id', tenantId);

    if (error) throw ApiErrorFactory.databaseError(error);

    return { success: true, deleted: tenantId };
  },
  'DELETE',
  { auth: true, roles: ['owner'] }
);
