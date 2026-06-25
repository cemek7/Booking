/**
 * CONSOLIDATED AUTHENTICATION TYPES - CANONICAL SOURCE
 *
 * Single import point for all auth types:
 *   import { UnifiedAuthContext, AuthContext, AuthenticatedUser } from '@/types/auth'
 */

import type { Role } from './roles';
import type { StrictUserWithRole } from './unified-permissions';
import { z } from 'zod';

// ============================================================================
// PRIMARY UNIFIED AUTHENTICATION CONTEXT
// ============================================================================

/**
 * Unified authentication context available to all route handlers
 * This is the standard return type from all auth middleware and orchestrator methods
 */
export interface UnifiedAuthContext {
  userId: string;
  email: string;
  role: Role;
  tenantId: string;
  permissions: string[];
  effectiveRoles: Role[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// SESSION MANAGEMENT TYPES
// ============================================================================

/**
 * Session data structure for tracking user sessions
 * Includes device fingerprinting and activity tracking
 */
export interface AuthSession {
  sessionId: string;
  userId: string;
  token: string;
  refreshToken?: string;
  expiresAt: Date;
  createdAt: Date;
  lastActivity: Date;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  isActive: boolean;
}

// ============================================================================
// MFA TYPES
// ============================================================================

/**
 * MFA configuration
 * Used for managing MFA setup and verification
 */
export interface MFAConfig {
  userId: string;
  method: 'totp' | 'sms' | 'email' | 'backup_codes';
  enabled: boolean;
  secret?: string;
  backupCodes?: string[];
  phone?: string;
  email?: string;
  verifiedAt?: Date;
}

/**
 * MFA configuration
 * More comprehensive tracking with failure counts
 */
export interface MFAConfigExtended {
  id: string;
  user_id: string;
  method: 'totp' | 'sms' | 'email' | 'backup_codes';
  is_primary: boolean;
  is_enabled: boolean;
  verified_at?: Date;
  last_used_at?: Date;
  failure_count: number;
  blocked_until?: Date;
}

// ============================================================================
// API KEY TYPES
// ============================================================================

/**
 * API Key structure for programmatic access
 * Keys are hashed for security
 */
export interface APIKey {
  keyId: string;
  userId: string;
  tenantId: string;
  name: string;
  keyHash: string; // Hashed for security
  scopes: string[];
  rateLimitPerHour: number;
  createdAt: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
  isActive: boolean;
}

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

/**
 * Audit log entry for tracking authentication events
 */
export interface AuditLogEntry {
  id: string;
  timestamp: Date;
  userId: string;
  tenantId: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

// ============================================================================
// AUTHENTICATION EVENT TYPES
// ============================================================================

/**
 * Comprehensive authentication event type
 * Tracks all types of authentication-related events
 */
export interface AuthenticationEvent {
  user_id: string;
  event_type:
    | 'login'
    | 'logout'
    | 'login_failed'
    | 'password_change'
    | 'mfa_setup'
    | 'mfa_verify'
    | 'mfa_failed'
    | 'session_timeout'
    | 'forced_logout'
    | 'password_reset'
    | 'security_settings_change'
    | 'unauthorized_action'
    | 'session_terminated'
    | 'account_locked'
    | 'rate_limit_exceeded'
    | string;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
  success: boolean;
  failure_reason?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// USER SESSION TYPES
// ============================================================================

/**
 * User session tracking
 * Enhanced session data with device fingerprinting
 */
export interface UserSession {
  id: string;
  session_token: string;
  user_id: string;
  tenant_id?: string;
  ip_address?: string;
  user_agent?: string;
  device_fingerprint?: string;
  is_active: boolean;
  last_activity: Date;
  expires_at: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// SECURITY METRICS TYPES
// ============================================================================

/**
 * Security metrics for user accounts
 * Used for anomaly detection and security monitoring
 */
export interface SecurityMetrics {
  login_count: number;
  failed_login_count: number;
  unique_ips: number;
  unique_devices: number;
  mfa_verifications: number;
  password_changes: number;
  lockout_events: number;
  last_login?: Date;
  suspicious_activity_score: 'low' | 'medium' | 'high';
}

// ============================================================================
// MIDDLEWARE AUTH CONTEXT (from middleware.ts)
// ============================================================================

/**
 * Authentication context used in middleware
 * Provides user and tenant information to request handlers
 */
export interface AuthContext {
  user: {
    id: string;
    email: string;
    role: Role;
  };
  tenant: {
    id: string;
    name: string;
  } | null;
}

// ============================================================================
// LOGIN DATA VALIDATION & TYPES
// ============================================================================

/**
 * Login request data validation schema
 */
export const LoginDataSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  mfa_code: z.string().optional(),
  remember_me: z.boolean().default(false),
  device_fingerprint: z.string().optional()
});

export type LoginData = z.infer<typeof LoginDataSchema>;

/**
 * Client information for security tracking
 */
export interface ClientInfo {
  ip_address?: string;
  user_agent?: string;
}

/**
 * Login operation result
 */
export interface LoginResult {
  success: boolean;
  user?: unknown;
  session?: UserSession;
  mfa_required?: boolean;
  mfa_verified?: boolean;
  error?: string;
  error_details?: unknown;
  status?: number;
}

// ============================================================================
// ENHANCED AUTHENTICATED USER (from server-auth.ts)
// ============================================================================

/**
 * Authenticated user extended with unified auth context
 * Used in server components and API routes
 * 
 * Extends StrictUserWithRole with additional auth information
 */
export interface AuthenticatedUser extends StrictUserWithRole {
  tenantId: string;
  permissions: string[];
  effectiveRoles: Role[];
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// FAILURE TRACKING (for security monitoring)
// ============================================================================

/**
 * Failed authentication attempt tracking
 * Used for account lockout and anomaly detection
 */
export interface FailedAuthAttempt {
  userId: string;
  timestamp: Date;
  ip?: string;
  userAgent?: string;
  reason: string;
}

/**
 * Account lockout status
 */
export interface AccountLockout {
  userId: string;
  lockedUntil: Date;
  reason: string;
  attemptCount: number;
}

// ============================================================================
// RUNTIME SUPPORT & FEATURE GATES
// ============================================================================

/**
 * Runtime information for conditional feature support
 * Used by the consolidated auth runtime for Edge vs Node.js differentiation
 */
export interface RuntimeInfo {
  isEdge: boolean;
  supportsFullAuth: boolean;
  supportsMFA: boolean;
  supportsAPIKeys: boolean;
  supportsMetrics: boolean;
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Check if object is a valid UnifiedAuthContext
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isUnifiedAuthContext(obj: unknown): obj is UnifiedAuthContext {
  return (
    isRecord(obj) &&
    typeof obj.userId === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.role === 'string' &&
    typeof obj.tenantId === 'string' &&
    Array.isArray(obj.permissions) &&
    Array.isArray(obj.effectiveRoles)
  );
}

/**
 * Check if object is a valid AuthSession
 */
export function isAuthSession(obj: unknown): obj is AuthSession {
  return (
    isRecord(obj) &&
    typeof obj.sessionId === 'string' &&
    typeof obj.userId === 'string' &&
    typeof obj.token === 'string' &&
    obj.expiresAt instanceof Date
  );
}

/**
 * Check if object is a valid AuthContext (from middleware)
 */
export function isAuthContext(obj: unknown): obj is AuthContext {
  return (
    isRecord(obj) &&
    isRecord(obj.user) &&
    typeof obj.user.id === 'string' &&
    typeof obj.user.email === 'string' &&
    typeof obj.user.role === 'string'
  );
}

// ============================================================================
// CANONICAL TYPE EXPORTS
// ============================================================================

/**
 * Canonical alias for UnifiedAuthContext.
 */
export type AuthContextCanonical = UnifiedAuthContext;

/**
 * Alternative name for AuthenticationEvent
 */
export type AuthEvent = AuthenticationEvent;

// ============================================================================
// APP USER (shared shape for service-layer functions)
// ============================================================================

/**
 * Minimal authenticated user shape expected by service-layer functions.
 * Mirrors the `user` field on RouteContext and the test mocks.
 */
export interface AppUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  full_name?: string;
}
