import { getAppConfig, isIntegrationEnabled } from './configManager';
import { checkFeatureRequirements } from './featureFlags';
import { createSupabaseAdminClient } from './supabase/server';
import { pingRedis } from './redis';

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'warning' | 'error' | 'unknown';
  message: string;
  details?: Record<string, unknown>;
  lastChecked: Date;
}

export interface HealthSummary {
  overall: 'healthy' | 'warning' | 'error';
  checks: HealthCheck[];
  uptime: number;
  environment: string;
  version: string;
}

/**
 * Check Supabase connection
 */
export async function checkSupabase(): Promise<HealthCheck> {
  try {
    const config = getAppConfig();
    
    // Basic configuration check
    if (!config.database.supabase.url || !config.database.supabase.anonKey) {
      return {
        name: 'Supabase',
        status: 'error',
        message: 'Supabase configuration missing',
        details: {
          hasUrl: !!config.database.supabase.url,
          hasAnonKey: !!config.database.supabase.anonKey,
          hasServiceKey: !!config.database.supabase.serviceKey
        },
        lastChecked: new Date()
      };
    }
    
    // Perform a lightweight real DB ping
    try {
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase.from('tenants').select('id').limit(1);
      if (error) {
        return {
          name: 'Supabase',
          status: 'error',
          message: `Supabase query failed: ${error.message}`,
          lastChecked: new Date()
        };
      }
    } catch (pingErr) {
      return {
        name: 'Supabase',
        status: 'error',
        message: pingErr instanceof Error ? pingErr.message : 'Supabase ping failed',
        lastChecked: new Date()
      };
    }
    return {
      name: 'Supabase',
      status: 'healthy',
      message: 'Supabase connection verified',
      lastChecked: new Date()
    };
  } catch (error) {
    return {
      name: 'Supabase',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date()
    };
  }
}

/**
 * Check Redis connection
 */
export async function checkRedis(): Promise<HealthCheck> {
  try {
    const isEnabled = isIntegrationEnabled('redis');
    
    if (!isEnabled) {
      return {
        name: 'Redis',
        status: 'warning',
        message: 'Redis integration disabled',
        lastChecked: new Date()
      };
    }
    
    const start = Date.now();
    await pingRedis();
    const latencyMs = Date.now() - start;
    return {
      name: 'Redis',
      status: 'healthy',
      message: `Connected (${latencyMs}ms)`,
      details: { latency_ms: latencyMs },
      lastChecked: new Date()
    };
  } catch (error) {
    return {
      name: 'Redis',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date()
    };
  }
}

/**
 * Check Evolution API
 */
export async function checkEvolutionAPI(): Promise<HealthCheck> {
  try {
    const hasEvolution =
      !!process.env.EVOLUTION_API_KEY &&
      !!process.env.EVOLUTION_WEBHOOK_SECRET &&
      !!process.env.EVOLUTION_API_BASE;
    const hasMeta = !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
    const hasWaha = !!process.env.WAHA_API_BASE && !!process.env.WAHA_API_KEY;
    const isEnabled = isIntegrationEnabled('evolution') || hasEvolution || hasMeta || hasWaha;
    
    if (!isEnabled) {
      return {
        name: 'WhatsApp Provider',
        status: 'warning',
        message: 'WhatsApp integration disabled',
        lastChecked: new Date()
      };
    }
    
    const requirements = checkFeatureRequirements('whatsappIntegration');
    if (!requirements.satisfied) {
      return {
        name: 'WhatsApp Provider',
        status: 'error',
        message: 'WhatsApp provider configuration incomplete',
        details: { missing: requirements.missing },
        lastChecked: new Date()
      };
    }
    
    if (hasMeta) {
      const apiUrl = process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com';
      const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
      const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
      const accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
      try {
        const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          return {
            name: 'WhatsApp Provider',
            status: 'warning',
            message: `Meta Graph API returned HTTP ${response.status}`,
            lastChecked: new Date()
          };
        }
      } catch {
        return {
          name: 'WhatsApp Provider',
          status: 'warning',
          message: 'Meta Graph API health check timed out',
          lastChecked: new Date()
        };
      }
    } else if (hasWaha) {
      const apiUrl = (process.env.WAHA_API_BASE || '').replace(/\/+$/, '');
      try {
        const res = await fetch(`${apiUrl}/api/sessions/default`, {
          headers: { 'X-Api-Key': process.env.WAHA_API_KEY || '' },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (!res || !res.ok) {
          return {
            name: 'WhatsApp Provider',
            status: 'warning',
            message: res ? `WAHA returned HTTP ${res.status}` : 'WAHA unreachable',
            lastChecked: new Date()
          };
        }
      } catch {
        return {
          name: 'WhatsApp Provider',
          status: 'warning',
          message: 'WAHA health check timed out',
          lastChecked: new Date()
        };
      }
    } else {
      // Perform a real HTTP health check to the Evolution API
      const apiUrl = process.env.EVOLUTION_API_BASE;
      if (apiUrl) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const res = await fetch(`${apiUrl}/health`, { signal: controller.signal }).catch(() => null);
          clearTimeout(timeout);
          if (!res || !res.ok) {
            return {
              name: 'WhatsApp Provider',
              status: 'warning',
              message: res ? `Evolution API returned HTTP ${res.status}` : 'Evolution API unreachable',
              lastChecked: new Date()
            };
          }
        } catch {
          return {
            name: 'WhatsApp Provider',
            status: 'warning',
            message: 'Evolution API health check timed out',
            lastChecked: new Date()
          };
        }
      }
    }

    return {
      name: 'WhatsApp Provider',
      status: 'healthy',
      message: 'WhatsApp provider connection verified',
      lastChecked: new Date()
    };
  } catch (error) {
    return {
      name: 'WhatsApp Provider',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date()
    };
  }
}

/**
 * Check environment configuration
 */
export async function checkEnvironment(): Promise<HealthCheck> {
  try {
    const config = getAppConfig();
    const issues: string[] = [];
    
    // Check for common configuration issues
    if (config.app.environment === 'production') {
      if (!config.integrations.monitoring.sentry.enabled) {
        issues.push('Sentry monitoring not configured for production');
      }
      
      if (config.app.host.includes('localhost')) {
        issues.push('Host still set to localhost in production');
      }
    }
    
    if (issues.length > 0) {
      return {
        name: 'Environment',
        status: 'warning',
        message: 'Environment configuration issues detected',
        details: { issues },
        lastChecked: new Date()
      };
    }
    
    return {
      name: 'Environment',
      status: 'healthy',
      message: 'Environment configuration looks good',
      details: {
        environment: config.app.environment,
        host: config.app.host
      },
      lastChecked: new Date()
    };
  } catch (error) {
    return {
      name: 'Environment',
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
      lastChecked: new Date()
    };
  }
}

/**
 * Run all health checks
 */
export async function runAllHealthChecks(): Promise<HealthSummary> {
  const config = getAppConfig();
  
  const checks = await Promise.all([
    checkEnvironment(),
    checkSupabase(),
    checkRedis(),
    checkEvolutionAPI()
  ]);
  
  // Determine overall status
  let overall: HealthSummary['overall'] = 'healthy';
  
  if (checks.some(check => check.status === 'error')) {
    overall = 'error';
  } else if (checks.some(check => check.status === 'warning')) {
    overall = 'warning';
  }
  
  return {
    overall,
    checks,
    uptime: process.uptime?.() || 0,
    environment: config.app.environment,
    version: config.app.version
  };
}

/**
 * Get health status for a specific service
 */
export async function getServiceHealth(serviceName: string): Promise<HealthCheck> {
  switch (serviceName.toLowerCase()) {
    case 'supabase':
      return checkSupabase();
    case 'redis':
      return checkRedis();
    case 'evolution':
    case 'evolutionapi':
      return checkEvolutionAPI();
    case 'environment':
    case 'env':
      return checkEnvironment();
    default:
      return {
        name: serviceName,
        status: 'unknown',
        message: 'Unknown service',
        lastChecked: new Date()
      };
  }
}
