export const dynamic = 'force-dynamic';
import crypto from 'crypto';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';

type RevokedApiKey = { hash: string; salt: string; createdAt: string; revokedAt: string };
type ApiKeySettings = Record<string, unknown> & {
  apiKeyHash?: unknown;
  apiKeySalt?: unknown;
  apiKeyCreatedAt?: unknown;
  revokedApiKeys?: unknown;
};

function asRevokedApiKey(value: unknown): RevokedApiKey | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  return typeof entry.hash === 'string'
    && typeof entry.salt === 'string'
    && typeof entry.createdAt === 'string'
    && typeof entry.revokedAt === 'string'
    ? { hash: entry.hash, salt: entry.salt, createdAt: entry.createdAt, revokedAt: entry.revokedAt }
    : null;
}

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

    const settings = (current?.settings || {}) as ApiKeySettings;

    // Generate secure API key
    const apiKey = crypto.randomBytes(24).toString('hex');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + apiKey).digest('hex');

    // Revoke previous key by recording its revocation timestamp before overwriting
    const previousKeyCreatedAt = typeof settings.apiKeyCreatedAt === 'string' ? settings.apiKeyCreatedAt : null;
    const revokedKeys = Array.isArray(settings.revokedApiKeys)
      ? settings.revokedApiKeys.map(asRevokedApiKey).filter((entry): entry is RevokedApiKey => entry !== null)
      : [];
    if (typeof settings.apiKeyHash === 'string' && previousKeyCreatedAt) {
      revokedKeys.push({
        hash: settings.apiKeyHash,
        salt: typeof settings.apiKeySalt === 'string' ? settings.apiKeySalt : '',
        createdAt: previousKeyCreatedAt,
        revokedAt: new Date().toISOString(),
      });
      // Keep only last 10 revoked keys to prevent unbounded growth
      if (revokedKeys.length > 10) revokedKeys.splice(0, revokedKeys.length - 10);
    }

    const merged = {
      ...settings,
      apiKeyHash: hash,
      apiKeySalt: salt,
      apiKeyPresent: true,
      apiKeyCreatedAt: new Date().toISOString(),
      revokedApiKeys: revokedKeys,
    };

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
