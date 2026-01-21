import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { observability } from '../observability/observability';
import { EventBusService } from '../eventbus/eventBus';

// Types and validation schemas
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
  special_requests: z.string().max(500).optional()
});

const ModifyBookingSchema = z.object({
  booking_id: z.string().uuid(),
  start_time: z.string().datetime().optional(),
  end_time: z.string().datetime().optional(),
  service_id: z.string().uuid().optional(),
  provider_id: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  special_requests: z.string().max(500).optional(),
  reason: z.string().min(1).max(255)
});

const CancelBookingSchema = z.object({
  booking_id: z.string().uuid(),
  reason: z.enum(['customer_request', 'provider_unavailable', 'emergency', 'other']),
  notes: z.string().max(500).optional(),
  refund_requested: z.boolean().default(false)
});

interface BookingConflict {
  type: 'time_overlap' | 'provider_unavailable' | 'service_unavailable';
  conflicting_booking_id?: string;
  message: string;
  suggested_times?: Array<{
    start_time: string;
    end_time: string;
  }>;
}

interface BookingValidation {
  is_valid: boolean;
  conflicts: BookingConflict[];
  warnings: string[];
}

interface BookingCreationResult {
  booking: any;
  conflicts_resolved: boolean;
  payment_required: boolean;
  confirmation_sent: boolean;
}

/**
 * Core booking engine with robust conflict resolution and transaction integrity
 * Handles all booking lifecycle operations with production-grade reliability
 */
export class BookingEngine {
  private supabase: any;
  private eventBus: EventBusService;
  private isInitialized = false;

  // Configuration
  private config = {
    maxBookingHorizon: 365, // days
    minAdvanceBooking: 30, // minutes
    maxConcurrentBookings: 10,
    defaultBookingDuration: 60, // minutes
    bufferTime: 15, // minutes between bookings
    maxReschedulesPerBooking: 3,
    cancellationWindowHours: 24
  };

  // Performance tracking
  private metrics = {
    bookingsCreated: 0,
    bookingsCancelled: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    validationFailures: 0
  };

  constructor() {
    this.supabase = createServerSupabaseClient();
    this.eventBus = new EventBusService();
  }

  /**
   * Initialize the booking engine
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;

      this.isInitialized = true;

      console.log('BookingEngine initialized successfully');
    } catch (error) {
      console.error('Failed to initialize BookingEngine:', error);
      throw error;
    }
  }

  /**
   * Create a new booking with comprehensive validation and conflict resolution
   */
  async createBooking(
    tenantId: string,
    data: z.infer<typeof CreateBookingSchema>,
    options: {
      autoResolveConflicts?: boolean;
      skipPayment?: boolean;
      sendConfirmation?: boolean;
    } = {}
  ): Promise<BookingCreationResult> {
    const traceContext = observability.startTrace('booking.create');
    
    try {
      observability.setTraceTag(traceContext, 'tenant_id', tenantId);
      observability.setTraceTag(traceContext, 'service_id', data.service_id);

      // Validate input data
      const validatedData = CreateBookingSchema.parse(data);
      observability.addTraceLog(traceContext, 'info', 'Input data validated');

      // Start database transaction
      const { data: transactionResult, error: transactionError } = await this.supabase
        .rpc('begin_booking_transaction');

      if (transactionError) {
        throw new Error(`Transaction start failed: ${transactionError.message}`);
      }

      try {
        // Validate booking constraints
        const validation = await this.validateBooking(tenantId, validatedData);
        
        if (!validation.is_valid && !options.autoResolveConflicts) {
          await this.supabase.rpc('rollback_booking_transaction');
          
          this.metrics.validationFailures++;
          observability.recordBusinessMetric('booking_validation_failed_total', 1, {
            tenant_id: tenantId,
            reason: 'conflicts_detected'
          });

          throw new BookingValidationError('Booking validation failed', validation.conflicts);
        }

        // Resolve conflicts if auto-resolution is enabled
        let resolvedData = validatedData;
        let conflictsResolved = false;

        if (!validation.is_valid && options.autoResolveConflicts) {
          const resolution = await this.resolveBookingConflicts(tenantId, validatedData, validation.conflicts);
          resolvedData = resolution.resolvedData;
          conflictsResolved = resolution.conflictsResolved;
          
          observability.addTraceLog(traceContext, 'info', 'Booking conflicts resolved', {
            conflicts_count: validation.conflicts.length,
            resolution_success: conflictsResolved
          });
        }

        // Create booking record
        const booking = await this.createBookingRecord(tenantId, resolvedData, traceContext);
        
        // Handle payment if required
        let paymentRequired = false;
        const service = await this.getService(resolvedData.service_id);
        
        if (service && service.requires_payment && !options.skipPayment) {
          paymentRequired = true;
          await this.initiatePaymentProcess(booking.id, service, traceContext);
        }

        // Send confirmation if enabled
        let confirmationSent = false;
        if (options.sendConfirmation !== false) {
          await this.sendBookingConfirmation(booking, traceContext);
          confirmationSent = true;
        }

        // Commit transaction
        await this.supabase.rpc('commit_booking_transaction');

        // Record metrics
        this.metrics.bookingsCreated++;
        if (conflictsResolved) {
          this.metrics.conflictsResolved++;
        }

        // Publish events
        await this.eventBus.publishEvent(
          booking.id,
          'booking',
          'booking.created',
          {
            booking_id: booking.id,
            tenant_id: tenantId,
            customer_email: booking.customer_email,
            service_id: booking.service_id,
            provider_id: booking.provider_id,
            start_time: booking.start_time,
            end_time: booking.end_time,
            payment_required: paymentRequired,
            conflicts_resolved: conflictsResolved
          },
          { tenantId }
        );

        observability.recordBusinessMetric('booking_created_total', 1, {
          tenant_id: tenantId,
          service_id: booking.service_id,
          conflicts_resolved: conflictsResolved ? 'true' : 'false'
        });

        observability.finishTrace(traceContext, 'success');

        return {
          booking,
          conflicts_resolved: conflictsResolved,
          payment_required: paymentRequired,
          confirmation_sent: confirmationSent
        };

      } catch (error) {
        await this.supabase.rpc('rollback_booking_transaction');
        throw error;
      }

    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Booking creation failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');

      if (error instanceof BookingValidationError) {
        throw error;
      }

      throw new BookingCreationError('Failed to create booking', error);
    }
  }

  /**
   * Modify an existing booking with conflict detection
   */
  async modifyBooking(
    tenantId: string,
    data: z.infer<typeof ModifyBookingSchema>,
    options: {
      autoResolveConflicts?: boolean;
      notifyCustomer?: boolean;
    } = {}
  ): Promise<{
    booking: any;
    conflicts_resolved: boolean;
    notification_sent: boolean;
  }> {
    const traceContext = observability.startTrace('booking.modify');
    
    try {
      observability.setTraceTag(traceContext, 'tenant_id', tenantId);
      observability.setTraceTag(traceContext, 'booking_id', data.booking_id);

      const validatedData = ModifyBookingSchema.parse(data);

      // Get existing booking
      const existingBooking = await this.getBookingById(data.booking_id, tenantId);
      if (!existingBooking) {
        throw new BookingNotFoundError('Booking not found');
      }

      // Check if booking can be modified
      if (!this.canModifyBooking(existingBooking)) {
        throw new BookingModificationError('Booking cannot be modified at this time');
      }

      // Start transaction
      const { error: transactionError } = await this.supabase.rpc('begin_booking_transaction');
      if (transactionError) throw new Error(`Transaction failed: ${transactionError.message}`);

      try {
        // Validate modifications
        const modifiedBooking = { ...existingBooking, ...validatedData };
        const validation = await this.validateBookingModification(tenantId, existingBooking, modifiedBooking);

        if (!validation.is_valid && !options.autoResolveConflicts) {
          await this.supabase.rpc('rollback_booking_transaction');
          throw new BookingValidationError('Booking modification validation failed', validation.conflicts);
        }

        // Resolve conflicts if needed
        let resolvedData = modifiedBooking;
        let conflictsResolved = false;

        if (!validation.is_valid && options.autoResolveConflicts) {
          const resolution = await this.resolveBookingConflicts(tenantId, modifiedBooking, validation.conflicts);
          resolvedData = resolution.resolvedData;
          conflictsResolved = resolution.conflictsResolved;
        }

        // Update booking
        const { data: updatedBooking, error } = await this.supabase
          .from('bookings')
          .update({
            ...resolvedData,
            updated_at: new Date().toISOString(),
            modification_count: existingBooking.modification_count + 1
          })
          .eq('id', data.booking_id)
          .eq('tenant_id', tenantId)
          .select()
          .single();

        if (error) throw error;

        // Log modification history
        await this.logBookingModification(existingBooking, updatedBooking, data.reason, traceContext);

        // Send notification if enabled
        let notificationSent = false;
        if (options.notifyCustomer !== false) {
          await this.sendModificationNotification(updatedBooking, existingBooking, traceContext);
          notificationSent = true;
        }

        await this.supabase.rpc('commit_booking_transaction');

        // Publish events
        await this.eventBus.publishEvent(
          updatedBooking.id,
          'booking',
          'booking.modified',
          {
            booking_id: updatedBooking.id,
            tenant_id: tenantId,
            previous_booking: existingBooking,
            current_booking: updatedBooking,
            modification_reason: data.reason,
            conflicts_resolved: conflictsResolved
          },
          { tenantId }
        );

        observability.recordBusinessMetric('booking_modified_total', 1, {
          tenant_id: tenantId,
          conflicts_resolved: conflictsResolved ? 'true' : 'false'
        });

        observability.finishTrace(traceContext, 'success');

        return {
          booking: updatedBooking,
          conflicts_resolved: conflictsResolved,
          notification_sent: notificationSent
        };

      } catch (error) {
        await this.supabase.rpc('rollback_booking_transaction');
        throw error;
      }

    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Booking modification failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Cancel a booking with proper validation and refund handling
   */
  async cancelBooking(
    tenantId: string,
    data: z.infer<typeof CancelBookingSchema>,
    options: {
      processRefund?: boolean;
      notifyCustomer?: boolean;
    } = {}
  ): Promise<{
    booking: any;
    refund_initiated: boolean;
    notification_sent: boolean;
  }> {
    const traceContext = observability.startTrace('booking.cancel');
    
    try {
      observability.setTraceTag(traceContext, 'tenant_id', tenantId);
      observability.setTraceTag(traceContext, 'booking_id', data.booking_id);

      const validatedData = CancelBookingSchema.parse(data);

      // Get existing booking
      const booking = await this.getBookingById(data.booking_id, tenantId);
      if (!booking) {
        throw new BookingNotFoundError('Booking not found');
      }

      // Check if booking can be cancelled
      if (!this.canCancelBooking(booking)) {
        throw new BookingCancellationError('Booking cannot be cancelled at this time');
      }

      // Start transaction
      const { error: transactionError } = await this.supabase.rpc('begin_booking_transaction');
      if (transactionError) throw new Error(`Transaction failed: ${transactionError.message}`);

      try {
        // Update booking status
        const { data: cancelledBooking, error } = await this.supabase
          .from('bookings')
          .update({
            status: 'cancelled',
            cancelled_at: new Date().toISOString(),
            cancellation_reason: validatedData.reason,
            cancellation_notes: validatedData.notes,
            updated_at: new Date().toISOString()
          })
          .eq('id', data.booking_id)
          .eq('tenant_id', tenantId)
          .select()
          .single();

        if (error) throw error;

        // Handle refund if requested
        let refundInitiated = false;
        if (data.refund_requested && options.processRefund !== false) {
          refundInitiated = await this.initiateRefundProcess(cancelledBooking, traceContext);
        }

        // Free up the time slot
        await this.releaseTimeSlot(cancelledBooking, traceContext);

        // Send notification
        let notificationSent = false;
        if (options.notifyCustomer !== false) {
          await this.sendCancellationNotification(cancelledBooking, traceContext);
          notificationSent = true;
        }

        await this.supabase.rpc('commit_booking_transaction');

        // Record metrics
        this.metrics.bookingsCancelled++;

        // Publish events
        await this.eventBus.publishEvent(
          cancelledBooking.id,
          'booking',
          'booking.cancelled',
          {
            booking_id: cancelledBooking.id,
            tenant_id: tenantId,
            customer_email: cancelledBooking.customer_email,
            cancellation_reason: validatedData.reason,
            refund_requested: data.refund_requested,
            refund_initiated: refundInitiated
          },
          { tenantId }
        );

        observability.recordBusinessMetric('booking_cancelled_total', 1, {
          tenant_id: tenantId,
          reason: validatedData.reason,
          refund_requested: data.refund_requested ? 'true' : 'false'
        });

        observability.finishTrace(traceContext, 'success');

        return {
          booking: cancelledBooking,
          refund_initiated: refundInitiated,
          notification_sent: notificationSent
        };

      } catch (error) {
        await this.supabase.rpc('rollback_booking_transaction');
        throw error;
      }

    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Booking cancellation failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Validate booking for conflicts and constraints
   */
  private async validateBooking(
    tenantId: string,
    data: z.infer<typeof CreateBookingSchema>
  ): Promise<BookingValidation> {
    const conflicts: BookingConflict[] = [];
    const warnings: string[] = [];

    try {
      // Time validation
      const startTime = new Date(data.start_time);
      const endTime = new Date(data.end_time);
      const now = new Date();

      // Basic time constraints
      if (startTime >= endTime) {
        conflicts.push({
          type: 'time_overlap',
          message: 'Start time must be before end time'
        });
      }

      if (startTime < new Date(now.getTime() + this.config.minAdvanceBooking * 60000)) {
        conflicts.push({
          type: 'time_overlap',
          message: `Booking must be at least ${this.config.minAdvanceBooking} minutes in advance`
        });
      }

      const maxBookingDate = new Date(now.getTime() + this.config.maxBookingHorizon * 24 * 60 * 60000);
      if (startTime > maxBookingDate) {
        conflicts.push({
          type: 'time_overlap',
          message: `Booking cannot be more than ${this.config.maxBookingHorizon} days in advance`
        });
      }

      // Check provider availability
      const providerConflicts = await this.checkProviderAvailability(
        tenantId,
        data.provider_id,
        startTime,
        endTime
      );
      conflicts.push(...providerConflicts);

      // Check service availability
      const serviceConflicts = await this.checkServiceAvailability(
        tenantId,
        data.service_id,
        startTime,
        endTime
      );
      conflicts.push(...serviceConflicts);

      // Check concurrent booking limits
      const customerBookingCount = await this.getCustomerActiveBookingCount(
        tenantId,
        data.customer_email
      );

      if (customerBookingCount >= this.config.maxConcurrentBookings) {
        conflicts.push({
          type: 'service_unavailable',
          message: `Customer has reached maximum concurrent bookings limit (${this.config.maxConcurrentBookings})`
        });
      }

      return {
        is_valid: conflicts.length === 0,
        conflicts,
        warnings
      };

    } catch (error) {
      console.error('Booking validation error:', error);
      return {
        is_valid: false,
        conflicts: [{
          type: 'service_unavailable',
          message: 'Validation service temporarily unavailable'
        }],
        warnings: []
      };
    }
  }

  /**
   * Check provider availability for the requested time slot
   */
  private async checkProviderAvailability(
    tenantId: string,
    providerId: string,
    startTime: Date,
    endTime: Date
  ): Promise<BookingConflict[]> {
    const conflicts: BookingConflict[] = [];

    try {
      // Check existing bookings
      const { data: overlappingBookings, error } = await this.supabase
        .from('bookings')
        .select('id, start_time, end_time')
        .eq('tenant_id', tenantId)
        .eq('provider_id', providerId)
        .in('status', ['confirmed', 'in_progress'])
        .or(`and(start_time.lt.${endTime.toISOString()},end_time.gt.${startTime.toISOString()})`);

      if (error) throw error;

      for (const booking of overlappingBookings || []) {
        conflicts.push({
          type: 'time_overlap',
          conflicting_booking_id: booking.id,
          message: `Provider is not available during this time slot`,
          suggested_times: await this.getSuggestedTimes(tenantId, providerId, startTime, endTime)
        });
      }

      // Check provider schedule/working hours
      const providerSchedule = await this.getProviderSchedule(tenantId, providerId, startTime);
      if (!this.isTimeSlotInSchedule(startTime, endTime, providerSchedule)) {
        conflicts.push({
          type: 'provider_unavailable',
          message: 'Requested time is outside provider working hours',
          suggested_times: await this.getSuggestedTimesInSchedule(tenantId, providerId, startTime, endTime)
        });
      }

    } catch (error) {
      console.error('Provider availability check error:', error);
      conflicts.push({
        type: 'provider_unavailable',
        message: 'Unable to verify provider availability'
      });
    }

    return conflicts;
  }

  // Additional helper methods would be implemented here...
  // This is a comprehensive foundation for the booking engine

  /**
   * Get booking performance metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      if (this.eventBus) {
        await this.eventBus.stopProcessing();
      }
      console.log('BookingEngine shutdown complete');
    } catch (error) {
      console.error('BookingEngine shutdown error:', error);
    }
  }

  /**
   * Validate booking modification for conflicts
   */
  private async validateBookingModification(
    tenantId: string,
    existing: any,
    modified: any
  ): Promise<BookingValidation> {
    const conflicts: BookingConflict[] = [];
    const warnings: string[] = [];

    // Check modification count limit
    if (existing.modification_count >= this.config.maxReschedulesPerBooking) {
      conflicts.push({
        type: 'service_unavailable',
        message: `Maximum reschedules (${this.config.maxReschedulesPerBooking}) reached for this booking`
      });
    }

    // If time is being modified, check for conflicts
    if (modified.start_time !== existing.start_time || modified.end_time !== existing.end_time) {
      const startTime = new Date(modified.start_time);
      const endTime = new Date(modified.end_time);

      // Check provider availability (excluding current booking)
      const { data: availability } = await this.supabase.rpc('check_booking_availability', {
        p_tenant_id: tenantId,
        p_provider_id: modified.provider_id,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime.toISOString(),
        p_exclude_booking_id: existing.id
      });

      if (availability && !availability.is_available) {
        conflicts.push({
          type: 'time_overlap',
          message: 'New time slot is not available',
          suggested_times: await this.getSuggestedTimes(tenantId, modified.provider_id, startTime, endTime)
        });
      }
    }

    return {
      is_valid: conflicts.length === 0,
      conflicts,
      warnings
    };
  }

  /**
   * Attempt to resolve booking conflicts by finding alternative times
   */
  private async resolveBookingConflicts(
    tenantId: string,
    data: any,
    conflicts: BookingConflict[]
  ): Promise<{ resolvedData: any; conflictsResolved: boolean }> {
    // Only attempt auto-resolution for time conflicts
    const timeConflicts = conflicts.filter(c => c.type === 'time_overlap');

    if (timeConflicts.length === 0) {
      return { resolvedData: data, conflictsResolved: false };
    }

    // Try to find alternative times using the suggested_times from conflicts
    for (const conflict of timeConflicts) {
      if (conflict.suggested_times && conflict.suggested_times.length > 0) {
        const suggestion = conflict.suggested_times[0];
        return {
          resolvedData: {
            ...data,
            start_time: suggestion.start_time,
            end_time: suggestion.end_time
          },
          conflictsResolved: true
        };
      }
    }

    return { resolvedData: data, conflictsResolved: false };
  }

  /**
   * Create booking record in database
   */
  private async createBookingRecord(
    tenantId: string,
    data: z.infer<typeof CreateBookingSchema>,
    traceContext: any
  ): Promise<any> {
    observability.addTraceLog(traceContext, 'info', 'Creating booking record');

    // Get service for price information
    const service = await this.getService(data.service_id);

    const bookingData = {
      tenant_id: tenantId,
      service_id: data.service_id,
      provider_id: data.provider_id,
      customer_name: data.customer_name,
      customer_email: data.customer_email,
      customer_phone: data.customer_phone,
      start_time: data.start_time,
      end_time: data.end_time,
      notes: data.notes || null,
      special_requests: data.special_requests || null,
      metadata: data.metadata || {},
      status: 'pending',
      payment_status: service?.requires_payment ? 'pending' : 'not_required',
      price_cents: service?.price_cents || 0,
      currency: service?.currency || 'USD',
      modification_count: 0
    };

    const { data: booking, error } = await this.supabase
      .from('bookings')
      .insert(bookingData)
      .select()
      .single();

    if (error) {
      observability.addTraceLog(traceContext, 'error', 'Failed to create booking', { error: error.message });
      throw new Error(`Failed to create booking: ${error.message}`);
    }

    observability.addTraceLog(traceContext, 'info', 'Booking created successfully', { booking_id: booking.id });
    return booking;
  }

  /**
   * Fetch service details by ID
   */
  private async getService(serviceId: string): Promise<{
    id: string;
    name: string;
    duration_minutes: number;
    price_cents: number;
    currency: string;
    requires_payment: boolean;
    max_advance_booking_days: number;
    min_advance_booking_minutes: number;
    buffer_time_minutes: number;
  } | null> {
    const { data, error } = await this.supabase
      .from('services')
      .select('id, name, duration_minutes, price_cents, currency, requires_payment, max_advance_booking_days, min_advance_booking_minutes, buffer_time_minutes')
      .eq('id', serviceId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Initiate payment process for booking
   */
  private async initiatePaymentProcess(
    bookingId: string,
    service: any,
    traceContext: any
  ): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Initiating payment process', {
      booking_id: bookingId,
      amount: service.price_cents
    });

    // Update booking with payment pending status
    await this.supabase
      .from('bookings')
      .update({ payment_status: 'pending' })
      .eq('id', bookingId);

    // Publish event for payment service to handle
    await this.eventBus.publishEvent(
      bookingId,
      'booking',
      'booking.payment_required',
      {
        booking_id: bookingId,
        amount_cents: service.price_cents,
        currency: service.currency,
        service_name: service.name
      }
    );
  }

  /**
   * Send booking confirmation notification
   */
  private async sendBookingConfirmation(booking: any, traceContext: any): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Sending booking confirmation', { booking_id: booking.id });

    // Publish event for notification service to handle
    await this.eventBus.publishEvent(
      booking.id,
      'booking',
      'booking.confirmation_required',
      {
        booking_id: booking.id,
        tenant_id: booking.tenant_id,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        customer_name: booking.customer_name,
        service_id: booking.service_id,
        start_time: booking.start_time,
        end_time: booking.end_time
      },
      { tenantId: booking.tenant_id }
    );
  }

  /**
   * Fetch booking by ID and tenant
   */
  private async getBookingById(bookingId: string, tenantId: string): Promise<any> {
    const { data, error } = await this.supabase
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Check if booking can be modified based on status and timing
   */
  private canModifyBooking(booking: any): boolean {
    // Cannot modify cancelled or completed bookings
    if (['cancelled', 'completed', 'no_show'].includes(booking.status)) {
      return false;
    }

    // Cannot modify if booking has started
    const now = new Date();
    const startTime = new Date(booking.start_time);
    if (startTime <= now) {
      return false;
    }

    // Check modification count limit
    if (booking.modification_count >= this.config.maxReschedulesPerBooking) {
      return false;
    }

    return true;
  }

  /**
   * Check if booking can be cancelled based on status and cancellation window
   */
  private canCancelBooking(booking: any): boolean {
    // Cannot cancel already cancelled or completed bookings
    if (['cancelled', 'completed', 'no_show'].includes(booking.status)) {
      return false;
    }

    // Check cancellation window
    const now = new Date();
    const startTime = new Date(booking.start_time);
    const cancellationDeadline = new Date(startTime.getTime() - this.config.cancellationWindowHours * 60 * 60 * 1000);

    // Allow cancellation but may affect refund eligibility
    return true;
  }

  /**
   * Log booking modification for audit trail
   */
  private async logBookingModification(
    existing: any,
    updated: any,
    reason: string,
    traceContext: any
  ): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Logging booking modification');

    // The database trigger handles this automatically via log_booking_modification()
    // This method is here for any additional logging if needed
    await this.eventBus.publishEvent(
      updated.id,
      'booking',
      'booking.modification_logged',
      {
        booking_id: updated.id,
        tenant_id: updated.tenant_id,
        previous_state: existing,
        new_state: updated,
        reason
      },
      { tenantId: updated.tenant_id }
    );
  }

  /**
   * Send modification notification to customer
   */
  private async sendModificationNotification(
    booking: any,
    previous: any,
    traceContext: any
  ): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Sending modification notification', { booking_id: booking.id });

    await this.eventBus.publishEvent(
      booking.id,
      'booking',
      'booking.modification_notification',
      {
        booking_id: booking.id,
        tenant_id: booking.tenant_id,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        previous_start_time: previous.start_time,
        new_start_time: booking.start_time,
        previous_end_time: previous.end_time,
        new_end_time: booking.end_time
      },
      { tenantId: booking.tenant_id }
    );
  }

  /**
   * Initiate refund process for cancelled booking
   */
  private async initiateRefundProcess(booking: any, traceContext: any): Promise<boolean> {
    observability.addTraceLog(traceContext, 'info', 'Initiating refund process', { booking_id: booking.id });

    // Only process refund if payment was made
    if (booking.payment_status !== 'paid') {
      return false;
    }

    // Check if within refund eligibility window
    const now = new Date();
    const startTime = new Date(booking.start_time);
    const cancellationDeadline = new Date(startTime.getTime() - this.config.cancellationWindowHours * 60 * 60 * 1000);

    const isEligibleForRefund = now < cancellationDeadline;

    if (isEligibleForRefund) {
      // Update payment status
      await this.supabase
        .from('bookings')
        .update({ payment_status: 'refunded' })
        .eq('id', booking.id);

      // Publish refund event for payment service
      await this.eventBus.publishEvent(
        booking.id,
        'booking',
        'booking.refund_requested',
        {
          booking_id: booking.id,
          tenant_id: booking.tenant_id,
          payment_id: booking.payment_id,
          amount_cents: booking.price_cents,
          currency: booking.currency
        },
        { tenantId: booking.tenant_id }
      );

      return true;
    }

    return false;
  }

  /**
   * Release time slot when booking is cancelled
   */
  private async releaseTimeSlot(booking: any, traceContext: any): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Releasing time slot', { booking_id: booking.id });

    // The time slot is automatically released when status becomes 'cancelled'
    // since check_booking_availability only considers 'confirmed' and 'in_progress' bookings
    // Publish event for any waitlist handling
    await this.eventBus.publishEvent(
      booking.id,
      'booking',
      'booking.slot_released',
      {
        booking_id: booking.id,
        tenant_id: booking.tenant_id,
        provider_id: booking.provider_id,
        start_time: booking.start_time,
        end_time: booking.end_time,
        service_id: booking.service_id
      },
      { tenantId: booking.tenant_id }
    );
  }

  /**
   * Send cancellation notification to customer
   */
  private async sendCancellationNotification(booking: any, traceContext: any): Promise<void> {
    observability.addTraceLog(traceContext, 'info', 'Sending cancellation notification', { booking_id: booking.id });

    await this.eventBus.publishEvent(
      booking.id,
      'booking',
      'booking.cancellation_notification',
      {
        booking_id: booking.id,
        tenant_id: booking.tenant_id,
        customer_email: booking.customer_email,
        customer_phone: booking.customer_phone,
        customer_name: booking.customer_name,
        service_id: booking.service_id,
        cancellation_reason: booking.cancellation_reason,
        refund_status: booking.payment_status === 'refunded' ? 'refund_initiated' : 'no_refund'
      },
      { tenantId: booking.tenant_id }
    );
  }

  /**
   * Check service availability for the requested time
   */
  private async checkServiceAvailability(
    tenantId: string,
    serviceId: string,
    startTime: Date,
    endTime: Date
  ): Promise<BookingConflict[]> {
    const conflicts: BookingConflict[] = [];

    // Get service details
    const service = await this.getService(serviceId);
    if (!service) {
      conflicts.push({
        type: 'service_unavailable',
        message: 'Service not found or inactive'
      });
      return conflicts;
    }

    // Check max concurrent bookings for this service
    const { count, error } = await this.supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId)
      .in('status', ['confirmed', 'in_progress'])
      .lt('start_time', endTime.toISOString())
      .gt('end_time', startTime.toISOString());

    if (!error && count !== null && count >= (service as any).max_concurrent_bookings) {
      conflicts.push({
        type: 'service_unavailable',
        message: 'Service is at maximum capacity for this time slot'
      });
    }

    return conflicts;
  }

  /**
   * Get count of customer's active bookings
   */
  private async getCustomerActiveBookingCount(tenantId: string, customerEmail: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('customer_email', customerEmail)
      .in('status', ['pending', 'confirmed', 'in_progress']);

    if (error) {
      console.error('Error counting customer bookings:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Get suggested alternative times using database function
   */
  private async getSuggestedTimes(
    tenantId: string,
    providerId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ start_time: string; end_time: string }>> {
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / (1000 * 60));

    // Get service ID for this provider
    const { data: providerService } = await this.supabase
      .from('provider_services')
      .select('service_id')
      .eq('provider_id', providerId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (!providerService) {
      return [];
    }

    // Use database function to suggest times
    const { data: suggestions, error } = await this.supabase.rpc('suggest_booking_times', {
      p_tenant_id: tenantId,
      p_provider_id: providerId,
      p_service_id: providerService.service_id,
      p_preferred_date: startTime.toISOString().split('T')[0],
      p_duration_minutes: durationMinutes,
      p_max_suggestions: 5
    });

    if (error || !suggestions) {
      return [];
    }

    return suggestions.map((s: any) => ({
      start_time: s.suggested_start_time,
      end_time: s.suggested_end_time
    }));
  }

  /**
   * Get provider schedule for a specific date
   */
  private async getProviderSchedule(
    tenantId: string,
    providerId: string,
    date: Date
  ): Promise<{
    day_of_week: number;
    start_time: string;
    end_time: string;
    break_start_time?: string;
    break_end_time?: string;
  } | null> {
    const dayOfWeek = date.getDay();

    const { data, error } = await this.supabase
      .from('provider_schedule')
      .select('day_of_week, start_time, end_time, break_start_time, break_end_time')
      .eq('provider_id', providerId)
      .eq('tenant_id', tenantId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Check if requested time slot falls within provider's schedule
   */
  private isTimeSlotInSchedule(
    startTime: Date,
    endTime: Date,
    schedule: {
      start_time: string;
      end_time: string;
      break_start_time?: string;
      break_end_time?: string;
    } | null
  ): boolean {
    if (!schedule) {
      return false;
    }

    const requestedStart = startTime.toTimeString().slice(0, 8);
    const requestedEnd = endTime.toTimeString().slice(0, 8);

    // Check if within working hours
    if (requestedStart < schedule.start_time || requestedEnd > schedule.end_time) {
      return false;
    }

    // Check if overlapping with break time
    if (schedule.break_start_time && schedule.break_end_time) {
      if (requestedStart < schedule.break_end_time && requestedEnd > schedule.break_start_time) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get suggested times within provider's schedule
   */
  private async getSuggestedTimesInSchedule(
    tenantId: string,
    providerId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ start_time: string; end_time: string }>> {
    // Delegate to the main suggestion function which already considers schedule
    return this.getSuggestedTimes(tenantId, providerId, startTime, endTime);
  }
}

// Custom error classes
export class BookingEngineError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message);
    this.name = 'BookingEngineError';
  }
}

export class BookingValidationError extends BookingEngineError {
  constructor(message: string, public conflicts: BookingConflict[]) {
    super(message);
    this.name = 'BookingValidationError';
  }
}

export class BookingCreationError extends BookingEngineError {
  constructor(message: string, cause?: Error) {
    super(message, cause);
    this.name = 'BookingCreationError';
  }
}

export class BookingModificationError extends BookingEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'BookingModificationError';
  }
}

export class BookingCancellationError extends BookingEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'BookingCancellationError';
  }
}

export class BookingNotFoundError extends BookingEngineError {
  constructor(message: string) {
    super(message);
    this.name = 'BookingNotFoundError';
  }
}

// Export singleton instance
export const bookingEngine = new BookingEngine();