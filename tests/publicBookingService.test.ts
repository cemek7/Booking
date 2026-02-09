/**
 * Tests for publicBookingService fixes
 * Focus on the specific issues that were addressed
 */

import { ApiErrorFactory } from '@/lib/error-handling/api-error';

// Mock the Supabase client
jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
}));

// Import after mocking
import { getAvailability } from '@/lib/publicBookingService';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';

describe('publicBookingService - getAvailability fixes', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: jest.fn(),
    };
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(mockSupabase);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Issue 1: Date Validation', () => {
    it('should reject invalid date strings', async () => {
      await expect(
        getAvailability('tenant-id', 'service-id', 'invalid-date')
      ).rejects.toThrow('Invalid date format');
    });

    it('should accept valid date strings', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { duration: 60 },
          error: null,
        }),
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
        lte: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockChain);

      const result = await getAvailability('tenant-id', 'service-id', '2024-03-15');
      // Should return empty array when no business hours
      expect(result).toEqual([]);
    });
  });

  describe('Issue 2: Reservation Query Logic', () => {
    it('should use gte for end_at to catch multi-day reservations', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { duration: 60 },
          error: null,
        }),
        maybeSingle: jest.fn().mockResolvedValue({
          data: {
            start_time: '09:00',
            end_time: '17:00',
          },
          error: null,
        }),
        lte: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        in: jest.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockChain);

      await getAvailability('tenant-id', 'service-id', '2024-03-15');

      // Verify that gte was called with 'end_at' (issue fix)
      const gteCall = mockChain.gte.mock.calls.find(
        (call: any[]) => call[0] === 'end_at'
      );
      expect(gteCall).toBeDefined();
    });
  });

  describe('Issue 5: Error Handling Order', () => {
    it('should check service error before data', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      };

      mockSupabase.from.mockReturnValue(mockChain);

      await expect(
        getAvailability('tenant-id', 'service-id', '2024-03-15')
      ).rejects.toThrow();
    });

    it('should handle missing service data', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      };

      mockSupabase.from.mockReturnValue(mockChain);

      await expect(
        getAvailability('tenant-id', 'service-id', '2024-03-15')
      ).rejects.toThrow('Service');
    });
  });
});
