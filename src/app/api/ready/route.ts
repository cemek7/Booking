export const dynamic = 'force-dynamic';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { isRedisConfigured, pingRedis } from '@/lib/redis';

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

    if (!failedMigrations) {
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
