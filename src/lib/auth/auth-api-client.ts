/**
 * Authenticated API Client
 * 
 * Wrapper around fetch() that automatically:
 * - Adds Authorization Bearer token to all requests
 * - Adds X-Tenant-ID header for tenant context
 * - Handles response errors
 * - Provides type-safe responses
 * 
 * Usage:
 *   const data = await authFetch('/api/customers', { method: 'GET' })
 *   const newCustomer = await authFetch('/api/customers', { 
 *     method: 'POST', 
 *     body: { name: 'John' } 
 *   })
 */

import { buildAuthHeaders } from './auth-headers';
import { setStoredAccessToken } from './token-storage';

export interface ApiError {
  message: string;
  status: number;
  statusText: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
  status: number;
}

/**
 * Fetch options compatible with native fetch
 */
export interface AuthFetchOptions extends Omit<RequestInit, 'headers' | 'body'> {
  headers?: Record<string, string>;
  body?: unknown;
  tenantId?: string;
}

/**
 * Make an authenticated API request
 * 
 * Automatically adds Authorization header from localStorage
 * 
 * @param url - API endpoint (relative or absolute)
 * @param options - Fetch options (method, body, etc)
 * @returns Promise<ApiResponse<T>> with data or error
 */
export async function authFetch<T = unknown>(
  url: string,
  options: AuthFetchOptions = {}
): Promise<ApiResponse<T>> {
  const response = await fetchWithAuth<T>(url, options);
  return response;
}

/**
 * GET request helper
 */
export async function authGet<T = unknown>(
  url: string,
  options?: Omit<AuthFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> {
  return authFetch<T>(url, { ...options, method: 'GET' });
}

/**
 * POST request helper
 */
export async function authPost<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<AuthFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> {
  return authFetch<T>(url, { ...options, method: 'POST', body });
}

/**
 * PUT request helper
 */
export async function authPut<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<AuthFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> {
  return authFetch<T>(url, { ...options, method: 'PUT', body });
}

/**
 * PATCH request helper
 */
export async function authPatch<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<AuthFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> {
  return authFetch<T>(url, { ...options, method: 'PATCH', body });
}

/**
 * DELETE request helper
 */
export async function authDelete<T = unknown>(
  url: string,
  options?: Omit<AuthFetchOptions, 'method' | 'body'>
): Promise<ApiResponse<T>> {
  return authFetch<T>(url, { ...options, method: 'DELETE' });
}

/**
 * Internal: Execute fetch with auth headers
 */
async function fetchWithAuth<T = unknown>(
  url: string,
  options: AuthFetchOptions = {}
): Promise<ApiResponse<T>> {
  try {
    function normalizeHeaderKeys(headers: Record<string, string | undefined>): Record<string, string | undefined> {
      const normalized: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        const normalizedKey = key.toLowerCase() === 'x-tenant-id' ? 'x-tenant-id' : key;
        normalized[normalizedKey] = value;
      }
      return normalized;
    }

    async function ensureAuthorizationHeader(): Promise<Record<string, string | undefined>> {
      const authHeaders = buildAuthHeaders();
      if (authHeaders.Authorization || typeof window === 'undefined') {
        return authHeaders;
      }

      try {
        const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;

        if (accessToken) {
          setStoredAccessToken(accessToken);
          return {
            ...authHeaders,
            Authorization: `Bearer ${accessToken}`,
          };
        }
      } catch (error) {
        console.warn('[AuthAPIClient] Failed to recover access token from Supabase session', error);
      }

      return authHeaders;
    }

    // Build auth headers
    const authHeaders = await ensureAuthorizationHeader();
    
    // DEBUG: Log what headers are being built
    if (typeof window !== 'undefined') {
      console.debug('[fetchWithAuth] Building headers for:', url);
      console.debug('[fetchWithAuth] Auth header present:', !!authHeaders.Authorization);
      console.debug('[fetchWithAuth] Tenant header present:', !!authHeaders['x-tenant-id']);
      if (!authHeaders.Authorization) {
        console.warn('[fetchWithAuth] ⚠️ NO AUTHORIZATION HEADER - token not in localStorage?');
        const token = localStorage.getItem('boka_auth_access_token');
        console.warn('[fetchWithAuth] Token exists in localStorage:', !!token);
        if (token) {
          console.warn('[fetchWithAuth] Token length:', token.length);
          console.warn('[fetchWithAuth] Token first 30 chars:', token.substring(0, 30));
        }
      }
    }

    // Merge with custom headers (custom takes precedence), filter out undefined values
    const mergedHeaders = normalizeHeaderKeys({ ...authHeaders, ...(options.headers ?? {}) });
    const headers: HeadersInit = Object.fromEntries(
      Object.entries(mergedHeaders).filter(([, v]) => v !== undefined)
    ) as Record<string, string>;

    // Prepare body
    let body: string | undefined;
    if (options.body) {
      body = JSON.stringify(options.body);
    }

    const method = options.method || 'GET';
    console.debug(`[AuthAPIClient] ${method} ${url}`);

    // Execute fetch
    const response = await fetch(url, {
      ...options,
      headers,
      body,
    });

    // Parse response
    const contentType =
      typeof (response as Response).headers?.get === 'function'
        ? (response as Response).headers.get('content-type')
        : undefined;
    let data: T | undefined;

    if (contentType?.includes('application/json') || typeof (response as Response).json === 'function') {
      try {
        data = await (response as Response).json();
      } catch {
        // Response is not JSON
      }
    }

    // Handle errors
    if (!response.ok) {
      console.warn(`[AuthAPIClient] ${method} ${url} returned ${response.status}`);
      if (response.status === 401) {
        console.warn('[AuthAPIClient] Received 401 - Authorization failed. Clearing session.');
      }
      return {
        error: {
          message: `HTTP ${response.status}: ${response.statusText || ''}`.trim(),
          status: response.status,
          statusText: response.statusText || '',
        },
        status: response.status,
      };
    }

    console.debug(`[AuthAPIClient] ${method} ${url} ✓ ${response.status}`);
    return {
      data,
      status: response.status,
    };
  } catch (err) {
    console.error('[AuthAPIClient] Fetch error:', err);

    return {
      error: {
        message: err instanceof Error ? err.message : 'Unknown error',
        status: 0,
        statusText: 'Network Error',
      },
      status: 0,
    };
  }
}
