/**
 * DEPRECATED: This file is kept for backward compatibility only
 * 
 * PHASE 2C: Middleware Consolidation
 * All middleware has been consolidated into src/lib/auth/middleware.ts
 * 
 * This file now simply re-exports from the consolidated middleware module.
 * Existing imports from this file will continue to work.
 * 
 * NEW PATTERN: Import from @/lib/auth/middleware instead
 */

// Re-export all middleware functions and types from consolidated location
export { withAuth, AuthMiddlewareOptions, getRequiredRoleForRoute, validateTenantAccess } from './middleware';

// For completeness, also export from types if anyone imported AuthContext from here
export type { AuthContext } from '@/types/auth';