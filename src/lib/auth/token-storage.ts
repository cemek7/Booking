/**
 * Unified Token & User Data Storage
 * 
 * Manages:
 * - JWT access tokens (from Supabase)
 * - User role and tenant information
 * - Persistent localStorage with fallback to session
 * 
 * Single source of truth for auth state across app
 */

export interface StoredUserData {
  email: string;
  user_id: string;
  tenant_id?: string;
  role?: 'owner' | 'manager' | 'staff';
  admin?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  expiresAt?: number;
}

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'boka_auth_access_token',
  USER_DATA: 'boka_auth_user_data',
  TENANT_ID: 'boka_auth_tenant_id',
  ROLE: 'boka_auth_role',
  IS_ADMIN: 'boka_auth_is_admin',
};

/**
 * Get the stored access token from localStorage
 */
export function getStoredAccessToken(): string | null {
  try {
    if (typeof window === 'undefined') {
      console.debug('[TokenStorage] Skipping localStorage read (server-side)');
      return null;
    }
    const token = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (token) {
      console.debug('[TokenStorage] ✓ Access token retrieved (length:', token.length, ')');
    } else {
      console.warn('[TokenStorage] ✗ Access token NOT found in localStorage');
      console.warn('[TokenStorage] Available keys:', Object.keys(localStorage));
    }
    return token;
  } catch (err) {
    console.error('[TokenStorage] Failed to get access token:', err);
    return null;
  }
}

/**
 * Store the access token in localStorage
 */
export function setStoredAccessToken(token: string): void {
  try {
    if (typeof window === 'undefined') {
      console.debug('[TokenStorage] Skipping localStorage write (server-side)');
      return;
    }
    localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, token);
    
    // Verify it was stored
    const verify = localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    if (verify === token) {
      console.log('[TokenStorage] ✓ Access token stored and verified (length:', token.length, ')');
    } else {
      console.error('[TokenStorage] ✗ CRITICAL: Access token storage verification FAILED');
    }
  } catch (err) {
    console.error('[TokenStorage] Failed to set access token:', err);
  }
}

/**
 * Get stored user data from localStorage
 */
export function getStoredUserData(): StoredUserData | null {
  try {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem(STORAGE_KEYS.USER_DATA);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[TokenStorage] Failed to get user data:', err);
    return null;
  }
}

/**
 * Store user data in localStorage
 */
export function setStoredUserData(userData: StoredUserData): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
  } catch (err) {
    console.error('[TokenStorage] Failed to set user data:', err);
  }
}

/**
 * Get stored tenant ID
 */
export function getStoredTenantId(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEYS.TENANT_ID);
  } catch (err) {
    console.error('[TokenStorage] Failed to get tenant ID:', err);
    return null;
  }
}

/**
 * Store tenant ID
 */
export function setStoredTenantId(tenantId: string): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.TENANT_ID, tenantId);
  } catch (err) {
    console.error('[TokenStorage] Failed to set tenant ID:', err);
  }
}

/**
 * Get stored role
 */
export function getStoredRole(): 'owner' | 'manager' | 'staff' | null {
  try {
    if (typeof window === 'undefined') return null;
    const role = localStorage.getItem(STORAGE_KEYS.ROLE);
    return role as 'owner' | 'manager' | 'staff' | null;
  } catch (err) {
    console.error('[TokenStorage] Failed to get role:', err);
    return null;
  }
}

/**
 * Store role
 */
export function setStoredRole(role: 'owner' | 'manager' | 'staff' | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (role) {
      localStorage.setItem(STORAGE_KEYS.ROLE, role);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ROLE);
    }
  } catch (err) {
    console.error('[TokenStorage] Failed to set role:', err);
  }
}

/**
 * Get admin flag
 */
export function getStoredIsAdmin(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEYS.IS_ADMIN) === 'true';
  } catch (err) {
    console.error('[TokenStorage] Failed to get admin flag:', err);
    return false;
  }
}

/**
 * Store admin flag
 */
export function setStoredIsAdmin(isAdmin: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEYS.IS_ADMIN, String(isAdmin));
  } catch (err) {
    console.error('[TokenStorage] Failed to set admin flag:', err);
  }
}

/**
 * Clear all auth data from storage
 */
export function clearAllAuthData(): void {
  try {
    if (typeof window === 'undefined') return;
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (err) {
    console.error('[TokenStorage] Failed to clear auth data:', err);
  }
}

/**
 * Get all stored auth data at once
 */
export function getStoredAuthData(): {
  token: string | null;
  userData: StoredUserData | null;
  tenantId: string | null;
  role: 'owner' | 'manager' | 'staff' | null;
  isAdmin: boolean;
} {
  return {
    token: getStoredAccessToken(),
    userData: getStoredUserData(),
    tenantId: getStoredTenantId(),
    role: getStoredRole(),
    isAdmin: getStoredIsAdmin(),
  };
}

/**
 * Store all auth data at once (used after signin)
 */
export function storeAllAuthData(params: {
  token: string;
  userData: StoredUserData;
  tenantId?: string;
  role?: 'owner' | 'manager' | 'staff';
  isAdmin?: boolean;
}): void {
  setStoredAccessToken(params.token);
  setStoredUserData(params.userData);
  if (params.tenantId) setStoredTenantId(params.tenantId);
  if (params.role) setStoredRole(params.role);
  if (params.isAdmin) setStoredIsAdmin(params.isAdmin);
}
