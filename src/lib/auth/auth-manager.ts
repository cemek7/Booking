/**
 * Auth Manager
 * 
 * Main orchestrator for authentication operations:
 * - Store/retrieve tokens and user data
 * - Determine user role and redirect path
 * - Provide auth state for components
 * - Handle logout and cleanup
 * 
 * Single source of truth for all auth operations
 */

import { defaultLogger } from '@/lib/logger';
import { toBookaDashboardPath } from '@/lib/navigation/dashboard-path';
import {
  getStoredAccessToken,
  getStoredUserData,
  getStoredTenantId,
  getStoredRole,
  getStoredIsAdmin,
  setStoredAccessToken,
  storeAllAuthData,
  clearAllAuthData,
  StoredUserData,
} from './token-storage';

export type UserType = 'admin' | 'tenant-owner' | 'tenant-manager' | 'tenant-staff' | 'unknown';

export interface AuthState {
  isAuthenticated: boolean;
  userType: UserType;
  userData?: StoredUserData;
  tenantId?: string;
  role?: string;
  isAdmin: boolean;
  accessToken?: string;
}

export interface SignInResult {
  success: boolean;
  error?: string;
  userType?: UserType;
  redirectUrl?: string;
}

/**
 * Get current auth state from localStorage
 */
export function getAuthState(): AuthState {
  const token = getStoredAccessToken();
  const userData = getStoredUserData();
  const tenantId = getStoredTenantId();
  const role = getStoredRole();
  const isAdmin = getStoredIsAdmin();

  return {
    isAuthenticated: !!token && !!userData,
    userType: determineUserType(isAdmin, role),
    userData: userData ?? undefined,
    tenantId: tenantId ?? undefined,
    role: role ?? undefined,
    isAdmin,
    accessToken: token || undefined,
  };
}

/**
 * Determine user type based on admin flag and role
 */
export function determineUserType(
  isAdmin: boolean,
  role?: string | null
): UserType {
  if (isAdmin) return 'admin';

  if (!role) return 'unknown';

  if (role === 'owner') return 'tenant-owner';
  if (role === 'manager') return 'tenant-manager';
  if (role === 'staff') return 'tenant-staff';

  return 'unknown';
}

/**
 * Get redirect URL based on user type and role.
 *
 * Emits the public Booka workspace URL directly (via toBookaDashboardPath) so
 * post-sign-in navigation lands on the canonical path without the extra
 * /dashboard -> /booka/dashboard middleware redirect hop. Mirrors
 * getRoleDashboardPath in @/types/unified-permissions.
 *
 * Superadmin: /booka/dashboard/superadmin
 * Owner: /booka/dashboard
 * Manager: /booka/dashboard?role=manager
 * Staff: /booka/dashboard?role=staff
 */
export function getRedirectUrl(userType: UserType, role?: string | null): string {
  if (userType === 'admin') return toBookaDashboardPath('/dashboard/superadmin');

  if (userType === 'unknown') return '/';

  // Booka workspace base ('/booka/dashboard'); query is appended after mapping
  // because toBookaDashboardPath expects a bare pathname.
  const base = toBookaDashboardPath('/dashboard');

  // Tenant users
  if (role === 'owner') return base;
  if (role === 'manager') return `${base}?role=manager`;
  if (role === 'staff') return `${base}?role=staff`;

  // Default for unknown roles
  return base;
}

/**
 * Store auth data after successful sign-in
 * 
 * Called from auth/callback/route.ts
 * 
 * Params typically come from /api/admin/check:
 * {
 *   admin?: boolean,
 *   tenant_id?: string,
 *   role?: 'owner' | 'manager' | 'staff',
 *   email: string,
 *   user_id: string
 * }
 */
export function storeSignInData(params: {
  accessToken: string;
  admin?: boolean;
  tenant_id?: string;
  role?: 'owner' | 'manager' | 'staff';
  email: string;
  user_id: string;
}): void {
  defaultLogger.info('[AuthManager] Storing sign-in data for:', params.email);
  const userTypeLabel = params.admin
    ? 'admin'
    : params.tenant_id && params.role
      ? `tenant-${params.role}`
      : 'onboarding-pending';
  defaultLogger.info('[AuthManager] User type:', userTypeLabel);
  
  const userData: StoredUserData = {
    email: params.email,
    user_id: params.user_id,
    tenant_id: params.tenant_id,
    role: params.role,
    admin: params.admin,
  };

  storeAllAuthData({
    token: params.accessToken,
    userData,
    tenantId: params.tenant_id,
    role: params.role,
    isAdmin: params.admin || false,
  });

  defaultLogger.info('[AuthManager] ✓ Sign-in data stored successfully');
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getStoredAccessToken() && !!getStoredUserData();
}

/**
 * Check if user is a global admin
 */
export function isGlobalAdmin(): boolean {
  return getStoredIsAdmin();
}

/**
 * Check if user has specific tenant role
 */
export function hasRole(role: 'owner' | 'manager' | 'staff'): boolean {
  return getStoredRole() === role;
}

/**
 * Check if user belongs to specific tenant
 */
export function hasTenant(tenantId: string): boolean {
  return getStoredTenantId() === tenantId;
}

/**
 * Get current user email
 */
export function getUserEmail(): string | undefined {
  return getStoredUserData()?.email;
}

/**
 * Get current user ID
 */
export function getUserId(): string | undefined {
  return getStoredUserData()?.user_id;
}

/**
 * Get current tenant ID
 */
export function getTenantId(): string | undefined {
  return getStoredTenantId() ?? undefined;
}

/**
 * Get current access token
 */
export function getAccessToken(): string | null {
  return getStoredAccessToken();
}

/**
 * Clear all auth data and prepare for logout
 */
export function logout(): void {
  clearAllAuthData();
}

/**
 * Update token (for token refresh)
 */
export function updateAccessToken(newToken: string): void {
  setStoredAccessToken(newToken);
}

/**
 * Verify auth data integrity
 */
export function verifyAuthDataIntegrity(): boolean {
  const token = getStoredAccessToken();
  const userData = getStoredUserData();

  if (!token) {
    defaultLogger.warn('[AuthManager] Missing access token');
    return false;
  }

  if (!userData?.email || !userData?.user_id) {
    defaultLogger.warn('[AuthManager] Missing user data');
    return false;
  }

  return true;
}
