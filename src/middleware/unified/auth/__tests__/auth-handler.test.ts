/**
 * Unit tests for auth-handler.ts
 * Tests the getAuthenticatedUserRole function for various scenarios
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';
import { getAuthenticatedUserRole } from '../auth-handler';

// Mock Supabase client
jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
}));

interface MockSupabase {
  auth: {
    getUser: jest.Mock;
  };
  from: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  maybeSingle: jest.Mock;
}

describe('getAuthenticatedUserRole', () => {
  let mockSupabase: MockSupabase;
  let mockRequest: NextRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock Supabase client
    mockSupabase = {
      auth: {
        getUser: jest.fn(),
      },
      from: jest.fn(() => mockSupabase),
      select: jest.fn(() => mockSupabase),
      eq: jest.fn(() => mockSupabase),
      order: jest.fn(() => mockSupabase),
      limit: jest.fn(() => mockSupabase),
      maybeSingle: jest.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSupabaseRouteHandlerClient } = require('@/lib/supabase/server');
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(mockSupabase);

    // Setup mock request
    mockRequest = {
      headers: new Headers(),
      url: 'http://localhost:3000/api/test',
    } as NextRequest;
  });

  describe('when user is not authenticated', () => {
    it('should return null role and isAuthenticated false', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: false,
        tenantId: null,
      });
    });
  });

  describe('when tenantId header is provided', () => {
    beforeEach(() => {
      mockRequest.headers.set('x-tenant-id', 'tenant-123');
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      });
    });

    it('should query for tenant membership with provided tenantId', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: 'owner' },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.from).toHaveBeenCalledWith('tenant_users');
      expect(mockSupabase.select).toHaveBeenCalledWith('role');
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockSupabase.eq).toHaveBeenCalledWith('tenant_id', 'tenant-123');
      expect(result).toEqual({
        role: 'owner',
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return null role when membership does not exist', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return null role when membership query fails', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-123',
      });
    });

    it('should return immediately without second query when membership is found', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: 'manager' },
        error: null,
      });

      await getAuthenticatedUserRole(mockRequest);

      // Verify only one query was made (no fallback query)
      expect(mockSupabase.from).toHaveBeenCalledTimes(1);
    });
  });

  describe('fallback query when no tenantId header is provided', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@example.com' } },
        error: null,
      });
    });

    it('should query for any tenant membership when user has one tenant', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: 'staff', tenant_id: 'tenant-abc' },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.from).toHaveBeenCalledWith('tenant_users');
      expect(mockSupabase.select).toHaveBeenCalledWith('role, tenant_id');
      expect(mockSupabase.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(mockSupabase.order).toHaveBeenCalledWith('tenant_id', { ascending: true });
      expect(mockSupabase.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        role: 'staff',
        isAuthenticated: true,
        tenantId: 'tenant-abc',
      });
    });

    it('should return first tenant deterministically when user has multiple tenants', async () => {
      // With .order('tenant_id').limit(1), it should return the alphabetically first tenant
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: 'owner', tenant_id: 'tenant-aaa' },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.order).toHaveBeenCalledWith('tenant_id', { ascending: true });
      expect(mockSupabase.limit).toHaveBeenCalledWith(1);
      expect(result).toEqual({
        role: 'owner',
        isAuthenticated: true,
        tenantId: 'tenant-aaa',
      });
    });

    it('should return null values when user has no tenant memberships', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: null,
      });
    });

    it('should return tenantId even when role is missing', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: null, tenant_id: 'tenant-missing-role' },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: 'tenant-missing-role',
      });
    });

    it('should handle query errors gracefully', async () => {
      mockSupabase.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Connection error' },
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: true,
        tenantId: null,
      });
    });
  });

  describe('bearer token authentication', () => {
    it('should fallback to bearer token when session auth fails', async () => {
      mockRequest.headers.set('authorization', 'Bearer valid-token');
      
      // First call (session) fails, second call (token) succeeds
      mockSupabase.auth.getUser
        .mockResolvedValueOnce({
          data: { user: null },
          error: { message: 'No session' },
        })
        .mockResolvedValueOnce({
          data: { user: { id: 'user-2', email: 'token@example.com' } },
          error: null,
        });

      mockSupabase.maybeSingle.mockResolvedValue({
        data: { role: 'manager', tenant_id: 'tenant-xyz' },
        error: null,
      });

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(mockSupabase.auth.getUser).toHaveBeenCalledTimes(2);
      expect(mockSupabase.auth.getUser).toHaveBeenNthCalledWith(2, 'valid-token');
      expect(result.isAuthenticated).toBe(true);
      expect(result.role).toBe('manager');
    });
  });

  describe('error handling', () => {
    it('should handle unexpected exceptions gracefully', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'));

      const result = await getAuthenticatedUserRole(mockRequest);

      expect(result).toEqual({
        role: null,
        isAuthenticated: false,
        tenantId: null,
      });
    });
  });
});
