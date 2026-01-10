import { getServiceConfig } from './envValidation';

export interface AppConfig {
  app: {
    name: string;
    version: string;
    environment: string;
    host: string;
    apiBase: string;
  };
  
  database: {
    supabase: {
      url: string;
      anonKey: string;
      serviceKey: string;
    };
  };
  
  integrations: {
    evolution: {
      enabled: boolean;
      apiKey?: string;
      webhookSecret?: string;
      baseUrl?: string;
      instanceName?: string;
    };
    
    redis: {
      enabled: boolean;
      url?: string;
      password?: string;
    };
    
    openrouter: {
      enabled: boolean;
      apiKey?: string;
      baseUrl?: string;
    };
    
    monitoring: {
      sentry: {
        enabled: boolean;
        dsn?: string;
        org?: string;
        project?: string;
      };
    };
    
    payments: {
      paystack: {
        secretKey?: string;
        publicKey?: string;
      } | null;
      
      stripe: {
        secretKey?: string;
        publicKey?: string;
        webhookSecret?: string;
      } | null;
    };
  };
  
  features: {
    whatsappIntegration: boolean;
    phase5Features: boolean;
    analyticsDashboard: boolean;
    messagingAdapter: boolean;
    advancedScheduler: boolean;
    multiTenant: boolean;
  };
  
  security: {
    jwtSecret?: string;
    webhookSecret?: string;
    encryptionKey?: string;
  };
}

let cachedConfig: AppConfig | null = null;

/**
 * Get unified application configuration
 */
export function getAppConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  const serviceConfig = getServiceConfig();
  
  cachedConfig = {
    app: {
      name: 'Booka',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      host: process.env.NEXT_PUBLIC_HOST || 'localhost:3000',
      apiBase: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001'
    },
    
    database: {
      supabase: serviceConfig.supabase
    },
    
    integrations: {
      evolution: {
        enabled: serviceConfig.features.whatsappIntegration && !!serviceConfig.evolution,
        ...serviceConfig.evolution
      },
      
      redis: {
        enabled: serviceConfig.features.messagingAdapter && !!serviceConfig.redis,
        ...serviceConfig.redis
      },
      
      openrouter: {
        enabled: !!serviceConfig.openrouter,
        ...serviceConfig.openrouter
      },
      
      monitoring: {
        sentry: {
          enabled: !!serviceConfig.monitoring.sentry,
          ...serviceConfig.monitoring.sentry
        }
      },
      
      payments: {
        paystack: serviceConfig.payments.paystack,
        stripe: serviceConfig.payments.stripe
      }
    },
    
    features: {
      whatsappIntegration: serviceConfig.features.whatsappIntegration,
      phase5Features: serviceConfig.features.phase5Features,
      analyticsDashboard: serviceConfig.features.analyticsDashboard,
      messagingAdapter: serviceConfig.features.messagingAdapter,
      advancedScheduler: serviceConfig.features.advancedScheduler,
      multiTenant: true // Always enabled in this version
    },
    
    security: {
      jwtSecret: process.env.JWT_SECRET,
      webhookSecret: process.env.WEBHOOK_SIGNATURE_SECRET,
      encryptionKey: process.env.ENCRYPTION_KEY
    }
  };
  
  return cachedConfig;
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
  return getAppConfig().features[feature];
}

/**
 * Check if an integration is enabled and configured
 */
export function isIntegrationEnabled(integration: keyof AppConfig['integrations']): boolean {
  const config = getAppConfig().integrations[integration];
  return 'enabled' in config ? config.enabled : false;
}

/**
 * Get service-specific configuration
 */
export function getIntegrationConfig<T extends keyof AppConfig['integrations']>(
  integration: T
): AppConfig['integrations'][T] {
  return getAppConfig().integrations[integration];
}

/**
 * Reset configuration cache (useful for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get configuration summary for debugging
 */
export function getConfigSummary(): {
  environment: string;
  enabledFeatures: string[];
  enabledIntegrations: string[];
  missingConfiguration: string[];
} {
  const config = getAppConfig();
  
  const enabledFeatures = Object.entries(config.features)
    .filter(([, enabled]) => enabled)
    .map(([feature]) => feature);
  
  const enabledIntegrations = Object.entries(config.integrations)
    .filter(([, integration]) => 'enabled' in integration ? integration.enabled : false)
    .map(([integration]) => integration);
  
  const missingConfiguration: string[] = [];
  
  // Check for missing required configuration
  if (config.features.whatsappIntegration && !config.integrations.evolution.enabled) {
    missingConfiguration.push('Evolution API configuration missing for WhatsApp integration');
  }
  
  if (config.features.messagingAdapter && !config.integrations.redis.enabled) {
    missingConfiguration.push('Redis configuration missing for messaging adapter');
  }
  
  if (config.app.environment === 'production' && !config.integrations.monitoring.sentry.enabled) {
    missingConfiguration.push('Sentry monitoring recommended for production');
  }
  
  return {
    environment: config.app.environment,
    enabledFeatures,
    enabledIntegrations,
    missingConfiguration
  };
}