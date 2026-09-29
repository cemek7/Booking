export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isRedisConfigured, pingRedis } from '@/lib/redis';
import {
  getContinuityFlags,
  hasLiveContinuity,
  type ContinuityFlags,
} from '@/lib/whatsapp/v2/continuityFlags';

export function continuityReadinessPolicy(flags: ContinuityFlags): {
  requireSchema: boolean;
  advisoryWarning: string | null;
} {
  if (hasLiveContinuity(flags)) return { requireSchema: true, advisoryWarning: null };
  return {
    requireSchema: false,
    advisoryWarning: `Conversation continuity is ${flags.contextMode}; schema readiness is advisory until a continuity flag is live.`,
  };
}

export function continuityReadinessPolicyForTenants(
  globalFlags: ContinuityFlags,
  tenantFlags: ContinuityFlags[],
): ReturnType<typeof continuityReadinessPolicy> {
  const allFlags = [globalFlags, ...tenantFlags];
  if (allFlags.some(hasLiveContinuity)) {
    return { requireSchema: true, advisoryWarning: null };
  }
  const advisoryFlags = allFlags.find((flags) => flags.contextMode === 'shadow') ?? globalFlags;
  return continuityReadinessPolicy(advisoryFlags);
}

export function isClaimRpcAvailable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return true;
  if (error.code === 'PGRST202' || error.code === '42883') return false;
  return error.code === 'P0001'
    && (error.message ?? '').toLowerCase().includes('worker id and settle cutoff are required');
}

interface ReadinessCheck {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: {
    database_migrations: boolean;
    environment_variables: boolean;
    required_services: boolean;
    ai_services_initialized: boolean;
    storage_accessible: boolean;
  };
  details: {
    missing_env_vars?: string[];
    failed_checks?: string[];
    warnings?: string[];
  };
}

/**
 * GET /api/ready
 * Public readiness check - no authentication required
 * Used for deployment probes and health monitoring
 */
export const GET = createHttpHandler(
  async () => {
    const timestamp = new Date().toISOString();
    const isProduction = process.env.NODE_ENV === 'production';
    const supabase = createSupabaseAdminClient();
    const globalContinuityFlags = getContinuityFlags(null);
    const { data: continuityTenants, error: continuityTenantError } = await supabase
      .from('tenants')
      .select('settings')
      .eq('lifecycle_state', 'active')
      .limit(1000);
    const tenantContinuityFlags = ((continuityTenants ?? []) as Array<{ settings?: Record<string, unknown> | null }>)
      .map((tenant) => getContinuityFlags(tenant));
    const continuityPolicy = continuityReadinessPolicyForTenants(
      globalContinuityFlags,
      tenantContinuityFlags,
    );
    const { data: activeMetaConnection } = await supabase
      .from('whatsapp_configurations')
      .select('tenant_id')
      .eq('provider', 'meta')
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    const hasTenantScopedMetaConnection = Boolean(activeMetaConnection?.tenant_id);
    const provider = (
      process.env.DEFAULT_WHATSAPP_PROVIDER === 'waha' ||
      process.env.DEFAULT_WHATSAPP_PROVIDER === 'meta' ||
      process.env.DEFAULT_WHATSAPP_PROVIDER === 'evolution'
    )
      ? process.env.DEFAULT_WHATSAPP_PROVIDER
      : (process.env.WAHA_API_BASE || process.env.WAHA_API_KEY)
        ? 'waha'
        : (process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_PHONE_NUMBER_ID)
          ? 'meta'
          : 'evolution';

    const featureFlagsEnabled = [
      process.env.AI_RECOMMENDATIONS_ENABLED,
      process.env.CONVERSATION_AI_ENABLED,
      process.env.PREDICTIVE_ANALYTICS_ENABLED,
      process.env.AUTOMATION_WORKFLOWS_ENABLED,
    ].some((flag) => flag !== 'false');

    const readinessCheck: ReadinessCheck = {
      status: 'ready',
      timestamp,
      checks: {
        database_migrations: false,
        environment_variables: false,
        required_services: false,
        ai_services_initialized: false,
        storage_accessible: false
      },
      details: {
        missing_env_vars: [],
        failed_checks: [],
        warnings: []
      }
    };

    // Check environment variables
    const requiredEnvVars = new Set([
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'NEXTAUTH_SECRET',
      'ENCRYPTION_KEY',
      'CRON_SECRET',
    ]);

    const hasAiProvider = Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API_TOKEN
    ) || Boolean(process.env.OPENROUTER_API_KEY) || Boolean(process.env.GOOGLE_AI_API_KEY);

    if (provider === 'meta' || hasTenantScopedMetaConnection) {
      ['WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'].forEach((key) => requiredEnvVars.add(key));
      if (!hasTenantScopedMetaConnection) {
        ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'].forEach((key) => requiredEnvVars.add(key));
      }
    } else if (provider === 'waha') {
      ['WAHA_API_BASE', 'WAHA_API_KEY', 'EVOLUTION_WEBHOOK_SECRET'].forEach((key) => requiredEnvVars.add(key));
    } else {
      ['EVOLUTION_API_BASE', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE_NAME', 'EVOLUTION_WEBHOOK_SECRET'].forEach((key) => requiredEnvVars.add(key));
    }

    if (isProduction && !isRedisConfigured()) {
      requiredEnvVars.add('REDIS_URL');
    }

    const missingEnvVars = Array.from(requiredEnvVars).filter((envVar) => !process.env[envVar]);
    if (featureFlagsEnabled && !hasAiProvider) {
      missingEnvVars.push('an AI provider (Cloudflare Workers AI, OpenRouter, or Google AI)');
    }
    
    if (missingEnvVars.length === 0) {
      readinessCheck.checks.environment_variables = true;
    } else {
      readinessCheck.details.missing_env_vars = missingEnvVars;
      readinessCheck.details.failed_checks?.push('Missing required environment variables');
    }

    // Check AI services configuration
    if (hasAiProvider) {
      readinessCheck.checks.ai_services_initialized = true;
    } else {
      readinessCheck.details.warnings?.push('AI services may not function properly. Configure Cloudflare Workers AI, OpenRouter, or Google AI.');
      readinessCheck.checks.ai_services_initialized = false;
    }

    // File storage is optional for the current VPS launch path.
    readinessCheck.checks.storage_accessible = true;

    // Smoke-test the core schema we depend on for WhatsApp and background jobs.
    const migrationChecks = await Promise.allSettled([
      supabase.from('tenants').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('tenant_users').select('user_id', { head: true, count: 'exact' }).limit(1),
      supabase.from('whatsapp_provider_secrets').select('tenant_id', { head: true, count: 'exact' }).limit(1),
      supabase.from('cron_locks').select('key', { head: true, count: 'exact' }).limit(1),
      supabase.from('whatsapp_message_queue').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('whatsapp_configurations').select('tenant_id', { head: true, count: 'exact' }).limit(1),
      supabase.from('sias_campaign_runs').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('sias_operational_memory').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('sias_outcome_attributions').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('escalation_queue').select('id', { head: true, count: 'exact' }).limit(1),
      supabase.from('dialog_sessions').select('id', { head: true, count: 'exact' }).limit(1),
    ]);

    const failedMigrations = migrationChecks.some((result) => {
      if (result.status === 'rejected') return true;
      const value = result.value as { error?: unknown };
      return Boolean(value.error);
    });

    let continuitySchemaFailed = false;
    if (continuityPolicy.requireSchema) {
      const continuityTableChecks = await Promise.allSettled([
        supabase.from('shared_channel_route_sessions').select('id', { head: true, count: 'exact' }).limit(1),
        supabase.from('customer_channel_identities').select('id', { head: true, count: 'exact' }).limit(1),
        supabase.from('conversation_threads').select('id', { head: true, count: 'exact' }).limit(1),
        supabase.from('customer_memory_facts').select('id', { head: true, count: 'exact' }).limit(1),
        supabase.from('conversation_effects').select('id', { head: true, count: 'exact' }).limit(1),
      ]);
      continuitySchemaFailed = continuityTableChecks.some((result) =>
        result.status === 'rejected'
        || Boolean((result.value as { error?: unknown } | undefined)?.error));

      const { error: claimRpcError } = await supabase.rpc('claim_whatsapp_conversation_batch', {
        p_worker_id: null,
        p_settle_before: null,
        p_lease_seconds: 120,
      });
      if (!isClaimRpcAvailable(claimRpcError)) continuitySchemaFailed = true;
      if (continuitySchemaFailed) {
        readinessCheck.details.failed_checks?.push('Live conversation continuity schema or claim RPC missing');
      }
    } else if (continuityPolicy.advisoryWarning) {
      readinessCheck.details.warnings?.push(continuityPolicy.advisoryWarning);
    }
    if (continuityTenantError) {
      readinessCheck.details.warnings?.push('Could not inspect tenant continuity overrides');
      if (hasLiveContinuity(globalContinuityFlags)) continuitySchemaFailed = true;
    }

    if (!failedMigrations && !continuitySchemaFailed) {
      readinessCheck.checks.database_migrations = true;
    } else {
      readinessCheck.details.failed_checks?.push('Core database tables missing or inaccessible');
      readinessCheck.checks.database_migrations = false;
    }

    const redisHealthy = !isProduction || !isRedisConfigured()
      ? true
      : await pingRedis()
        .then(() => true)
        .catch((error) => {
          readinessCheck.details.failed_checks?.push(`Redis unavailable: ${error instanceof Error ? error.message : 'unknown error'}`);
          return false;
        });

    // Assume required services are available if environment is configured
    readinessCheck.checks.required_services =
      readinessCheck.checks.environment_variables &&
      readinessCheck.checks.database_migrations &&
      redisHealthy;

    // Determine overall readiness
    const isReady =
      readinessCheck.checks.environment_variables &&
      readinessCheck.checks.database_migrations &&
      readinessCheck.checks.required_services &&
      (!featureFlagsEnabled || readinessCheck.checks.ai_services_initialized);
    
    readinessCheck.status = isReady ? 'ready' : 'not_ready';

    return {
      ...readinessCheck,
      _httpStatus: readinessCheck.status === 'ready' ? 200 : 503,
      _headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    };
  },
  'GET',
  { auth: false } // Public endpoint, no auth required
);
