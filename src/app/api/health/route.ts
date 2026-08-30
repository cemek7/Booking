export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { hasInstalledRedisClient, isRedisConfigured, isRedisFeatureEnabled, pingRedis } from '@/lib/redis';
import { runAllHealthChecks, type HealthSummary } from '@/lib/healthChecks';
import { getFreeModelCount, isModelFree } from '@/lib/openrouter-models';
import { getWhatsAppGraphApiVersion } from '@/lib/whatsapp/metaApiConfig';

// --- Configuration ---
const {
  NODE_ENV = 'development',
  APP_VERSION = '1.0.0',
  AI_RECOMMENDATIONS_ENABLED,
  CONVERSATION_AI_ENABLED,
  PREDICTIVE_ANALYTICS_ENABLED,
  AUTOMATION_WORKFLOWS_ENABLED,
  OPENROUTER_API_KEY,
  EVOLUTION_API_BASE: EVOLUTION_API_URL,
  EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE_NAME,
  DEFAULT_WHATSAPP_PROVIDER,
  WAHA_API_BASE,
  WAHA_API_KEY,
  WHATSAPP_BASE_URL,
  WHATSAPP_ACCESS_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
} = process.env;

const SERVICE_TIMEOUT = 10000; // 10 seconds

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveWhatsappProvider(): 'evolution' | 'waha' | 'meta' {
  if (DEFAULT_WHATSAPP_PROVIDER === 'waha' || DEFAULT_WHATSAPP_PROVIDER === 'meta' || DEFAULT_WHATSAPP_PROVIDER === 'evolution') {
    return DEFAULT_WHATSAPP_PROVIDER;
  }

  if (WHATSAPP_ACCESS_TOKEN || WHATSAPP_PHONE_NUMBER_ID) {
    return 'meta';
  }

  if (WAHA_API_BASE || WAHA_API_KEY) {
    return 'waha';
  }

  return 'evolution';
}

// --- Type Definitions ---
interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  response_time_ms?: number;
  last_check: string;
  error?: string;
  free_model_count?: number | null;
  default_model_valid?: boolean | null;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  services: {
    database: HealthStatus;
    ai_services: HealthStatus;
    whatsapp_evolution: HealthStatus;
    whatsapp_provider?: HealthStatus;
    storage: HealthStatus;
    redis?: HealthStatus;
  };
  performance: {
    response_time_ms: number;
    memory_usage_mb: number;
  };
  extended_checks?: HealthSummary;
  features: {
    ai_recommendations: boolean;
    conversation_ai: boolean;
    predictive_analytics: boolean;
    automation_workflows: boolean;
  };
}

// --- Health Check Functions ---

async function checkSupabaseHealth(): Promise<HealthStatus> {
  const checkStart = Date.now();

  if (!NEXT_PUBLIC_SUPABASE_URL || !NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return {
      status: 'unhealthy',
      last_check: new Date().toISOString(),
      error: 'Supabase configuration missing',
    };
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from('tenants').select('id').limit(1);
    const responseTime = Date.now() - checkStart;

    if (error) {
      return {
        status: 'unhealthy',
        response_time_ms: responseTime,
        last_check: new Date().toISOString(),
        error: `Supabase query failed: ${error.message}`,
      };
    }
    return { status: responseTime > 5000 ? 'degraded' : 'healthy', response_time_ms: responseTime, last_check: new Date().toISOString() };
  } catch (error) {
    return { status: 'unhealthy', response_time_ms: Date.now() - checkStart, last_check: new Date().toISOString(), error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

async function checkAIServicesHealth(): Promise<HealthStatus> {
  const checkStart = Date.now();
  if (!OPENROUTER_API_KEY) {
    return { status: 'degraded', last_check: new Date().toISOString(), error: 'AI service configuration missing' };
  }
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT),
    });
    const responseTime = Date.now() - checkStart;
    if (!response.ok) {
      return { status: 'degraded', response_time_ms: responseTime, last_check: new Date().toISOString(), error: `AI service returned ${response.status}` };
    }

    const defaultModel = process.env.OPENROUTER_DEFAULT_MODEL || 'gpt-4o-mini';
    const [freeModelCount, defaultModelValid] = await Promise.all([
      getFreeModelCount(),
      isModelFree(defaultModel),
    ]);

    return {
      status: responseTime > 5000 ? 'degraded' : 'healthy',
      response_time_ms: responseTime,
      last_check: new Date().toISOString(),
      free_model_count: freeModelCount,
      default_model_valid: defaultModelValid,
    };
  } catch (error) {
    return { status: 'degraded', response_time_ms: Date.now() - checkStart, last_check: new Date().toISOString(), error: error instanceof Error ? error.message : 'Request timed out or failed' };
  }
}

async function checkWhatsAppHealth(): Promise<HealthStatus> {
  const checkStart = Date.now();
  const provider = resolveWhatsappProvider();

  if (provider === 'meta') {
    const accessToken = WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = WHATSAPP_PHONE_NUMBER_ID || '';
    const baseUrl = trimTrailingSlash(WHATSAPP_BASE_URL || 'https://graph.facebook.com');
    const apiVersion = getWhatsAppGraphApiVersion();

    if (!accessToken || !phoneNumberId) {
      return {
        status: 'degraded',
        last_check: new Date().toISOString(),
        error: 'WhatsApp Meta configuration missing',
      };
    }

    try {
      const response = await fetch(`${baseUrl}/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(SERVICE_TIMEOUT),
      });
      const responseTime = Date.now() - checkStart;
      if (!response.ok) {
        return {
          status: 'degraded',
          response_time_ms: responseTime,
          last_check: new Date().toISOString(),
          error: `WhatsApp Meta returned ${response.status}`,
        };
      }
      return {
        status: responseTime > 5000 ? 'degraded' : 'healthy',
        response_time_ms: responseTime,
        last_check: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'degraded',
        response_time_ms: Date.now() - checkStart,
        last_check: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Request timed out or failed',
      };
    }
  }

  if (provider === 'waha') {
    const baseUrl = trimTrailingSlash(WAHA_API_BASE || '');
    const apiKey = WAHA_API_KEY || '';
    if (!baseUrl || !apiKey) {
      return {
        status: 'degraded',
        last_check: new Date().toISOString(),
        error: 'WhatsApp WAHA configuration missing',
      };
    }

    try {
      const response = await fetch(`${baseUrl}/api/sessions/default`, {
        headers: { 'X-Api-Key': apiKey },
        signal: AbortSignal.timeout(SERVICE_TIMEOUT),
      });
      const responseTime = Date.now() - checkStart;
      if (!response.ok) {
        return {
          status: 'degraded',
          response_time_ms: responseTime,
          last_check: new Date().toISOString(),
          error: `WhatsApp WAHA returned ${response.status}`,
        };
      }
      const data = await response.json().catch(() => ({} as Record<string, unknown>));
      const isConnected = data.status === 'WORKING';
      return {
        status: isConnected ? 'healthy' : 'degraded',
        response_time_ms: responseTime,
        last_check: new Date().toISOString(),
        error: isConnected ? undefined : 'WAHA session not connected',
      };
    } catch (error) {
      return {
        status: 'degraded',
        response_time_ms: Date.now() - checkStart,
        last_check: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Request timed out or failed',
      };
    }
  }

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY || !EVOLUTION_INSTANCE_NAME) {
    return { status: 'degraded', last_check: new Date().toISOString(), error: 'WhatsApp Evolution configuration missing' };
  }
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${EVOLUTION_INSTANCE_NAME}`, {
      headers: { 'apikey': EVOLUTION_API_KEY },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT),
    });
    const responseTime = Date.now() - checkStart;
    if (!response.ok) {
      return { status: 'degraded', response_time_ms: responseTime, last_check: new Date().toISOString(), error: `WhatsApp Evolution returned ${response.status}` };
    }
    const data = await response.json();
    const isConnected = data.instance?.state === 'open';
    return { status: isConnected ? 'healthy' : 'degraded', response_time_ms: responseTime, last_check: new Date().toISOString(), error: isConnected ? undefined : 'Instance not connected' };
  } catch (error) {
    return { status: 'degraded', response_time_ms: Date.now() - checkStart, last_check: new Date().toISOString(), error: error instanceof Error ? error.message : 'Request timed out or failed' };
  }
}

async function checkStorageHealth(): Promise<HealthStatus> {
  return { status: 'healthy', last_check: new Date().toISOString() };
}

async function checkRedisHealth(): Promise<HealthStatus> {
  const checkStart = Date.now();
  if (!isRedisConfigured()) {
    return { status: 'degraded', last_check: new Date().toISOString(), error: 'Redis configuration missing' };
  }

  if (!hasInstalledRedisClient()) {
    return { status: 'degraded', last_check: new Date().toISOString(), error: 'Redis configured but client library not installed' };
  }
  try {
    await Promise.race([
      pingRedis(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out')), SERVICE_TIMEOUT)),
    ]);
    const responseTime = Date.now() - checkStart;
    return { status: responseTime > 5000 ? 'degraded' : 'healthy', response_time_ms: responseTime, last_check: new Date().toISOString() };
  } catch (error) {
    const responseTime = Date.now() - checkStart;
    return {
      status: 'degraded',
      response_time_ms: responseTime,
      last_check: new Date().toISOString(),
      error: `Redis configured but unreachable: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function checkV2Health(): Promise<Record<string, unknown>> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const [queueDepth, aiUsage, lastMessage] = await Promise.all([
      // Queue depth — alert if > 100 pending
      admin.from('whatsapp_message_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => count ?? 0),

      // AI quota usage today
      admin.from('messages')
        .select('ai_layer', { count: 'exact', head: false })
        .in('ai_layer', ['lite', 'flash'])
        .gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString())
        .then(({ data }) => ({
          lite: data?.filter((m: { ai_layer: string }) => m.ai_layer === 'lite').length ?? 0,
          flash: data?.filter((m: { ai_layer: string }) => m.ai_layer === 'flash').length ?? 0,
        })),

      // Last message processed timestamp
      admin.from('whatsapp_message_queue')
        .select('processed_at')
        .eq('status', 'completed')
        .order('processed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => data?.processed_at ?? null),
    ]);

    return {
      queue_depth: queueDepth,
      queue_alert: (queueDepth as number) > 100,
      ai_calls_today: aiUsage,
      ai_lite_budget_pct: Math.round(((aiUsage as { lite: number }).lite / parseInt(process.env.AI_LITE_DAILY_BUDGET ?? '800', 10)) * 100),
      ai_flash_budget_pct: Math.round(((aiUsage as { flash: number }).flash / parseInt(process.env.AI_FLASH_DAILY_BUDGET ?? '200', 10)) * 100),
      last_message_processed: lastMessage,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'v2 health check failed' };
  }
}

/**
 * GET /api/health
 * Public health check - no authentication required
 * Returns detailed service health status
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Check if caller is authenticated — authenticated users receive full detail
    let isAuthenticated = false;
    const authHeader = ctx.request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const { createSupabaseBearerClient } = await import('@/lib/supabase/bearer-client');
        const authClient = createSupabaseBearerClient(authHeader.slice(7));
        const { data } = await authClient.auth.getUser();
        isAuthenticated = !!data?.user;
      } catch {}
    }

    // Run service checks in parallel to reduce worst-case response time
    const [database, ai_services, whatsapp_evolution, storage, redis, extendedChecks, v2Checks] = await Promise.all([
      checkSupabaseHealth(),
      checkAIServicesHealth(),
      checkWhatsAppHealth(),
      checkStorageHealth(),
      isRedisFeatureEnabled() ? checkRedisHealth() : Promise.resolve(undefined),
      runAllHealthChecks().catch(() => null),
      isAuthenticated ? checkV2Health() : Promise.resolve(undefined),
    ]);

    const serviceChecks = {
      database,
      ai_services,
      whatsapp_evolution,
      whatsapp_provider: whatsapp_evolution,
      storage,
      ...(redis && { redis }),
    };

    const serviceStatuses = Object.values(serviceChecks).map(s => s.status);
    const overallStatus = serviceStatuses.includes('unhealthy') ? 'unhealthy' : 'healthy';

    // Public callers: return only status + timestamp — no operational secrets
    if (!isAuthenticated) {
      return NextResponse.json(
        { status: overallStatus, timestamp },
        { status: overallStatus === 'healthy' ? 200 : 503 }
      );
    }

    const healthCheck: HealthCheckResult = {
      status: overallStatus,
      timestamp,
      uptime: process.uptime(),
      environment: NODE_ENV,
      version: APP_VERSION,
      services: serviceChecks,
      performance: {
        response_time_ms: Date.now() - startTime,
        memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      extended_checks: extendedChecks ?? undefined,
      ...(v2Checks && { v2: v2Checks }),
      features: {
        ai_recommendations: !!AI_RECOMMENDATIONS_ENABLED,
        conversation_ai: !!CONVERSATION_AI_ENABLED,
        predictive_analytics: !!PREDICTIVE_ANALYTICS_ENABLED,
        automation_workflows: !!AUTOMATION_WORKFLOWS_ENABLED,
      },
    };

    // Return NextResponse with custom status code for unhealthy state
    return NextResponse.json(healthCheck, {
      status: overallStatus === 'healthy' ? 200 : 503,
    });
  },
  'GET',
  { auth: false }
);
