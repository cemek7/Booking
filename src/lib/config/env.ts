/**
 * Environment Configuration System - Phase 1
 * 
 * Centralized, type-safe environment variable management with Zod validation.
 * This ensures all required variables are present and correctly typed at startup.
 * 
 * USAGE:
 * import { config } from '@/lib/config/env';
 * const apiKey = config.supabase.url;
 */

import { z } from 'zod';

// ============================================================================
// ENVIRONMENT SCHEMAS BY CATEGORY
// ============================================================================

/**
 * Supabase configuration schema
 */
const SupabaseSchema = z.object({
  url: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  anonKey: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  serviceRoleKey: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required')
});

/**
 * WhatsApp/Evolution API schema
 */
const WhatsAppSchema = z.object({
  apiKey: z.string().optional().default(''),
  webhookSecret: z.string().optional().default(''),
  apiBase: z.string().url().optional().default('https://api.evolution.example'),
  instanceName: z.string().optional().default('booka_instance'),
  whatsappApiKey: z.string().optional().default('')
});

/**
 * Redis configuration schema
 */
const RedisSchema = z.object({
  url: z.string().url().optional().default('redis://localhost:6379'),
  password: z.string().optional().default('')
});

/**
 * LLM services schema
 */
const LLMSchema = z.object({
  openrouterApiKey: z.string().optional().default(''),
  openrouterBaseUrl: z.string().url().optional().default('https://api.openrouter.ai'),
  openrouterReferer: z.string().optional().default('https://chat.openrouter.ai'),
  openrouterUrl: z.string().url().optional().default('https://api.openrouter.ai/v1'),
  openrouterModel: z.string().optional().default('gpt-4o-mini'),
  openaiApiKey: z.string().optional().default(''),
  openaiModel: z.string().optional().default('gpt-4o-mini'),
  localLlmModel: z.string().optional().default('./models/distilgpt2')
});

/**
 * Payment providers schema
 */
const PaymentSchema = z.object({
  paystack: z.object({
    secretKey: z.string().optional().default(''),
    publicKey: z.string().optional().default('')
  }),
  stripe: z.object({
    secretKey: z.string().optional().default(''),
    publicKey: z.string().optional().default(''),
    webhookSecret: z.string().optional().default('')
  })
});

/**
 * Observability & monitoring schema
 */
const ObservabilitySchema = z.object({
  sentryDsn: z.string().optional().default(''),
  sentryOrg: z.string().optional().default(''),
  sentryProject: z.string().optional().default('')
});

/**
 * External services schema
 */
const ExternalServicesSchema = z.object({
  n8nChatWebhook: z.string().url().optional().default(''),
  slackWebhookUrl: z.string().url().optional().default(''),
  emailServiceApiKey: z.string().optional().default('')
});

/**
 * Application configuration schema
 */
const AppConfigSchema = z.object({
  host: z.string().optional().default('localhost:3000'),
  apiBase: z.string().url().optional().default('http://localhost:3001'),
  baseUrl: z.string().url().optional().default('http://localhost:3000'),
  nodeEnv: z.enum(['development', 'staging', 'production']).optional().default('development')
});

/**
 * Feature flags schema
 */
const FeatureFlagsSchema = z.object({
  enableWhatsappIntegration: z.string().transform(v => v === 'true').optional().default(false),
  enablePhase5Features: z.string().transform(v => v === 'true').optional().default(true),
  enableAnalyticsDashboard: z.string().transform(v => v === 'true').optional().default(true),
  enableMessagingAdapter: z.string().transform(v => v === 'true').optional().default(false),
  enableAdvancedScheduler: z.string().transform(v => v === 'true').optional().default(true)
});

/**
 * Security schema
 */
const SecuritySchema = z.object({
  jwtSecret: z.string().optional().default(''),
  webhookSignatureSecret: z.string().optional().default(''),
  encryptionKey: z.string().optional().default('')
});

/**
 * Database schema
 */
const DatabaseSchema = z.object({
  databaseUrl: z.string().optional().default(''),
  directUrl: z.string().optional().default('')
});

// ============================================================================
// COMPLETE ENVIRONMENT SCHEMA
// ============================================================================

/**
 * Master environment configuration schema
 */
const EnvironmentSchema = z.object({
  // Required sections
  supabase: SupabaseSchema.required(),
  app: AppConfigSchema,
  
  // Optional but important
  whatsapp: WhatsAppSchema,
  redis: RedisSchema,
  llm: LLMSchema,
  payment: PaymentSchema,
  observability: ObservabilitySchema,
  externalServices: ExternalServicesSchema,
  features: FeatureFlagsSchema,
  security: SecuritySchema,
  database: DatabaseSchema
});

// ============================================================================
// ENVIRONMENT PARSER
// ============================================================================

/**
 * Type for the validated config
 */
export type EnvironmentConfig = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate environment variables
 */
function parseEnvironment(): EnvironmentConfig {
  const env = {
    // Supabase
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
    },
    
    // Application
    app: {
      host: process.env.NEXT_PUBLIC_HOST,
      apiBase: process.env.NEXT_PUBLIC_API_BASE,
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL,
      nodeEnv: process.env.NODE_ENV
    },
    
    // WhatsApp
    whatsapp: {
      apiKey: process.env.EVOLUTION_API_KEY,
      webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET,
      apiBase: process.env.EVOLUTION_API_BASE,
      instanceName: process.env.EVOLUTION_INSTANCE_NAME,
      whatsappApiKey: process.env.WHATSAPP_API_KEY
    },
    
    // Redis
    redis: {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    },
    
    // LLM
    llm: {
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      openrouterBaseUrl: process.env.OPENROUTER_BASE_URL,
      openrouterReferer: process.env.OPENROUTER_REFERER,
      openrouterUrl: process.env.OPENROUTER_URL,
      openrouterModel: process.env.OPENROUTER_MODEL,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiModel: process.env.OPENAI_MODEL,
      localLlmModel: process.env.LOCAL_LLM_MODEL
    },
    
    // Payment
    payment: {
      paystack: {
        secretKey: process.env.PAYSTACK_SECRET_KEY,
        publicKey: process.env.PAYSTACK_PUBLIC_KEY
      },
      stripe: {
        secretKey: process.env.STRIPE_SECRET_KEY,
        publicKey: process.env.STRIPE_PUBLIC_KEY,
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
      }
    },
    
    // Observability
    observability: {
      sentryDsn: process.env.SENTRY_DSN,
      sentryOrg: process.env.SENTRY_ORG,
      sentryProject: process.env.SENTRY_PROJECT
    },
    
    // External Services
    externalServices: {
      n8nChatWebhook: process.env.N8N_CHAT_WEBHOOK,
      slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
      emailServiceApiKey: process.env.EMAIL_SERVICE_API_KEY
    },
    
    // Feature Flags
    features: {
      enableWhatsappIntegration: process.env.ENABLE_WHATSAPP_INTEGRATION,
      enablePhase5Features: process.env.ENABLE_PHASE5_FEATURES,
      enableAnalyticsDashboard: process.env.ENABLE_ANALYTICS_DASHBOARD,
      enableMessagingAdapter: process.env.ENABLE_MESSAGING_ADAPTER,
      enableAdvancedScheduler: process.env.ENABLE_ADVANCED_SCHEDULER
    },
    
    // Security
    security: {
      jwtSecret: process.env.JWT_SECRET,
      webhookSignatureSecret: process.env.WEBHOOK_SIGNATURE_SECRET,
      encryptionKey: process.env.ENCRYPTION_KEY
    },
    
    // Database
    database: {
      databaseUrl: process.env.DATABASE_URL,
      directUrl: process.env.DIRECT_URL
    }
  };

  try {
    return EnvironmentSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Environment validation failed:\n${missingVars}`);
    }
    throw error;
  }
}

// ============================================================================
// SINGLETON CONFIG INSTANCE
// ============================================================================

let cachedConfig: EnvironmentConfig | null = null;

/**
 * Get validated environment configuration
 * Parsed once and cached for performance
 */
export function getConfig(): EnvironmentConfig {
  if (!cachedConfig) {
    cachedConfig = parseEnvironment();
  }
  return cachedConfig;
}

/**
 * Convenience exports for common usage patterns
 */
export const config = {
  get supabase() {
    return getConfig().supabase;
  },
  get app() {
    return getConfig().app;
  },
  get whatsapp() {
    return getConfig().whatsapp;
  },
  get redis() {
    return getConfig().redis;
  },
  get llm() {
    return getConfig().llm;
  },
  get payment() {
    return getConfig().payment;
  },
  get observability() {
    return getConfig().observability;
  },
  get externalServices() {
    return getConfig().externalServices;
  },
  get features() {
    return getConfig().features;
  },
  get security() {
    return getConfig().security;
  },
  get database() {
    return getConfig().database;
  }
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(feature: keyof FeatureFlagsSchema['shape']): boolean {
  return config.features[feature] === true;
}

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return config.app.nodeEnv === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return config.app.nodeEnv === 'development';
}

/**
 * Get fully qualified API URL
 */
export function getApiUrl(path: string): string {
  const base = config.app.apiBase || config.app.baseUrl;
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}

/**
 * Check if critical service is configured
 */
export function isCriticalServiceConfigured(service: 'supabase' | 'redis' | 'payment'): boolean {
  const serviceConfigs = {
    supabase: config.supabase.url && config.supabase.anonKey,
    redis: config.redis.url && config.redis.password,
    payment: config.payment.paystack.secretKey || config.payment.stripe.secretKey
  };
  return !!serviceConfigs[service];
}
