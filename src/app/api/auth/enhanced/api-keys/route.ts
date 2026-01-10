import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { enhancedAuth } from '@/lib/auth/enhanced-auth';
import { z } from 'zod';

const APIKeyCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  scopes: z.array(z.string()).default(['api:read']),
  rate_limit_per_hour: z.number().min(1).max(10000).default(1000),
  expires_in_days: z.number().min(1).max(365).optional(),
});

/**
 * Create API Key
 * POST /api/auth/enhanced/api-keys
 */
export const POST = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.tenantId || !ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    // Only owner and manager roles can create API keys
    if (!['owner', 'manager'].includes(ctx.user.role)) {
      throw ApiErrorFactory.forbidden('Only owners and managers can create API keys');
    }

    enhancedAuth.setSupabaseClient(ctx.supabase);

    const body = await ctx.request.json();
    const keyData = APIKeyCreateSchema.parse(body);

    try {
      const apiKey = await enhancedAuth.createAPIKey({
        user_id: ctx.user.id,
        tenant_id: ctx.user.tenantId,
        name: keyData.name,
        description: keyData.description,
        scopes: keyData.scopes,
        rate_limit_per_hour: keyData.rate_limit_per_hour,
        expires_in_days: keyData.expires_in_days,
      });

      return {
        success: true,
        api_key: {
          key_id: apiKey.keyId,
          api_key: apiKey.apiKey, // Only returned once!
          name: keyData.name,
          scopes: keyData.scopes,
          rate_limit: keyData.rate_limit_per_hour,
        },
        warning: 'This is the only time you will see the full API key. Please store it securely.',
      };
    } catch (error) {
      console.error('[auth/api-keys] creation failed:', error);
      throw ApiErrorFactory.internalServerError('Failed to create API key');
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * Get API Keys
 * GET /api/auth/enhanced/api-keys
 */
export const GET = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.tenantId) {
      throw ApiErrorFactory.missingAuthorization();
    }

    // Get API keys (without the actual key values)
    const { data: apiKeys, error } = await ctx.supabase
      .from('api_keys')
      .select(
        `
        id,
        key_id,
        name,
        description,
        scopes,
        rate_limit_per_hour,
        is_active,
        last_used_at,
        expires_at,
        created_at
      `
      )
      .eq('tenant_id', ctx.user.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[auth/api-keys] fetch failed:', error);
      throw ApiErrorFactory.internalServerError('Failed to fetch API keys');
    }

    return {
      api_keys: apiKeys || [],
    };
  },
  'GET',
  { auth: true }
);

/**
 * Delete API Key
 * DELETE /api/auth/enhanced/api-keys/[keyId]
 */
export const DELETE = createHttpHandler(
  async (ctx) => {
    if (!ctx.user?.tenantId || !ctx.user?.id) {
      throw ApiErrorFactory.missingAuthorization();
    }

    // Only owner and manager roles can delete API keys
    if (!['owner', 'manager'].includes(ctx.user.role)) {
      throw ApiErrorFactory.forbidden('Only owners and managers can delete API keys');
    }

    const keyId = ctx.params?.keyId;

    if (!keyId) {
      throw ApiErrorFactory.validationError('API Key ID is required in the URL path');
    }

    // Verify key belongs to this tenant
    const { data: apiKey, error: fetchError } = await ctx.supabase
      .from('api_keys')
      .select('id, name')
      .eq('key_id', keyId)
      .eq('tenant_id', ctx.user.tenantId)
      .maybeSingle();

    if (fetchError || !apiKey) {
      throw ApiErrorFactory.notFound('API key not found or you do not have permission to delete it');
    }

    // Deactivate the API key
    const { error: updateError } = await ctx.supabase
      .from('api_keys')
      .update({ is_active: false, deactivated_at: new Date().toISOString() })
      .eq('id', apiKey.id);

    if (updateError) {
      console.error('[auth/api-keys] deactivation failed:', updateError);
      throw ApiErrorFactory.internalServerError('Failed to deactivate API key');
    }

    return {
      success: true,
      message: `API key "${apiKey.name}" has been deactivated`,
    };
  },
  'DELETE',
  { auth: true, roles: ['owner', 'manager'] }
);