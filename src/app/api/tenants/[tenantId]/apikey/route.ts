import crypto from 'crypto';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

/**
 * POST /api/tenants/:tenantId/apikey
 * Generates a new random API key and stores a hash in tenant settings.
 * Requires 'owner' role.
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.params?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID is required' });
    }

    // Verify the caller has ownership access to this tenant
    if (ctx.user?.tenantId && ctx.user.tenantId !== tenantId) {
      throw ApiErrorFactory.forbidden('Access denied to this tenant');
    }

    // Fetch current tenant settings
    const { data: current, error: fetchError } = await ctx.supabase
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .single();

    if (fetchError) {
      throw ApiErrorFactory.databaseError(fetchError);
    }

    const settings = (current?.settings || {}) as Record<string, unknown>;

    // Generate secure API key
    const apiKey = crypto.randomBytes(24).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + apiKey).digest('hex');

    const merged = { ...settings, apiKeyHash: hash, apiKeySalt: salt, apiKeyPresent: true };

    const { error: updateError } = await ctx.supabase
      .from('tenants')
      .update({ settings: merged })
      .eq('id', tenantId);

    if (updateError) {
      throw ApiErrorFactory.databaseError(updateError);
    }

    // Return plaintext once; client should store securely
    return { apiKey };
  },
  'POST',
  { auth: true, roles: ['owner'] }
);
