import { getAppConfig } from './configManager';
import { validateEnvironment } from './envValidation';

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  category: 'core' | 'integration' | 'ui' | 'experimental';
  requiredConfig?: string[];
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'whatsappIntegration',
    name: 'WhatsApp Integration',
    description: 'Enable WhatsApp booking and messaging through Evolution API',
    enabled: false,
    category: 'integration',
    requiredConfig: ['EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_SECRET']
  },
  {
    key: 'phase5Features',
    name: 'Phase 5 Advanced Features',
    description: 'Enable Phase 5 advanced scheduler and analytics features',
    enabled: false,
    category: 'core'
  },
  {
    key: 'analyticsDashboard',
    name: 'Analytics Dashboard',
    description: 'Enable advanced analytics and reporting dashboard',
    enabled: false,
    category: 'ui'
  },
  {
    key: 'messagingAdapter',
    name: 'Messaging Adapter',
    description: 'Enable messaging adapter with Redis backend',
    enabled: false,
    category: 'integration',
    requiredConfig: ['REDIS_URL']
  },
  {
    key: 'advancedScheduler',
    name: 'Advanced Scheduler',
    description: 'Enable advanced scheduling algorithms and optimization',
    enabled: false,
    category: 'core'
  },
  {
    key: 'multiTenant',
    name: 'Multi-Tenant Support',
    description: 'Enable multi-tenant architecture and isolation',
    enabled: false,
    category: 'core'
  }
];

/**
 * Get all feature flags with current status
 */
export function getAllFeatureFlags(): FeatureFlag[] {
  const config = getAppConfig();
  
  return FEATURE_FLAGS.map(flag => ({
    ...flag,
    enabled: config.features[flag.key as keyof typeof config.features] || false
  }));
}

/**
 * Check if a feature is enabled
 */
export function checkFeature(key: string): boolean {
  const config = getAppConfig();
  return config.features[key as keyof typeof config.features] || false;
}

/**
 * Get feature flag details
 */
export function getFeatureFlag(key: string): FeatureFlag | null {
  const flags = getAllFeatureFlags();
  return flags.find(flag => flag.key === key) || null;
}

/**
 * Get enabled features by category
 */
export function getEnabledFeaturesByCategory(category: FeatureFlag['category']): FeatureFlag[] {
  return getAllFeatureFlags().filter(flag => 
    flag.category === category && flag.enabled
  );
}

/**
 * Check if all required configuration is present for a feature
 */
export function checkFeatureRequirements(key: string): {
  satisfied: boolean;
  missing: string[];
} {
  const flag = getFeatureFlag(key);
  if (!flag || !flag.requiredConfig) {
    return { satisfied: true, missing: [] };
  }
  
  const missing = flag.requiredConfig.filter(configKey => {
    // Use environment validation instead of direct process.env access
    try {
      const env = validateEnvironment();
      return !env[configKey as keyof typeof env];
    } catch {
      return true; // If validation fails, consider config missing
    }
  });
  
  return {
    satisfied: missing.length === 0,
    missing
  };
}

/**
 * Get feature flags summary
 */
export function getFeatureFlagsSummary(): {
  total: number;
  enabled: number;
  disabled: number;
  misconfigured: number;
  categories: Record<string, { enabled: number; total: number }>;
} {
  const flags = getAllFeatureFlags();
  
  const summary = {
    total: flags.length,
    enabled: flags.filter(f => f.enabled).length,
    disabled: flags.filter(f => !f.enabled).length,
    misconfigured: 0,
    categories: {} as Record<string, { enabled: number; total: number }>
  };
  
  // Count misconfigured features
  summary.misconfigured = flags.filter(flag => {
    if (!flag.enabled) return false;
    const requirements = checkFeatureRequirements(flag.key);
    return !requirements.satisfied;
  }).length;
  
  // Count by category
  for (const flag of flags) {
    if (!summary.categories[flag.category]) {
      summary.categories[flag.category] = { enabled: 0, total: 0 };
    }
    summary.categories[flag.category].total++;
    if (flag.enabled) {
      summary.categories[flag.category].enabled++;
    }
  }
  
  return summary;
}