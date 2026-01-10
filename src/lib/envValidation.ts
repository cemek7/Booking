/**
 * Environment Variables Validation
 * Validates required environment variables and provides helpful error messages
 */

interface EnvConfig {
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Application
  NEXT_PUBLIC_HOST: string;
  NEXT_PUBLIC_API_BASE: string;
  NODE_ENV: string;

  // Optional services
  EVOLUTION_API_KEY?: string;
  EVOLUTION_WEBHOOK_SECRET?: string;
  EVOLUTION_API_BASE?: string;
  EVOLUTION_INSTANCE_NAME?: string;
  WHATSAPP_API_KEY?: string;
  REDIS_URL?: string;
  REDIS_PASSWORD?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  PAYSTACK_SECRET_KEY?: string;
  PAYSTACK_PUBLIC_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLIC_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SENTRY_DSN?: string;
  SENTRY_ORG?: string;
  SENTRY_PROJECT?: string;

  // Feature flags
  ENABLE_WHATSAPP_INTEGRATION?: string;
  ENABLE_PHASE5_FEATURES?: string;
  ENABLE_ANALYTICS_DASHBOARD?: string;
  ENABLE_MESSAGING_ADAPTER?: string;
  ENABLE_ADVANCED_SCHEDULER?: string;
}

const requiredEnvVars = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_HOST',
  'NEXT_PUBLIC_API_BASE'
];

const conditionalRequiredVars: Record<string, string[]> = {
  'ENABLE_WHATSAPP_INTEGRATION': [
    'EVOLUTION_API_KEY',
    'EVOLUTION_WEBHOOK_SECRET',
    'EVOLUTION_API_BASE'
  ],
  'ENABLE_MESSAGING_ADAPTER': [
    'REDIS_URL'
  ]
};

export class EnvValidationError extends Error {
  constructor(message: string, public missingVars: string[]) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables and returns typed config
 */
export function validateEnvironment(): EnvConfig {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check conditional requirements
  for (const [flag, requiredVars] of Object.entries(conditionalRequiredVars)) {
    const isEnabled = process.env[flag] === 'true';
    if (isEnabled) {
      for (const varName of requiredVars) {
        if (!process.env[varName]) {
          missing.push(`${varName} (required when ${flag}=true)`);
        }
      }
    }
  }

  if (missing.length > 0) {
    throw new EnvValidationError(
      `Missing required environment variables: ${missing.join(', ')}`,
      missing
    );
  }

  // Check for common issues
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://')) {
    warnings.push('NEXT_PUBLIC_SUPABASE_URL should start with https://');
  }

  if (process.env.NODE_ENV === 'production' && !process.env.SENTRY_DSN) {
    warnings.push('SENTRY_DSN is recommended for production environments');
  }

  // Validate feature flags
  const featureFlagValidation = validateFeatureFlags();
  if (!featureFlagValidation.valid) {
    missing.push(...featureFlagValidation.errors);
  }
  warnings.push(...featureFlagValidation.warnings);

  // Re-throw error if we have missing vars after feature flag validation
  if (missing.length > 0) {
    throw new EnvValidationError(
      `Environment validation failed: ${missing.join(', ')}`,
      missing
    );
  }

  // Log warnings in development
  if (warnings.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn('Environment warnings:', warnings);
  }

  // Build typed config object instead of unsafe assertion
  return {
    // Required variables (already validated)
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    NEXT_PUBLIC_HOST: process.env.NEXT_PUBLIC_HOST!,
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE!,
    NODE_ENV: process.env.NODE_ENV!,
    
    // Optional variables
    EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY,
    EVOLUTION_WEBHOOK_SECRET: process.env.EVOLUTION_WEBHOOK_SECRET,
    EVOLUTION_API_BASE: process.env.EVOLUTION_API_BASE,
    EVOLUTION_INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME,
    WHATSAPP_API_KEY: process.env.WHATSAPP_API_KEY,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY,
    PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PUBLIC_KEY: process.env.STRIPE_PUBLIC_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    
    // Feature flags
    ENABLE_WHATSAPP_INTEGRATION: process.env.ENABLE_WHATSAPP_INTEGRATION,
    ENABLE_PHASE5_FEATURES: process.env.ENABLE_PHASE5_FEATURES,
    ENABLE_ANALYTICS_DASHBOARD: process.env.ENABLE_ANALYTICS_DASHBOARD,
    ENABLE_MESSAGING_ADAPTER: process.env.ENABLE_MESSAGING_ADAPTER,
    ENABLE_ADVANCED_SCHEDULER: process.env.ENABLE_ADVANCED_SCHEDULER,
  } as EnvConfig;
}

// Feature flag definitions with validation
export type FeatureFlag = 
  | 'ENABLE_WHATSAPP_INTEGRATION'
  | 'ENABLE_PHASE5_FEATURES'
  | 'ENABLE_ANALYTICS_DASHBOARD'
  | 'ENABLE_MESSAGING_ADAPTER'
  | 'ENABLE_ADVANCED_SCHEDULER';

// Feature flag metadata for validation and documentation
export const FEATURE_FLAG_CONFIG: Record<FeatureFlag, {
  description: string;
  defaultValue: boolean;
  requiredEnvVars?: string[];
  dependencies?: FeatureFlag[];
}> = {
  'ENABLE_WHATSAPP_INTEGRATION': {
    description: 'Enable WhatsApp messaging integration via Evolution API',
    defaultValue: false,
    requiredEnvVars: ['EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_SECRET', 'EVOLUTION_API_BASE']
  },
  'ENABLE_PHASE5_FEATURES': {
    description: 'Enable Phase 5 advanced features and UI components',
    defaultValue: true
  },
  'ENABLE_ANALYTICS_DASHBOARD': {
    description: 'Enable advanced analytics and reporting dashboard',
    defaultValue: true
  },
  'ENABLE_MESSAGING_ADAPTER': {
    description: 'Enable messaging adapter for chat and notifications',
    defaultValue: false,
    requiredEnvVars: ['REDIS_URL'],
    dependencies: ['ENABLE_PHASE5_FEATURES']
  },
  'ENABLE_ADVANCED_SCHEDULER': {
    description: 'Enable ML-powered advanced scheduling features',
    defaultValue: true,
    dependencies: ['ENABLE_PHASE5_FEATURES']
  }
};

/**
 * Validate feature flag value with proper type checking
 */
function validateFeatureFlagValue(value: string | undefined): boolean {
  if (value === undefined || value === '') {
    return false;
  }
  
  // Accept various truthy values
  const truthyValues = ['true', '1', 'yes', 'on', 'enabled'];
  const falsyValues = ['false', '0', 'no', 'off', 'disabled'];
  
  const normalizedValue = value.toLowerCase().trim();
  
  if (truthyValues.includes(normalizedValue)) {
    return true;
  }
  
  if (falsyValues.includes(normalizedValue)) {
    return false;
  }
  
  // Invalid value - log warning and return false
  console.warn(`Invalid feature flag value: "${value}". Expected: ${[...truthyValues, ...falsyValues].join(', ')}`);
  return false;
}

/**
 * Get feature flag value with validation and defaults
 */
export function getFeatureFlag(flag: FeatureFlag): boolean {
  const config = FEATURE_FLAG_CONFIG[flag];
  const envValue = process.env[flag];
  
  // Use default if not set
  if (!envValue) {
    return config.defaultValue;
  }
  
  const isEnabled = validateFeatureFlagValue(envValue);
  
  // Check dependencies if enabled
  if (isEnabled && config.dependencies) {
    for (const dependency of config.dependencies) {
      if (!getFeatureFlag(dependency)) {
        console.warn(`Feature flag ${flag} is enabled but dependency ${dependency} is disabled. Feature may not work correctly.`);
      }
    }
  }
  
  return isEnabled;
}

/**
 * Get all feature flags with their current values
 */
export function getAllFeatureFlags(): Record<FeatureFlag, boolean> {
  const flags: Record<string, boolean> = {};
  
  for (const flag of Object.keys(FEATURE_FLAG_CONFIG) as FeatureFlag[]) {
    flags[flag] = getFeatureFlag(flag);
  }
  
  return flags as Record<FeatureFlag, boolean>;
}

/**
 * Validate feature flag configuration and dependencies
 */
export function validateFeatureFlags(): { 
  valid: boolean; 
  errors: string[]; 
  warnings: string[]; 
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  for (const [flag, config] of Object.entries(FEATURE_FLAG_CONFIG) as Array<[FeatureFlag, typeof FEATURE_FLAG_CONFIG[FeatureFlag]]>) {
    const isEnabled = getFeatureFlag(flag);
    
    if (isEnabled && config.requiredEnvVars) {
      for (const envVar of config.requiredEnvVars) {
        if (!process.env[envVar]) {
          errors.push(`Feature flag ${flag} is enabled but required environment variable ${envVar} is missing`);
        }
      }
    }
    
    if (isEnabled && config.dependencies) {
      for (const dependency of config.dependencies) {
        if (!getFeatureFlag(dependency)) {
          warnings.push(`Feature flag ${flag} is enabled but dependency ${dependency} is disabled`);
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Get service configuration
 */
export function getServiceConfig() {
  const env = validateEnvironment();
  
  return {
    supabase: {
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY
    },
    
    evolution: env.EVOLUTION_API_KEY ? {
      apiKey: env.EVOLUTION_API_KEY,
      webhookSecret: env.EVOLUTION_WEBHOOK_SECRET,
      baseUrl: env.EVOLUTION_API_BASE,
      instanceName: process.env.EVOLUTION_INSTANCE_NAME || 'booka_instance'
    } : null,
    
    redis: env.REDIS_URL ? {
      url: env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    } : null,
    
    openrouter: env.OPENROUTER_API_KEY ? {
      apiKey: env.OPENROUTER_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL || 'https://api.openrouter.ai'
    } : null,
    
    payments: {
      paystack: env.PAYSTACK_SECRET_KEY ? {
        secretKey: env.PAYSTACK_SECRET_KEY,
        publicKey: process.env.PAYSTACK_PUBLIC_KEY
      } : null,
      
      stripe: env.STRIPE_SECRET_KEY ? {
        secretKey: env.STRIPE_SECRET_KEY,
        publicKey: process.env.STRIPE_PUBLIC_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      } : null
    },
    
    monitoring: {
      sentry: env.SENTRY_DSN ? {
        dsn: env.SENTRY_DSN,
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT
      } : null
    },
    
    features: {
      whatsappIntegration: getFeatureFlag('ENABLE_WHATSAPP_INTEGRATION'),
      phase5Features: getFeatureFlag('ENABLE_PHASE5_FEATURES'),
      analyticsDashboard: getFeatureFlag('ENABLE_ANALYTICS_DASHBOARD'),
      messagingAdapter: getFeatureFlag('ENABLE_MESSAGING_ADAPTER'),
      advancedScheduler: getFeatureFlag('ENABLE_ADVANCED_SCHEDULER')
    }
  };
}

/**
 * Runtime environment check
 */
export function checkEnvironment() {
  try {
    validateEnvironment();
    return { valid: true, error: null };
  } catch (error) {
    return { 
      valid: false, 
      error: error instanceof EnvValidationError ? error : new Error('Unknown validation error')
    };
  }
}