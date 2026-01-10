/**
 * Unified Authentication Orchestrator
 * Single source of truth for all authentication and authorization operations
 * 
 * PHASE 2B: Types consolidated to @/types/auth
 * This file imports and re-exports canonical type definitions from src/types/auth.ts
 * 
 * This replaces fragmented auth implementations across:
 * - server-auth.ts
 * - enhanced-auth.ts
 * - middleware.ts
 * - session.ts
 * - edge-enhanced-auth.ts
 * - node-enhanced-auth.ts
 * 
 * ENHANCED: Now includes session management, MFA, API keys, and audit logging
 */

import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { createHash, randomBytes } from 'crypto';

// Import canonical type definitions from consolidated location
// PHASE 2B: Types moved from scattered definitions to @/types/auth
import {
  UnifiedAuthContext,
  AuthSession,
  MFAConfig,
  APIKey,
  AuditLogEntry
} from '@/types/auth';

// Re-export types for backward compatibility with code that imports from orchestrator
export type { UnifiedAuthContext, AuthSession, MFAConfig, APIKey, AuditLogEntry };

export type Role = 'superadmin' | 'owner' | 'manager' | 'staff' | 'customer' | 'guest';

/**
 * Role hierarchy - defines which roles inherit from which
 * Higher in list = higher privilege
 */
const ROLE_HIERARCHY: Record<Role, Role[]> = {
  superadmin: ['superadmin', 'owner', 'manager', 'staff', 'customer', 'guest'],
  owner: ['owner', 'manager', 'staff', 'customer', 'guest'],
  manager: ['manager', 'staff', 'customer', 'guest'],
  staff: ['staff', 'customer', 'guest'],
  customer: ['customer', 'guest'],
  guest: ['guest'],
};

/**
 * Public paths that don't require authentication
 */
const PUBLIC_PATHS = [
  '/api/auth/callback',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/health',
  '/api/metrics/public',
  '/api/webhooks/stripe',
  '/api/webhooks/evolution',
  '/api/whatsapp/webhook',
];

/**
 * Unified Authentication Orchestrator
 * Singleton class managing all auth operations
 */
export class UnifiedAuthOrchestrator {
  private static instance: UnifiedAuthOrchestrator;
  private roleHierarchyCache: Map<string, Role[]> = new Map();
  private tenantRoleCache: Map<string, Map<string, Role>> = new Map();
  private sessionCache: Map<string, AuthSession> = new Map();
  private mfaConfigCache: Map<string, MFAConfig> = new Map();
  private apiKeyCache: Map<string, APIKey> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private failedAttempts: Map<string, { count: number; lastAttempt: Date }> = new Map();

  private constructor() {
    this.initializeCache();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UnifiedAuthOrchestrator {
    if (!UnifiedAuthOrchestrator.instance) {
      UnifiedAuthOrchestrator.instance = new UnifiedAuthOrchestrator();
    }
    return UnifiedAuthOrchestrator.instance;
  }

  /**
   * Initialize caches for performance
   */
  private initializeCache(): void {
    // Pre-populate role hierarchy cache
    Object.entries(ROLE_HIERARCHY).forEach(([role, hierarchy]) => {
      this.roleHierarchyCache.set(role, hierarchy);
    });
  }

  /**
   * Check if a path is public (doesn't require auth)
   */
  isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.some(
      (path) => pathname === path || pathname.startsWith(path + '/')
    );
  }

  /**
   * Resolve session from request and return authenticated context
   * Throws ApiError if authentication fails
   */
  async resolveSession(request: NextRequest): Promise<UnifiedAuthContext> {
    // Extract bearer token
    const authHeader = request.headers.get('authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      throw ApiErrorFactory.missingAuthorization();
    }

    const token = authHeader.slice(7);
    if (!token || token.length === 0) {
      throw ApiErrorFactory.invalidToken();
    }

    try {
      // Create Supabase client for session verification
      const cookieStore = await cookies();
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(cookiesToSet) {
              try {
                cookiesToSet.forEach(({ name, value, options }) => {
                  cookieStore.set(name, value, options);
                });
              } catch (error) {
                // Can't set cookies in some contexts
              }
            },
          },
        }
      );

      // Verify token and get user
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        throw ApiErrorFactory.tokenExpired();
      }

      // Get user's role and tenant info
      const { data: tenantUserData, error: tenantError } = await supabase
        .from('tenant_users')
        .select('user_id, role, tenant_id, tenants(id)')
        .eq('user_id', user.id)
        .single();

      if (tenantError && tenantError.code !== 'PGRST116') {
        throw ApiErrorFactory.databaseError(tenantError);
      }

      // Check if user is superadmin
      let isSuperadmin = false;
      let superadminRole: Role = 'guest';

      const { data: superadminData } = await supabase
        .from('admins')
        .select('role')
        .eq('email', user.email)
        .single();

      if (superadminData) {
        isSuperadmin = true;
        superadminRole = (superadminData.role || 'owner') as Role;
      }

      // Determine primary role and tenant
      const role: Role = isSuperadmin ? 'superadmin' : (tenantUserData?.role as Role) || 'guest';
      const tenantId = tenantUserData?.tenant_id || '';

      if (!tenantId && !isSuperadmin) {
        throw ApiErrorFactory.forbidden('User not associated with any tenant');
      }

      // Get effective roles (hierarchy)
      const effectiveRoles = this.getEffectiveRoles(role);

      // Get permissions for this role
      const permissions = this.getPermissionsForRole(role);

      // Log successful authentication
      await this.logAuthEvent('session_resolved', {
        userId: user.id,
        email: user.email,
        role,
        tenantId,
      }, request);

      return {
        userId: user.id,
        email: user.email!,
        role,
        tenantId,
        permissions,
        effectiveRoles,
        metadata: {
          isSuperadmin,
          superadminRole: isSuperadmin ? superadminRole : undefined,
          tokenIssuedAt: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Re-throw if already an ApiError
      if (error.code) {
        throw error;
      }
      // Wrap unexpected errors
      throw ApiErrorFactory.internalServerError(error);
    }
  }

  // =============================================
  // SESSION MANAGEMENT METHODS
  // =============================================

  /**
   * Create a new authenticated session
   */
  async createSession(userId: string, options?: {
    ip?: string;
    userAgent?: string;
    deviceId?: string;
    expiresIn?: number;
  }): Promise<AuthSession> {
    const sessionId = randomBytes(32).toString('hex');
    const token = randomBytes(32).toString('hex');
    const refreshToken = randomBytes(32).toString('hex');
    const expiresIn = options?.expiresIn || 28800; // 8 hours default

    const session: AuthSession = {
      sessionId,
      userId,
      token,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      createdAt: new Date(),
      lastActivity: new Date(),
      ip: options?.ip,
      userAgent: options?.userAgent,
      deviceId: options?.deviceId,
      isActive: true,
    };

    this.sessionCache.set(sessionId, session);
    await this.logAuthEvent('session_created', { sessionId, userId }, undefined, options?.ip);

    return session;
  }

  /**
   * Validate a session token
   */
  async validateSessionToken(token: string): Promise<AuthSession | null> {
    // Search cache first
    for (const [, session] of this.sessionCache) {
      if (session.token === token && session.isActive) {
        if (session.expiresAt > new Date()) {
          session.lastActivity = new Date();
          return session;
        } else {
          session.isActive = false;
        }
      }
    }
    return null;
  }

  /**
   * Refresh a session token
   */
  async refreshSessionToken(refreshToken: string): Promise<AuthSession | null> {
    // Search cache for refresh token
    for (const [, session] of this.sessionCache) {
      if (session.refreshToken === refreshToken && session.isActive) {
        if (session.expiresAt > new Date()) {
          // Generate new tokens
          session.token = randomBytes(32).toString('hex');
          session.refreshToken = randomBytes(32).toString('hex');
          session.expiresAt = new Date(Date.now() + 28800000); // 8 hours
          session.lastActivity = new Date();

          await this.logAuthEvent('session_refreshed', {
            sessionId: session.sessionId,
            userId: session.userId,
          });

          return session;
        }
      }
    }
    return null;
  }

  /**
   * Revoke a session
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    const session = this.sessionCache.get(sessionId);
    if (session) {
      session.isActive = false;
      await this.logAuthEvent('session_revoked', { sessionId });
      return true;
    }
    return false;
  }

  /**
   * List active sessions for user
   */
  async listActiveSessions(userId: string): Promise<AuthSession[]> {
    const sessions: AuthSession[] = [];
    for (const [, session] of this.sessionCache) {
      if (session.userId === userId && session.isActive && session.expiresAt > new Date()) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Enforce maximum concurrent sessions
   */
  async enforceSessionLimits(userId: string, maxSessions: number = 5): Promise<void> {
    const sessions = await this.listActiveSessions(userId);
    if (sessions.length > maxSessions) {
      // Revoke oldest sessions
      const toRevoke = sessions
        .sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime())
        .slice(0, sessions.length - maxSessions);

      for (const session of toRevoke) {
        await this.revokeSession(session.sessionId);
      }
    }
  }

  // =============================================
  // MFA MANAGEMENT METHODS
  // =============================================

  /**
   * Setup MFA for user
   */
  async setupMFA(userId: string, method: 'totp' | 'sms' | 'email', options?: {
    phone?: string;
    email?: string;
  }): Promise<MFAConfig> {
    const secret = randomBytes(32).toString('hex');
    const backupCodes = this.generateBackupCodes();

    const mfaConfig: MFAConfig = {
      userId,
      method,
      enabled: false,
      secret,
      backupCodes,
      phone: options?.phone,
      email: options?.email,
    };

    this.mfaConfigCache.set(`${userId}:${method}`, mfaConfig);
    await this.logAuthEvent('mfa_setup_started', { userId, method });

    return mfaConfig;
  }

  /**
   * Generate backup codes
   */
  private generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  /**
   * Verify MFA code
   */
  async verifyMFACode(userId: string, code: string, method: 'totp' | 'sms' | 'email' = 'totp'): Promise<boolean> {
    const mfaConfig = this.mfaConfigCache.get(`${userId}:${method}`);
    if (!mfaConfig) return false;

    // In production, use actual TOTP library
    // This is a simplified verification
    const isValid = code.length >= 6; // Placeholder validation

    if (isValid) {
      mfaConfig.enabled = true;
      mfaConfig.verifiedAt = new Date();
      await this.logAuthEvent('mfa_verified', { userId, method });
    } else {
      await this.logAuthEvent('mfa_verification_failed', { userId, method }, 'failure');
    }

    return isValid;
  }

  /**
   * Check if MFA is required for user
   */
  async isMFARequired(userId: string): Promise<boolean> {
    // Check if any MFA method is enabled
    for (const [key, mfaConfig] of this.mfaConfigCache) {
      if (key.startsWith(userId) && mfaConfig.enabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get MFA methods for user
   */
  async getMFAMethods(userId: string): Promise<MFAConfig[]> {
    const methods: MFAConfig[] = [];
    for (const [key, mfaConfig] of this.mfaConfigCache) {
      if (key.startsWith(userId)) {
        methods.push(mfaConfig);
      }
    }
    return methods;
  }

  // =============================================
  // API KEY MANAGEMENT METHODS
  // =============================================

  /**
   * Create an API key
   */
  async createAPIKey(userId: string, options: {
    tenantId: string;
    name: string;
    description?: string;
    scopes: string[];
    rateLimitPerHour?: number;
    expiresIn?: number;
  }): Promise<APIKey & { keyValue: string }> {
    const keyId = randomBytes(16).toString('hex');
    const keyValue = randomBytes(32).toString('hex');
    const keyHash = createHash('sha256').update(keyValue).digest('hex');

    const apiKey: APIKey = {
      keyId,
      userId,
      tenantId: options.tenantId,
      name: options.name,
      keyHash,
      scopes: options.scopes,
      rateLimitPerHour: options.rateLimitPerHour || 1000,
      createdAt: new Date(),
      expiresAt: options.expiresIn ? new Date(Date.now() + options.expiresIn * 1000) : undefined,
      isActive: true,
    };

    this.apiKeyCache.set(keyId, apiKey);
    await this.logAuthEvent('api_key_created', {
      userId,
      keyId,
      tenantId: options.tenantId,
      scopes: options.scopes,
    });

    return {
      ...apiKey,
      keyValue, // Only returned once during creation
    };
  }

  /**
   * Validate API key
   */
  async validateAPIKey(keyValue: string): Promise<APIKey | null> {
    const keyHash = createHash('sha256').update(keyValue).digest('hex');

    for (const [, apiKey] of this.apiKeyCache) {
      if (apiKey.keyHash === keyHash && apiKey.isActive) {
        if (!apiKey.expiresAt || apiKey.expiresAt > new Date()) {
          apiKey.lastUsedAt = new Date();
          await this.logAuthEvent('api_key_validated', {
            keyId: apiKey.keyId,
            userId: apiKey.userId,
          });
          return apiKey;
        }
      }
    }

    return null;
  }

  /**
   * Revoke an API key
   */
  async revokeAPIKey(keyId: string): Promise<boolean> {
    const apiKey = this.apiKeyCache.get(keyId);
    if (apiKey) {
      apiKey.isActive = false;
      await this.logAuthEvent('api_key_revoked', { keyId, userId: apiKey.userId });
      return true;
    }
    return false;
  }

  /**
   * List API keys for user
   */
  async listAPIKeys(userId: string): Promise<APIKey[]> {
    const keys: APIKey[] = [];
    for (const [, apiKey] of this.apiKeyCache) {
      if (apiKey.userId === userId) {
        keys.push(apiKey);
      }
    }
    return keys;
  }

  /**
   * Rotate an API key
   */
  async rotateAPIKey(keyId: string): Promise<APIKey & { keyValue: string } | null> {
    const oldKey = this.apiKeyCache.get(keyId);
    if (!oldKey) return null;

    await this.revokeAPIKey(keyId);

    return this.createAPIKey(oldKey.userId, {
      tenantId: oldKey.tenantId,
      name: oldKey.name,
      scopes: oldKey.scopes,
      rateLimitPerHour: oldKey.rateLimitPerHour,
    });
  }

  // =============================================
  // AUDIT LOGGING METHODS
  // =============================================

  /**
   * Log authentication event
   */
  private async logAuthEvent(
    action: string,
    details?: Record<string, any>,
    result: 'success' | 'failure' = 'success',
    ip?: string
  ): Promise<void> {
    const logEntry: AuditLogEntry = {
      id: randomBytes(16).toString('hex'),
      timestamp: new Date(),
      userId: details?.userId || 'system',
      tenantId: details?.tenantId || 'system',
      action,
      resource: 'auth',
      result,
      details,
      ip,
    };

    this.auditLog.push(logEntry);

    // Keep only last 1000 entries in memory
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
  }

  /**
   * Get audit log
   */
  async getAuditLog(options?: {
    userId?: string;
    tenantId?: string;
    action?: string;
    from?: Date;
    to?: Date;
  }): Promise<AuditLogEntry[]> {
    return this.auditLog.filter((entry) => {
      if (options?.userId && entry.userId !== options.userId) return false;
      if (options?.tenantId && entry.tenantId !== options.tenantId) return false;
      if (options?.action && entry.action !== options.action) return false;
      if (options?.from && entry.timestamp < options.from) return false;
      if (options?.to && entry.timestamp > options.to) return false;
      return true;
    });
  }

  // =============================================
  // SECURITY METHODS
  // =============================================

  /**
   * Track failed login attempts
   */
  async trackFailedAttempt(userId: string): Promise<number> {
    const attempts = this.failedAttempts.get(userId) || { count: 0, lastAttempt: new Date() };
    attempts.count++;
    attempts.lastAttempt = new Date();
    this.failedAttempts.set(userId, attempts);

    await this.logAuthEvent('login_failed', { userId }, 'failure');

    return attempts.count;
  }

  /**
   * Check if account is locked due to failed attempts
   */
  async isAccountLocked(userId: string, maxAttempts: number = 5, lockoutMinutes: number = 15): Promise<boolean> {
    const attempts = this.failedAttempts.get(userId);
    if (!attempts) return false;

    const lockoutExpired = Date.now() - attempts.lastAttempt.getTime() > lockoutMinutes * 60 * 1000;
    if (lockoutExpired) {
      this.failedAttempts.delete(userId);
      return false;
    }

    return attempts.count >= maxAttempts;
  }

  /**
   * Clear failed attempts (on successful login)
   */
  async clearFailedAttempts(userId: string): Promise<void> {
    this.failedAttempts.delete(userId);
    await this.logAuthEvent('login_successful', { userId });
  }

  // =============================================
  // EXISTING METHODS (PRESERVED)
  // =============================================

  /**
   * Validate user has required role
   */
  validateRole(user: UnifiedAuthContext | null | undefined, requiredRoles: Role[]): boolean {
    if (!user) return false;
    if (user.role === 'superadmin') return true; // Superadmin has all roles
    return requiredRoles.includes(user.role);
  }

  /**
   * Check if user has specific permission
   */
  validatePermission(
    user: UnifiedAuthContext | null | undefined,
    permission: string
  ): boolean {
    if (!user) return false;
    if (user.role === 'superadmin') return true; // Superadmin has all permissions
    return user.permissions.includes(permission);
  }

  /**
   * Get role hierarchy for a given role
   */
  getEffectiveRoles(role: Role): Role[] {
    const cached = this.roleHierarchyCache.get(role);
    if (cached) return cached;

    const hierarchy = ROLE_HIERARCHY[role] || ['guest'];
    this.roleHierarchyCache.set(role, hierarchy);
    return hierarchy;
  }

  /**
   * Check if one role can inherit another role's capabilities
   */
  canInherit(parentRole: Role, childRole: Role): boolean {
    const hierarchy = this.getEffectiveRoles(parentRole);
    return hierarchy.includes(childRole);
  }

  /**
   * Get all permissions for a role
   */
  getPermissionsForRole(role: Role): string[] {
    // This is populated from PERMISSIONS_MATRIX
    // For now, return basic default permissions
    const defaultPermissions: Record<Role, string[]> = {
      superadmin: [
        'read:all',
        'write:all',
        'delete:all',
        'manage:users',
        'manage:roles',
        'manage:tenants',
        'manage:billing',
        'view:analytics',
      ],
      owner: [
        'read:tenant',
        'write:tenant',
        'delete:tenant',
        'manage:staff',
        'manage:services',
        'manage:settings',
        'view:analytics',
      ],
      manager: [
        'read:tenant',
        'write:tenant',
        'manage:staff',
        'manage:services',
        'view:analytics',
      ],
      staff: [
        'read:tenant',
        'read:schedule',
        'write:schedule',
        'manage:own',
      ],
      customer: [
        'read:public',
        'write:own',
      ],
      guest: [
        'read:public',
      ],
    };

    return defaultPermissions[role] || [];
  }

  /**
   * Validate tenant access - ensure user belongs to tenant
   */
  validateTenantAccess(
    user: UnifiedAuthContext | null | undefined,
    tenantId: string
  ): boolean {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return user.tenantId === tenantId;
  }

  /**
   * Create appropriate error for auth failures
   */
  createAuthError(code: string, details?: any): Error {
    const errorMap: Record<string, () => Error> = {
      missing_authorization: () => ApiErrorFactory.missingAuthorization(),
      invalid_token: () => ApiErrorFactory.invalidToken(),
      token_expired: () => ApiErrorFactory.tokenExpired(),
      forbidden: () => ApiErrorFactory.forbidden('Access denied'),
      insufficient_permissions: () =>
        ApiErrorFactory.insufficientPermissions(details?.roles || []),
      tenant_mismatch: () => ApiErrorFactory.tenantMismatch(),
    };

    const errorFactory = errorMap[code];
    return errorFactory ? errorFactory() : ApiErrorFactory.internalServerError(new Error(code));
  }

  /**
   * Clear caches (for testing)
   */
  clearCache(): void {
    this.roleHierarchyCache.clear();
    this.tenantRoleCache.clear();
    this.sessionCache.clear();
    this.mfaConfigCache.clear();
    this.apiKeyCache.clear();
    this.auditLog = [];
    this.failedAttempts.clear();
    this.initializeCache();
  }
}

/**
 * Get singleton instance
 */
export function getAuthOrchestrator(): UnifiedAuthOrchestrator {
  return UnifiedAuthOrchestrator.getInstance();
}
