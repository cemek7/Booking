/**
 * Tests for publicBookingService conflict detection
 * Validates the race condition fixes and proper overlap detection
 */

import { ApiErrorFactory } from '@/lib/error-handling/api-error';

// Mock the dependencies
jest.mock('@/lib/supabase/server', () => ({
  getSupabaseRouteHandlerClient: jest.fn(),
}));

jest.mock('@/lib/doubleBookingPrevention', () => ({
  DoubleBookingPrevention: jest.fn(),
}));

// Import after mocking
import { createPublicBooking } from '@/lib/publicBookingService';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import { DoubleBookingPrevention } from '@/lib/doubleBookingPrevention';

describe('publicBookingService - createPublicBooking conflict detection', () => {
  let mockSupabase: any;
  let mockBookingPrevention: any;

  // Helper to create database chain mocks
  const createMockChain = (resolvedValue: any) => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(resolvedValue),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(resolvedValue),
  });

  beforeEach(() => {
    // Setup Supabase mock
    mockSupabase = {
      from: jest.fn(),
    };
    (getSupabaseRouteHandlerClient as jest.Mock).mockReturnValue(mockSupabase);

    // Setup DoubleBookingPrevention mock
    mockBookingPrevention = {
      acquireSlotLock: jest.fn(),
      releaseSlotLock: jest.fn(),
      checkBookingConflicts: jest.fn(),
    };
    (DoubleBookingPrevention as jest.Mock).mockImplementation(() => mockBookingPrevention);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Race Condition Prevention', () => {
    it('should acquire and release lock when creating a booking', async () => {
      // Setup database mocks in order
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });
      const mockBookingInsert = createMockChain({ data: { id: 'booking-123' }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)  // customers table
        .mockReturnValueOnce(mockServiceLookup)   // services table
        .mockReturnValueOnce(mockBookingInsert);  // reservations table

      // Mock successful lock acquisition
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: true,
        lockId: 'lock-123',
      });

      // Mock no conflicts
      mockBookingPrevention.checkBookingConflicts.mockResolvedValue({
        hasConflict: false,
        conflicts: [],
      });

      const payload = {
        service_id: 'service-123',
        staff_id: 'staff-123',
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      await createPublicBooking('tenant-123', payload);

      // Verify lock was acquired
      expect(mockBookingPrevention.acquireSlotLock).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceId: 'staff-123',
        lockDurationMinutes: 2,
      });

      // Verify lock was released
      expect(mockBookingPrevention.releaseSlotLock).toHaveBeenCalledWith('lock-123');
    });

    it('should release lock even when booking creation fails', async () => {
      // Setup database mocks - insert will fail
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });
      const mockBookingInsert = createMockChain({ data: null, error: { message: 'Database error' } });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup)
        .mockReturnValueOnce(mockBookingInsert);

      // Mock successful lock acquisition
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: true,
        lockId: 'lock-123',
      });

      // Mock no conflicts
      mockBookingPrevention.checkBookingConflicts.mockResolvedValue({
        hasConflict: false,
        conflicts: [],
      });

      const payload = {
        service_id: 'service-123',
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      await expect(createPublicBooking('tenant-123', payload)).rejects.toThrow();

      // Verify lock was still released despite error
      expect(mockBookingPrevention.releaseSlotLock).toHaveBeenCalledWith('lock-123');
    });

    it('should throw conflict error when lock acquisition fails due to conflict', async () => {
      // Setup database mocks
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup);

      // Mock lock acquisition failure due to conflict
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: false,
        isConflict: true,
        error: 'Slot is already locked',
      });

      const payload = {
        service_id: 'service-123',
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      await expect(createPublicBooking('tenant-123', payload)).rejects.toThrow(
        'Selected time slot is no longer available.'
      );

      // Lock release should not be called if acquisition failed
      expect(mockBookingPrevention.releaseSlotLock).not.toHaveBeenCalled();
    });
  });

  describe('Conflict Detection', () => {
    it('should detect and reject overlapping bookings', async () => {
      // Setup database mocks
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup);

      // Mock successful lock acquisition
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: true,
        lockId: 'lock-123',
      });

      // Mock conflict detection
      mockBookingPrevention.checkBookingConflicts.mockResolvedValue({
        hasConflict: true,
        conflicts: [
          {
            reservation_id: 'existing-booking',
            start_at: '2024-03-15T10:00:00Z',
            end_at: '2024-03-15T11:00:00Z',
            resource_id: 'staff-123',
            conflict_type: 'time_overlap',
          },
        ],
      });

      const payload = {
        service_id: 'service-123',
        staff_id: 'staff-123',
        date: '2024-03-15',
        time: '10:30',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      await expect(createPublicBooking('tenant-123', payload)).rejects.toThrow(
        'Selected time slot is no longer available.'
      );

      // Verify conflict check was called with correct parameters
      expect(mockBookingPrevention.checkBookingConflicts).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceIds: ['staff-123'],
      });

      // Verify lock was released
      expect(mockBookingPrevention.releaseSlotLock).toHaveBeenCalledWith('lock-123');
    });

    it('should check tenant-wide conflicts when staff_id is not provided', async () => {
      // Setup database mocks
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });
      const mockBookingInsert = createMockChain({ data: { id: 'booking-123' }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup)
        .mockReturnValueOnce(mockBookingInsert);

      // Mock successful lock acquisition
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: true,
        lockId: 'lock-123',
      });

      // Mock no conflicts
      mockBookingPrevention.checkBookingConflicts.mockResolvedValue({
        hasConflict: false,
        conflicts: [],
      });

      const payload = {
        service_id: 'service-123',
        // No staff_id provided
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      await createPublicBooking('tenant-123', payload);

      // Verify lock was acquired without resourceId
      expect(mockBookingPrevention.acquireSlotLock).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceId: undefined,
        lockDurationMinutes: 2,
      });

      // Verify conflict check was called without resourceIds
      expect(mockBookingPrevention.checkBookingConflicts).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceIds: undefined,
      });
    });

    it('should filter conflicts by staff when staff_id is provided', async () => {
      // Setup database mocks
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });
      const mockBookingInsert = createMockChain({ data: { id: 'booking-123' }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup)
        .mockReturnValueOnce(mockBookingInsert);

      // Mock successful lock acquisition
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: true,
        lockId: 'lock-123',
      });

      // Mock no conflicts for specific staff
      mockBookingPrevention.checkBookingConflicts.mockResolvedValue({
        hasConflict: false,
        conflicts: [],
      });

      const payload = {
        service_id: 'service-123',
        staff_id: 'staff-456', // Different staff
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        customer_phone: '+1234567890',
      };

      await createPublicBooking('tenant-123', payload);

      // Verify lock included resourceId
      expect(mockBookingPrevention.acquireSlotLock).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceId: 'staff-456',
        lockDurationMinutes: 2,
      });

      // Verify conflict check filtered by staff
      expect(mockBookingPrevention.checkBookingConflicts).toHaveBeenCalledWith({
        tenantId: 'tenant-123',
        startAt: expect.any(String),
        endAt: expect.any(String),
        resourceIds: ['staff-456'],
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw internal server error for lock acquisition failures', async () => {
      // Setup database mocks
      const mockCustomerLookup = createMockChain({ data: { id: 'customer-123' }, error: null });
      const mockServiceLookup = createMockChain({ data: { duration: 60 }, error: null });

      mockSupabase.from
        .mockReturnValueOnce(mockCustomerLookup)
        .mockReturnValueOnce(mockServiceLookup);

      // Mock lock acquisition failure (not a conflict)
      mockBookingPrevention.acquireSlotLock.mockResolvedValue({
        success: false,
        isConflict: false,
        error: 'Database connection error',
      });

      const payload = {
        service_id: 'service-123',
        date: '2024-03-15',
        time: '10:00',
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_phone: '+1234567890',
      };

      // Should throw internal server error
      await expect(createPublicBooking('tenant-123', payload)).rejects.toThrow();
    });
  });
});
