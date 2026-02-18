import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { hasInstalledRedisClient, isRedisConfigured, isRedisFeatureEnabled, pingRedis } from '@/lib/redis';

// --- Configuration ---
const {
  NODE_ENV = 'development',
  APP_VERSION = '1.0.0',
  AI_RECOMMENDATIONS_ENABLED,
  CONVERSATION_AI_ENABLED,
  PREDICTIVE_ANALYTICS_ENABLED,
  AUTOMATION_WORKFLOWS_ENABLED,
  OPENROUTER_API_KEY,
  EVOLUTION_API_URL,
  EVOLUTION_API_KEY,
  EVOLUTION_INSTANCE_NAME,
  AWS_ACCESS_KEY_ID,
  AWS_S3_BUCKET,
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
} = process.env;

const SERVICE_TIMEOUT = 10000; // 10 seconds

// --- Type Definitions ---
interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  response_time_ms?: number;
  last_check: string;
  error?: string;
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
    storage: HealthStatus;
    redis?: HealthStatus;
  };
  performance: {
    response_time_ms: number;
    memory_usage_mb: number;
  };
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
    const response = await fetch(
      `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/?${new URLSearchParams({ limit: '1' })}`,
      {
        headers: { apikey: NEXT_PUBLIC_SUPABASE_ANON_KEY },
        signal: AbortSignal.timeout(SERVICE_TIMEOUT),
      }
    );
    const responseTime = Date.now() - checkStart;
    
    if (!response.ok) {
      return { status: 'unhealthy', response_time_ms: responseTime, last_check: new Date().toISOString(), error: `Supabase returned ${response.status}` };
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
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(SERVICE_TIMEOUT),
    });
    const responseTime = Date.now() - checkStart;
    if (!response.ok) {
      return { status: 'unhealthy', response_time_ms: responseTime, last_check: new Date().toISOString(), error: `AI service returned ${response.status}` };
    }
    return { status: responseTime > 5000 ? 'degraded' : 'healthy', response_time_ms: responseTime, last_check: new Date().toISOString() };
  } catch (error) {
    return { status: 'unhealthy', response_time_ms: Date.now() - checkStart, last_check: new Date().toISOString(), error: error instanceof Error ? error.message : 'Request timed out or failed' };
  }
}

async function checkWhatsAppHealth(): Promise<HealthStatus> {
  const checkStart = Date.now();
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
  // Configuration-only check; no storage client available in this route.
  if (!AWS_ACCESS_KEY_ID || !AWS_S3_BUCKET) {
    return { status: 'degraded', last_check: new Date().toISOString(), error: 'Storage configuration missing' };
  }
  return { status: 'degraded', last_check: new Date().toISOString(), error: 'Storage configured but check is config-only (no storage client available)' };
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

/**
 * GET /api/health
 * Public health check - no authentication required
 * Returns detailed service health status
 */
export const GET = createHttpHandler(
  async () => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    // Run service checks in parallel to reduce worst-case response time
    const [database, ai_services, whatsapp_evolution, storage, redis] = await Promise.all([
      checkSupabaseHealth(),
      checkAIServicesHealth(),
      checkWhatsAppHealth(),
      checkStorageHealth(),
      isRedisFeatureEnabled() ? checkRedisHealth() : Promise.resolve(undefined),
    ]);

    const serviceChecks = {
      database,
      ai_services,
      whatsapp_evolution,
      storage,
      ...(redis && { redis }),
    };

    const serviceStatuses = Object.values(serviceChecks).map(s => s.status);
    const overallStatus = serviceStatuses.includes('unhealthy') ? 'unhealthy' : 'healthy';

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
