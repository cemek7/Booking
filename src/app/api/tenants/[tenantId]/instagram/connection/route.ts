export const dynamic = 'force-dynamic';

import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { getStoredProviderApiKey, isProviderCredentialExpired } from '@/lib/whatsapp/providerSecrets';

function assertTenantAccess(ctx: { params?: Record<string, string>; user?: { role: string; tenantId?: string } }): string {
  const tenantId = ctx.params?.tenantId;
  if (!tenantId) throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
  if (ctx.user?.role !== 'superadmin' && ctx.user?.tenantId !== tenantId) throw ApiErrorFactory.forbidden('Access denied');
  return tenantId;
}

export const GET = createHttpHandler(async (ctx) => {
  const tenantId = assertTenantAccess(ctx);
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('whatsapp_provider_secrets')
    .select('instance_name, token_expires_at, last_validated_at, revoked_at')
    .eq('tenant_id', tenantId).eq('provider', 'instagram').maybeSingle();
  if (error) throw ApiErrorFactory.databaseError(error);
  if (!data) return { status: 'disconnected' };
  const token = data.revoked_at ? '' : await getStoredProviderApiKey(admin, tenantId, 'instagram');
  return {
    status: data.revoked_at ? 'disconnected' : (!token || isProviderCredentialExpired(data.token_expires_at) ? 'action_required' : 'connected'),
    instagramAccountId: data.instance_name,
    tokenExpiresAt: data.token_expires_at,
    lastValidatedAt: data.last_validated_at,
  };
}, 'GET', { auth: true, roles: ['owner', 'manager', 'superadmin'] });

export const DELETE = createHttpHandler(async (ctx) => {
  const tenantId = assertTenantAccess(ctx);
  if (ctx.user?.role !== 'superadmin' && ctx.user?.role !== 'owner') {
    throw ApiErrorFactory.forbidden('Only the tenant owner can disconnect Instagram');
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('whatsapp_provider_secrets').update({
    api_key: null, encrypted_api_key: null, encryption_iv: null, encryption_key_version: null,
    token_expires_at: null, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('provider', 'instagram');
  if (error) throw ApiErrorFactory.databaseError(error);
  return { status: 'disconnected' };
}, 'DELETE', { auth: true, roles: ['owner', 'manager', 'superadmin'] });
