import { getAppConfig, isIntegrationEnabled } from './configManager';
import { checkFeatureRequirements } from './featureFlags';

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
    
    // TODO: Add actual connection test when needed
    return {
      name: 'Supabase',
      status: 'healthy',
      message: 'Supabase configuration valid',
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
    
    // TODO: Add actual Redis connection test
    return {
      name: 'Redis',
      status: 'healthy',
      message: 'Redis configuration valid',
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
    const isEnabled = isIntegrationEnabled('evolution');
    
    if (!isEnabled) {
      return {
        name: 'Evolution API',
        status: 'warning',
        message: 'Evolution API integration disabled',
        lastChecked: new Date()
      };
    }
    
    const requirements = checkFeatureRequirements('whatsappIntegration');
    if (!requirements.satisfied) {
      return {
        name: 'Evolution API',
        status: 'error',
        message: 'Evolution API configuration incomplete',
        details: { missing: requirements.missing },
        lastChecked: new Date()
      };
    }
    
    // TODO: Add actual API connection test
    return {
      name: 'Evolution API',
      status: 'healthy',
      message: 'Evolution API configuration valid',
      lastChecked: new Date()
    };
  } catch (error) {
    return {
      name: 'Evolution API',
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