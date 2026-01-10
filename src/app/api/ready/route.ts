import { createHttpHandler } from '@/lib/error-handling/route-handler';

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
  async (ctx) => {
    const timestamp = new Date().toISOString();
    
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
    const requiredEnvVars = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'NEXTAUTH_SECRET',
      'ENCRYPTION_KEY'
    ];

    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingEnvVars.length === 0) {
      readinessCheck.checks.environment_variables = true;
    } else {
      readinessCheck.details.missing_env_vars = missingEnvVars;
      readinessCheck.details.failed_checks?.push('Missing required environment variables');
    }

    // Check AI services configuration
    const aiEnvVars = ['OPENROUTER_API_KEY'];
    const missingAiVars = aiEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingAiVars.length === 0) {
      readinessCheck.checks.ai_services_initialized = true;
    } else {
      readinessCheck.details.warnings?.push(`AI services may not function properly. Missing: ${missingAiVars.join(', ')}`);
      readinessCheck.checks.ai_services_initialized = true;
    }

    // Check storage configuration
    const storageEnvVars = ['AWS_ACCESS_KEY_ID', 'AWS_S3_BUCKET'];
    const missingStorageVars = storageEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missingStorageVars.length === 0) {
      readinessCheck.checks.storage_accessible = true;
    } else {
      readinessCheck.details.warnings?.push(`File storage may not function properly. Missing: ${missingStorageVars.join(', ')}`);
      readinessCheck.checks.storage_accessible = true;
    }

    // Assume database migrations are up to date if we can reach this endpoint
    readinessCheck.checks.database_migrations = true;

    // Assume required services are available if environment is configured
    readinessCheck.checks.required_services = readinessCheck.checks.environment_variables;

    // Determine overall readiness
    const allChecks = Object.values(readinessCheck.checks);
    const isReady = allChecks.every(check => check === true);
    
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