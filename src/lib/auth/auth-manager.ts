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

import {
  getStoredAccessToken,
  getStoredUserData,
  getStoredTenantId,
  getStoredRole,
  getStoredIsAdmin,
  setStoredAccessToken,
  setStoredUserData,
  setStoredTenantId,
  setStoredRole,
  setStoredIsAdmin,
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
    userData,
    tenantId,
    role,
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
 * Get redirect URL based on user type and role
 * 
 * Admin: /admin/dashboard
 * Owner: /dashboard
 * Manager: /dashboard?role=manager
 * Staff: /dashboard?role=staff
 */
export function getRedirectUrl(userType: UserType, role?: string | null): string {
  if (userType === 'admin') return '/admin/dashboard';

  if (userType === 'unknown') return '/';

  // Tenant users
  if (role === 'owner') return '/dashboard';
  if (role === 'manager') return '/dashboard?role=manager';
  if (role === 'staff') return '/dashboard?role=staff';

  // Default for unknown roles
  return '/dashboard';
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
  console.log('[AuthManager] Storing sign-in data for:', params.email);
  console.log('[AuthManager] User type:', params.admin ? 'admin' : `tenant-${params.role || 'staff'}`);
  
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

  console.log('[AuthManager] ✓ Sign-in data stored successfully');
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
  return getStoredTenantId();
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
    console.warn('[AuthManager] Missing access token');
    return false;
  }

  if (!userData?.email || !userData?.user_id) {
    console.warn('[AuthManager] Missing user data');
    return false;
  }

  return true;
}
