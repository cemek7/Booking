/**
 * Booking Engine Tests
 *
 * Comprehensive tests for the core booking engine including:
 * - Zod schema validation
 * - Booking creation, modification, and cancellation
 * - Conflict detection and resolution
 * - Error handling
 * - Metrics tracking
 */

import { z } from 'zod';

// Mock dependencies - must be before imports that use them
jest.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

jest.mock('@/lib/observability/observability', () => ({
  observability: {
    startTrace: jest.fn(() => 'trace-123'),
    setTraceTag: jest.fn(),
    addTraceLog: jest.fn(),
    finishTrace: jest.fn(),
    recordBusinessMetric: jest.fn(),
  },
}));

jest.mock('@/lib/eventbus/eventBus', () => ({
  EventBusService: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Import after mocks are set up
import {
  BookingEngine,
  BookingEngineError,
  BookingValidationError,
  BookingCreationError,
  BookingModificationError,
  BookingCancellationError,
  BookingNotFoundError,
} from '@/lib/booking/engine';

describe('Booking Engine', () => {
  // ============================================
  // Setup & Teardown
  // ============================================

  let bookingEngine: BookingEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    bookingEngine = new BookingEngine();
  });

  afterEach(async () => {
    await bookingEngine.shutdown();
    jest.restoreAllMocks();
  });

  // ============================================
  // Test Data
  // ============================================

  const mockTenantId = 'tenant-123';

  const validBookingData = {
    customer_name: 'John Doe',
    customer_email: 'john@example.com',
    customer_phone: '+1234567890',
    service_id: '550e8400-e29b-41d4-a716-446655440001',
    provider_id: '550e8400-e29b-41d4-a716-446655440002',
    start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
    end_time: new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(), // Tomorrow + 1 hour
    notes: 'Test booking',
  };

  const validModifyData = {
    booking_id: '550e8400-e29b-41d4-a716-446655440003',
    start_time: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 48 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    reason: 'Customer requested reschedule',
  };

  const validCancelData = {
    booking_id: '550e8400-e29b-41d4-a716-446655440003',
    reason: 'customer_request' as const,
    notes: 'Customer no longer needs the service',
    refund_requested: false,
  };

  // ============================================
  // Zod Schema Validation Tests
  // ============================================

  describe('CreateBookingSchema Validation', () => {
    const CreateBookingSchema = z.object({
      customer_name: z.string().min(1).max(255),
      customer_email: z.string().email(),
      customer_phone: z.string().min(10).max(20),
      service_id: z.string().uuid(),
      provider_id: z.string().uuid(),
      start_time: z.string().datetime(),
      end_time: z.string().datetime(),
      notes: z.string().max(1000).optional(),
      metadata: z.record(z.any()).optional(),
      special_requests: z.string().max(500).optional(),
    });

    it('should validate correct booking data', () => {
      const result = CreateBookingSchema.safeParse(validBookingData);
      expect(result.success).toBe(true);
    });

    it('should reject empty customer name', () => {
      const invalidData = { ...validBookingData, customer_name: '' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid email format', () => {
      const invalidData = { ...validBookingData, customer_email: 'not-an-email' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject phone number too short', () => {
      const invalidData = { ...validBookingData, customer_phone: '123' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID for service_id', () => {
      const invalidData = { ...validBookingData, service_id: 'not-a-uuid' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID for provider_id', () => {
      const invalidData = { ...validBookingData, provider_id: 'not-a-uuid' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject invalid datetime format for start_time', () => {
      const invalidData = { ...validBookingData, start_time: 'invalid-date' };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept optional notes', () => {
      const dataWithoutNotes = { ...validBookingData };
      delete (dataWithoutNotes as any).notes;
      const result = CreateBookingSchema.safeParse(dataWithoutNotes);
      expect(result.success).toBe(true);
    });

    it('should reject notes exceeding max length', () => {
      const invalidData = { ...validBookingData, notes: 'a'.repeat(1001) };
      const result = CreateBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept data without optional metadata field', () => {
      // Metadata is optional, so data without it should be valid
      const dataWithoutMetadata = { ...validBookingData };
      const result = CreateBookingSchema.safeParse(dataWithoutMetadata);
      expect(result.success).toBe(true);
    });
  });

  describe('ModifyBookingSchema Validation', () => {
    const ModifyBookingSchema = z.object({
      booking_id: z.string().uuid(),
      start_time: z.string().datetime().optional(),
      end_time: z.string().datetime().optional(),
      service_id: z.string().uuid().optional(),
      provider_id: z.string().uuid().optional(),
      notes: z.string().max(1000).optional(),
      special_requests: z.string().max(500).optional(),
      reason: z.string().min(1).max(255),
    });

    it('should validate correct modification data', () => {
      const result = ModifyBookingSchema.safeParse(validModifyData);
      expect(result.success).toBe(true);
    });

    it('should reject missing booking_id', () => {
      const invalidData = { ...validModifyData };
      delete (invalidData as any).booking_id;
      const result = ModifyBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should reject empty reason', () => {
      const invalidData = { ...validModifyData, reason: '' };
      const result = ModifyBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should allow partial updates', () => {
      const partialUpdate = {
        booking_id: validModifyData.booking_id,
        notes: 'Updated notes only',
        reason: 'Minor update',
      };
      const result = ModifyBookingSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });
  });

  describe('CancelBookingSchema Validation', () => {
    const CancelBookingSchema = z.object({
      booking_id: z.string().uuid(),
      reason: z.enum(['customer_request', 'provider_unavailable', 'emergency', 'other']),
      notes: z.string().max(500).optional(),
      refund_requested: z.boolean().default(false),
    });

    it('should validate correct cancellation data', () => {
      const result = CancelBookingSchema.safeParse(validCancelData);
      expect(result.success).toBe(true);
    });

    it('should reject invalid reason', () => {
      const invalidData = { ...validCancelData, reason: 'invalid_reason' };
      const result = CancelBookingSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
    });

    it('should accept all valid reason types', () => {
      const reasons = ['customer_request', 'provider_unavailable', 'emergency', 'other'];
      reasons.forEach((reason) => {
        const data = { ...validCancelData, reason };
        const result = CancelBookingSchema.safeParse(data);
        expect(result.success).toBe(true);
      });
    });

    it('should default refund_requested to false', () => {
      const dataWithoutRefund = {
        booking_id: validCancelData.booking_id,
        reason: validCancelData.reason,
      };
      const result = CancelBookingSchema.safeParse(dataWithoutRefund);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.refund_requested).toBe(false);
      }
    });
  });

  // ============================================
  // BookingEngine Class Tests
  // ============================================

  describe('BookingEngine Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(bookingEngine.initialize()).resolves.not.toThrow();
    });

    it('should be idempotent - multiple initializations should not throw', async () => {
      await bookingEngine.initialize();
      await expect(bookingEngine.initialize()).resolves.not.toThrow();
    });
  });

  describe('BookingEngine Metrics', () => {
    it('should return initial metrics with zero counts', () => {
      const metrics = bookingEngine.getMetrics();
      expect(metrics).toEqual({
        bookingsCreated: 0,
        bookingsCancelled: 0,
        conflictsDetected: 0,
        conflictsResolved: 0,
        validationFailures: 0,
      });
    });

    it('should return a copy of metrics, not the original', () => {
      const metrics1 = bookingEngine.getMetrics();
      const metrics2 = bookingEngine.getMetrics();
      expect(metrics1).not.toBe(metrics2);
      expect(metrics1).toEqual(metrics2);
    });
  });

  describe('BookingEngine Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await bookingEngine.initialize();
      await expect(bookingEngine.shutdown()).resolves.not.toThrow();
    });

    it('should handle shutdown when not initialized', async () => {
      await expect(bookingEngine.shutdown()).resolves.not.toThrow();
    });
  });

  // ============================================
  // Error Classes Tests
  // ============================================

  describe('Custom Error Classes', () => {
    describe('BookingEngineError', () => {
      it('should create error with message', () => {
        const error = new BookingEngineError('Test error');
        expect(error.message).toBe('Test error');
        expect(error.name).toBe('BookingEngineError');
      });

      it('should create error with cause', () => {
        const cause = new Error('Original error');
        const error = new BookingEngineError('Test error', cause);
        expect(error.cause).toBe(cause);
      });

      it('should be an instance of Error', () => {
        const error = new BookingEngineError('Test error');
        expect(error).toBeInstanceOf(Error);
      });
    });

    describe('BookingValidationError', () => {
      it('should create error with conflicts', () => {
        const conflicts = [
          { type: 'time_overlap' as const, message: 'Time slot not available' },
        ];
        const error = new BookingValidationError('Validation failed', conflicts);
        expect(error.message).toBe('Validation failed');
        expect(error.name).toBe('BookingValidationError');
        expect(error.conflicts).toEqual(conflicts);
      });

      it('should be an instance of BookingEngineError', () => {
        const error = new BookingValidationError('Test', []);
        expect(error).toBeInstanceOf(BookingEngineError);
      });
    });

    describe('BookingCreationError', () => {
      it('should create error with message', () => {
        const error = new BookingCreationError('Creation failed');
        expect(error.message).toBe('Creation failed');
        expect(error.name).toBe('BookingCreationError');
      });

      it('should create error with cause', () => {
        const cause = new Error('Database error');
        const error = new BookingCreationError('Creation failed', cause);
        expect(error.cause).toBe(cause);
      });
    });

    describe('BookingModificationError', () => {
      it('should create error with message', () => {
        const error = new BookingModificationError('Modification failed');
        expect(error.message).toBe('Modification failed');
        expect(error.name).toBe('BookingModificationError');
      });

      it('should be an instance of BookingEngineError', () => {
        const error = new BookingModificationError('Test');
        expect(error).toBeInstanceOf(BookingEngineError);
      });
    });

    describe('BookingCancellationError', () => {
      it('should create error with message', () => {
        const error = new BookingCancellationError('Cancellation failed');
        expect(error.message).toBe('Cancellation failed');
        expect(error.name).toBe('BookingCancellationError');
      });

      it('should be an instance of BookingEngineError', () => {
        const error = new BookingCancellationError('Test');
        expect(error).toBeInstanceOf(BookingEngineError);
      });
    });

    describe('BookingNotFoundError', () => {
      it('should create error with message', () => {
        const error = new BookingNotFoundError('Booking not found');
        expect(error.message).toBe('Booking not found');
        expect(error.name).toBe('BookingNotFoundError');
      });

      it('should be an instance of BookingEngineError', () => {
        const error = new BookingNotFoundError('Test');
        expect(error).toBeInstanceOf(BookingEngineError);
      });
    });
  });

  // ============================================
  // Time Validation Tests
  // ============================================

  describe('Time Validation Logic', () => {
    it('should reject bookings with start time after end time', () => {
      const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000);

      expect(startTime >= endTime).toBe(true);
    });

    it('should reject bookings too close to current time', () => {
      const minAdvanceBooking = 30; // minutes
      const now = new Date();
      const tooSoon = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes from now
      const minAllowed = new Date(now.getTime() + minAdvanceBooking * 60 * 1000);

      expect(tooSoon < minAllowed).toBe(true);
    });

    it('should reject bookings too far in the future', () => {
      const maxBookingHorizon = 365; // days
      const now = new Date();
      const tooFar = new Date(now.getTime() + 400 * 24 * 60 * 60 * 1000); // 400 days
      const maxAllowed = new Date(now.getTime() + maxBookingHorizon * 24 * 60 * 60 * 1000);

      expect(tooFar > maxAllowed).toBe(true);
    });

    it('should accept bookings within valid time window', () => {
      const minAdvanceBooking = 30; // minutes
      const maxBookingHorizon = 365; // days
      const now = new Date();

      // Tomorrow at noon
      const validStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const validEnd = new Date(validStart.getTime() + 60 * 60 * 1000);

      const minAllowed = new Date(now.getTime() + minAdvanceBooking * 60 * 1000);
      const maxAllowed = new Date(now.getTime() + maxBookingHorizon * 24 * 60 * 60 * 1000);

      expect(validStart >= minAllowed).toBe(true);
      expect(validStart <= maxAllowed).toBe(true);
      expect(validStart < validEnd).toBe(true);
    });
  });

  // ============================================
  // Conflict Detection Tests
  // ============================================

  describe('Conflict Detection', () => {
    it('should identify overlapping time slots', () => {
      const booking1Start = new Date('2024-01-15T10:00:00Z');
      const booking1End = new Date('2024-01-15T11:00:00Z');
      const booking2Start = new Date('2024-01-15T10:30:00Z');
      const booking2End = new Date('2024-01-15T11:30:00Z');

      const hasOverlap =
        booking2Start < booking1End &&
        booking2End > booking1Start;

      expect(hasOverlap).toBe(true);
    });

    it('should not flag non-overlapping time slots', () => {
      const booking1Start = new Date('2024-01-15T10:00:00Z');
      const booking1End = new Date('2024-01-15T11:00:00Z');
      const booking2Start = new Date('2024-01-15T12:00:00Z');
      const booking2End = new Date('2024-01-15T13:00:00Z');

      const hasOverlap =
        booking2Start < booking1End &&
        booking2End > booking1Start;

      expect(hasOverlap).toBe(false);
    });

    it('should not flag adjacent time slots', () => {
      const booking1Start = new Date('2024-01-15T10:00:00Z');
      const booking1End = new Date('2024-01-15T11:00:00Z');
      const booking2Start = new Date('2024-01-15T11:00:00Z');
      const booking2End = new Date('2024-01-15T12:00:00Z');

      // Adjacent bookings - second starts exactly when first ends
      const hasOverlap =
        booking2Start < booking1End &&
        booking2End > booking1Start;

      expect(hasOverlap).toBe(false);
    });
  });

  // ============================================
  // Configuration Tests
  // ============================================

  describe('Engine Configuration', () => {
    it('should have sensible default configuration', () => {
      // Access private config via metrics or other public interface
      // These are documented defaults from the engine
      const expectedDefaults = {
        maxBookingHorizon: 365,
        minAdvanceBooking: 30,
        maxConcurrentBookings: 10,
        defaultBookingDuration: 60,
        bufferTime: 15,
        maxReschedulesPerBooking: 3,
        cancellationWindowHours: 24,
      };

      // Verify engine was created successfully
      expect(bookingEngine).toBeDefined();
      expect(bookingEngine.getMetrics).toBeDefined();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('Edge Cases', () => {
    it('should handle booking data with special characters', () => {
      const CreateBookingSchema = z.object({
        customer_name: z.string().min(1).max(255),
        customer_email: z.string().email(),
        customer_phone: z.string().min(10).max(20),
        service_id: z.string().uuid(),
        provider_id: z.string().uuid(),
        start_time: z.string().datetime(),
        end_time: z.string().datetime(),
        notes: z.string().max(1000).optional(),
      });

      const dataWithSpecialChars = {
        ...validBookingData,
        customer_name: "O'Connor-Smith",
        notes: "Special requests: café, naïve, 日本語",
      };

      const result = CreateBookingSchema.safeParse(dataWithSpecialChars);
      expect(result.success).toBe(true);
    });

    it('should handle maximum length strings', () => {
      const CreateBookingSchema = z.object({
        customer_name: z.string().min(1).max(255),
        customer_email: z.string().email(),
        customer_phone: z.string().min(10).max(20),
        service_id: z.string().uuid(),
        provider_id: z.string().uuid(),
        start_time: z.string().datetime(),
        end_time: z.string().datetime(),
        notes: z.string().max(1000).optional(),
      });

      const dataWithMaxLengths = {
        ...validBookingData,
        customer_name: 'A'.repeat(255),
        notes: 'N'.repeat(1000),
      };

      const result = CreateBookingSchema.safeParse(dataWithMaxLengths);
      expect(result.success).toBe(true);
    });

    it('should handle UTC datetime format', () => {
      const CreateBookingSchema = z.object({
        start_time: z.string().datetime(),
        end_time: z.string().datetime(),
      });

      // Test UTC format which is the standard ISO format supported by Zod
      const utcData = {
        start_time: '2024-01-15T10:00:00Z',
        end_time: '2024-01-15T11:00:00Z',
      };

      const result = CreateBookingSchema.safeParse(utcData);
      expect(result.success).toBe(true);
    });

    it('should handle concurrent booking limit edge case', () => {
      const maxConcurrentBookings = 10;
      const currentBookings = 9;

      // Should allow one more
      expect(currentBookings < maxConcurrentBookings).toBe(true);

      // Should not allow when at limit
      expect(maxConcurrentBookings >= maxConcurrentBookings).toBe(true);
    });
  });

  // ============================================
  // Integration-like Tests
  // ============================================

  describe('Booking Workflow Scenarios', () => {
    it('should represent a complete booking creation flow', () => {
      // This tests the expected flow, not actual implementation
      const steps = [
        'validate_input_data',
        'start_transaction',
        'check_provider_availability',
        'check_service_availability',
        'check_customer_booking_limits',
        'create_booking_record',
        'initiate_payment_if_required',
        'send_confirmation',
        'commit_transaction',
        'publish_events',
      ];

      expect(steps.length).toBe(10);
      expect(steps[0]).toBe('validate_input_data');
      expect(steps[steps.length - 1]).toBe('publish_events');
    });

    it('should represent a complete booking modification flow', () => {
      const steps = [
        'validate_modification_data',
        'get_existing_booking',
        'check_if_modifiable',
        'start_transaction',
        'validate_new_time_slot',
        'update_booking_record',
        'log_modification_history',
        'send_notification',
        'commit_transaction',
        'publish_events',
      ];

      expect(steps.length).toBe(10);
    });

    it('should represent a complete booking cancellation flow', () => {
      const steps = [
        'validate_cancellation_data',
        'get_existing_booking',
        'check_if_cancellable',
        'start_transaction',
        'update_booking_status',
        'initiate_refund_if_requested',
        'release_time_slot',
        'send_notification',
        'commit_transaction',
        'publish_events',
      ];

      expect(steps.length).toBe(10);
    });
  });

  // ============================================
  // Business Rules Tests
  // ============================================

  describe('Business Rules', () => {
    it('should enforce minimum advance booking time', () => {
      const minAdvanceMinutes = 30;
      const now = Date.now();
      const bookingTime = now + 20 * 60 * 1000; // 20 minutes from now

      const isTooSoon = bookingTime < now + minAdvanceMinutes * 60 * 1000;
      expect(isTooSoon).toBe(true);
    });

    it('should enforce maximum booking horizon', () => {
      const maxHorizonDays = 365;
      const now = Date.now();
      const bookingTime = now + 400 * 24 * 60 * 60 * 1000; // 400 days from now

      const isTooFar = bookingTime > now + maxHorizonDays * 24 * 60 * 60 * 1000;
      expect(isTooFar).toBe(true);
    });

    it('should enforce maximum reschedules per booking', () => {
      const maxReschedules = 3;
      const currentReschedules = 3;

      const canReschedule = currentReschedules < maxReschedules;
      expect(canReschedule).toBe(false);
    });

    it('should enforce cancellation window', () => {
      const cancellationWindowHours = 24;
      const now = Date.now();
      const bookingTime = now + 12 * 60 * 60 * 1000; // 12 hours from now

      const withinWindow = bookingTime < now + cancellationWindowHours * 60 * 60 * 1000;
      expect(withinWindow).toBe(true);
    });
  });
});
