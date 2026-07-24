/**
 * Tests for publicBookingService fixes
 * Focus on the specific issues that were addressed
 */

import { ApiErrorFactory } from '@/lib/error-handling/api-error';

// Mock the Supabase client. getAvailability runs unauthenticated on the public
// booking path, so it uses the admin client rather than the route handler client.
jest.mock('@/lib/supabase/server', () => ({
  createSupabaseAdminClient: jest.fn(),
}));

// Import after mocking
import { getAvailability } from '@/lib/publicBookingService';
import { createSupabaseAdminClient } from '@/lib/supabase/server';

describe('publicBookingService - getAvailability fixes', () => {
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = {
      from: jest.fn(),
    };
    (createSupabaseAdminClient as jest.Mock).mockReturnValue(mockSupabase);
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
        maybeSingle: jest.fn().mockResolvedValueOnce({
          data: { duration_minutes: 60 },
          error: null,
        }).mockResolvedValueOnce({
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
      // A valid date is accepted. With no configured business hours (and no
      // business_hours table in the deployed schema), the service falls back to
      // a default window and still returns bookable slots (rather than 500ing).
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({ available: true });
    });
  });

  describe('Issue 2: Reservation Query Logic', () => {
    it('should use gte for end_at to catch multi-day reservations', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValueOnce({
          data: { duration_minutes: 60 },
          error: null,
        }).mockResolvedValueOnce({
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
        maybeSingle: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' },
        }),
      };

      mockSupabase.from.mockReturnValue(mockChain);

      await expect(
        getAvailability('tenant-id', 'service-id', '2024-03-15')
      ).rejects.toThrow();
    });

    it('should return 404 for missing service (not database error)', async () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
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
