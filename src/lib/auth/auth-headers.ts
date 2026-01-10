/**
 * Authorization Header Builder
 * 
 * Provides consistent Authorization headers for all API calls.
 * Automatically includes Bearer token from localStorage.
 * 
 * Used by auth-api-client to wrap all fetch requests.
 */

import { getStoredAccessToken, getStoredTenantId } from './token-storage';

export interface FetchHeaders {
  'Content-Type': string;
  'Authorization'?: string;
  'X-Tenant-ID'?: string;
  [key: string]: string | undefined;
}

/**
 * Build standard fetch headers with Authorization token
 * 
 * Returns object that can be spread into fetch init.headers
 */
export function buildAuthHeaders(): FetchHeaders {
  const headers: FetchHeaders = {
    'Content-Type': 'application/json',
  };

  const token = getStoredAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    console.debug('[AuthHeaders] ✓ Authorization header included (token length:', token.length, ')');
  } else {
    console.warn('[AuthHeaders] ✗ No access token found in localStorage');
  }

  const tenantId = getStoredTenantId();
  if (tenantId) {
    headers['X-Tenant-ID'] = tenantId;
    console.debug('[AuthHeaders] ✓ X-Tenant-ID header included');
  }

  return headers;
}

/**
 * Build headers for GET requests (auth + tenant headers)
 */
export function buildGetHeaders(): FetchHeaders {
  return buildAuthHeaders();
}

/**
 * Build headers for POST/PUT/PATCH requests
 */
export function buildMutationHeaders(): FetchHeaders {
  return buildAuthHeaders();
}

/**
 * Build headers for DELETE requests
 */
export function buildDeleteHeaders(): FetchHeaders {
  return buildAuthHeaders();
}

/**
 * Merge custom headers with auth headers
 * Custom headers take precedence over auth headers
 */
export function mergeHeaders(
  customHeaders?: Record<string, string>
): FetchHeaders {
  const authHeaders = buildAuthHeaders();
  if (customHeaders) {
    return { ...authHeaders, ...customHeaders };
  }
  return authHeaders;
}
