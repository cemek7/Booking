import { SupabaseClient } from '@supabase/supabase-js';
import { trace } from '@opentelemetry/api';
import { publishEvent } from './eventBus';
import { observeRequest } from './metrics';
import crypto from 'crypto';

export interface ReservationLock {
  id: string;
  tenant_id: string;
  slot_key: string; // unique key for time slot + resource
  session_id?: string;
  expires_at: string;
  created_at: string;
}

export interface SlotLockParams {
  tenantId: string;
  startAt: string;
  endAt: string;
  resourceId?: string; // staff_id, location_id, etc
  sessionId?: string;
  lockDurationMinutes?: number;
}

export interface ConflictCheckParams {
  tenantId: string;
  startAt: string;
  endAt: string;
  resourceIds?: string[];
  excludeReservationId?: string;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: Array<{
    reservation_id: string;
    start_at: string;
    end_at: string;
    resource_id?: string;
    conflict_type: 'time_overlap' | 'resource_double_booking' | 'staff_unavailable';
  }>;
}

/**
 * Enhanced reservation service with double-booking prevention
 * Implements transactional locking and conflict detection
 */
export class DoubleBookingPrevention {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-booking-prevention');

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Acquire a temporary lock on a time slot to prevent double bookings
   * Uses Redis-like expiring locks with database fallback
   */
  async acquireSlotLock(params: SlotLockParams): Promise<{ 
    success: boolean; 
    lockId?: string; 
    error?: string;
    isConflict?: boolean;
  }> {
    const span = this.tracer.startSpan('booking.acquire_slot_lock');
    const startTime = Date.now();

    try {
      // Generate unique slot key
      const slotKey = this.generateSlotKey(
        params.tenantId,
        params.startAt,
        params.endAt,
        params.resourceId
      );

      // Check for existing locks
      const { data: existingLocks, error: lockError } = await this.supabase
        .from('reservation_locks')
        .select('*')
        .eq('tenant_id', params.tenantId)
        .eq('slot_key', slotKey)
        .gt('expires_at', new Date().toISOString());

      if (lockError) {
        throw new Error(`Failed to check existing locks: ${lockError.message}`);
      }

      if (existingLocks && existingLocks.length > 0) {
        // Check if it's the same session extending the lock
        const sameSessionLock = existingLocks.find(lock => 
          params.sessionId && lock.session_id === params.sessionId
        );

        if (!sameSessionLock) {
          span.setAttribute('lock.conflict', true);
          return { 
            success: false, 
            isConflict: true,
            error: 'Slot is already locked by another session' 
          };
        }
      }

      // Create new lock with expiration
      const lockDuration = (params.lockDurationMinutes || 10) * 60 * 1000;
      const expiresAt = new Date(Date.now() + lockDuration).toISOString();
      const lockId = crypto.randomUUID();

      const { data: newLock, error: insertError } = await this.supabase
        .from('reservation_locks')
        .insert([{
          id: lockId,
          tenant_id: params.tenantId,
          slot_key: slotKey,
          session_id: params.sessionId,
          expires_at: expiresAt,
        }])
        .select()
        .single();

      if (insertError) {
        // Handle unique constraint violation
        if (insertError.code === '23505') {
          return { 
            success: false, 
            isConflict: true,
            error: 'Slot was locked by another session during acquisition' 
          };
        }
        throw new Error(`Failed to create lock: ${insertError.message}`);
      }

      span.setAttribute('lock.acquired', true);
      span.setAttribute('lock.duration_ms', lockDuration);
      observeRequest('booking.lock_acquired', Date.now() - startTime, 'success');

      return { success: true, lockId };

    } catch (error) {
      span.recordException(error as Error);
      span.setAttribute('lock.error', true);
      observeRequest('booking.lock_acquired', Date.now() - startTime, 'error');

      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      span.end();
    }
  }

  /**
   * Release a slot lock
   */
  async releaseSlotLock(lockId: string): Promise<{ success: boolean; error?: string }> {
    const span = this.tracer.startSpan('booking.release_slot_lock');

    try {
      const { error } = await this.supabase
        .from('reservation_locks')
        .delete()
        .eq('id', lockId);

      if (error) {
        throw new Error(`Failed to release lock: ${error.message}`);
      }

      span.setAttribute('lock.released', true);
      return { success: true };

    } catch (error) {
      span.recordException(error as Error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      span.end();
    }
  }

  /**
   * Check for booking conflicts with advanced detection
   */
  async checkBookingConflicts(params: ConflictCheckParams): Promise<ConflictResult> {
    const span = this.tracer.startSpan('booking.check_conflicts');
    
    try {
      const conflicts: ConflictResult['conflicts'] = [];

      // 1. Check time overlap conflicts
      let query = this.supabase
        .from('reservations')
        .select(`
          id,
          start_at,
          end_at,
          status,
          staff_id,
          location_id,
          metadata
        `)
        .eq('tenant_id', params.tenantId)
        .neq('status', 'cancelled')
        .or(`and(start_at.lte.${params.endAt},end_at.gte.${params.startAt})`);

      // Exclude current reservation if updating
      if (params.excludeReservationId) {
        query = query.neq('id', params.excludeReservationId);
      }

      // Filter by resource at query level when specific resources are requested
      // This prevents false conflicts from other resources (e.g., different staff members)
      if (params.resourceIds && params.resourceIds.length > 0) {
        // Validate and sanitize resourceIds to prevent filter injection
        const validResourceIds = params.resourceIds.filter(id => {
          // Basic UUID validation pattern
          return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        });

        if (validResourceIds.length === 0) {
          throw new Error('Invalid resourceIds format - expected UUIDs');
        }

        // Build OR condition for staff_id or location_id matching any of the resourceIds
        const resourceFilters = validResourceIds
          .map(id => `staff_id.eq.${id},location_id.eq.${id}`)
          .join(',');
        query = query.or(resourceFilters);
      }

      const { data: overlappingReservations, error: conflictError } = await query;

      if (conflictError) {
        throw new Error(`Failed to check conflicts: ${conflictError.message}`);
      }

      // 2. Analyze conflicts by type
      // Since we've already filtered by resourceIds at the query level (when provided),
      // all overlapping reservations here are actual conflicts
      if (overlappingReservations) {
        for (const reservation of overlappingReservations) {
          // Use staff_id if present, otherwise location_id
          // This prioritizes staff assignment over location since staff is the primary resource
          const resourceId = reservation.staff_id || reservation.location_id;
          
          // Determine conflict type based on whether resources were specified
          const conflictType = params.resourceIds && params.resourceIds.length > 0
            ? 'resource_double_booking'
            : 'time_overlap';

          conflicts.push({
            reservation_id: reservation.id,
            start_at: reservation.start_at,
            end_at: reservation.end_at,
            resource_id: resourceId,
            conflict_type: conflictType
          });
        }
      }

      // 3. Check staff availability (working hours, breaks, etc.)
      if (params.resourceIds) {
        const staffConflicts = await this.checkStaffAvailability(
          params.tenantId,
          params.resourceIds,
          params.startAt,
          params.endAt
        );
        conflicts.push(...staffConflicts);
      }

      span.setAttribute('conflicts.count', conflicts.length);
      span.setAttribute('conflicts.has_conflict', conflicts.length > 0);

      // Emit conflict detection event for monitoring
      await publishEvent({
        supabase: this.supabase,
        event: 'booking.conflict_check',
        payload: {
          tenant_id: params.tenantId,
          conflict_count: conflicts.length,
          has_conflicts: conflicts.length > 0,
          start_at: params.startAt,
          end_at: params.endAt
        },
        tenant_id: params.tenantId,
        location_id: null
      });

      return {
        hasConflict: conflicts.length > 0,
        conflicts
      };

    } catch (error) {
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Clean up expired locks
   */
  async cleanupExpiredLocks(): Promise<{ success: boolean; cleanedCount?: number; error?: string }> {
    const span = this.tracer.startSpan('booking.cleanup_expired_locks');

    try {
      const { data: expiredLocks, error: deleteError } = await this.supabase
        .from('reservation_locks')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id');

      if (deleteError) {
        throw new Error(`Failed to cleanup expired locks: ${deleteError.message}`);
      }

      const cleanedCount = expiredLocks?.length || 0;
      span.setAttribute('cleanup.count', cleanedCount);

      return { success: true, cleanedCount };

    } catch (error) {
      span.recordException(error as Error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      span.end();
    }
  }

  /**
   * Generate unique slot key for locking
   */
  private generateSlotKey(
    tenantId: string,
    startAt: string,
    endAt: string,
    resourceId?: string
  ): string {
    const baseKey = `${tenantId}:${startAt}:${endAt}`;
    if (resourceId) {
      return `${baseKey}:${resourceId}`;
    }
    return baseKey;
  }

  /**
   * Check staff availability against working hours and breaks
   */
  private async checkStaffAvailability(
    tenantId: string,
    staffIds: string[],
    startAt: string,
    endAt: string
  ): Promise<ConflictResult['conflicts']> {
    const conflicts: ConflictResult['conflicts'] = [];

    // Get staff working hours and breaks
    const { data: staffAvailability } = await this.supabase
      .from('staff_availability')
      .select(`
        staff_id,
        day_of_week,
        start_time,
        end_time,
        break_start,
        break_end,
        is_available
      `)
      .eq('tenant_id', tenantId)
      .in('staff_id', staffIds);

    // Check each staff member's availability
    const bookingStart = new Date(startAt);
    const bookingEnd = new Date(endAt);
    const dayOfWeek = bookingStart.getDay();

    for (const staffId of staffIds) {
      const availability = staffAvailability?.find(a => 
        a.staff_id === staffId && 
        a.day_of_week === dayOfWeek
      );

      if (!availability || !availability.is_available) {
        conflicts.push({
          reservation_id: '',
          start_at: startAt,
          end_at: endAt,
          resource_id: staffId,
          conflict_type: 'staff_unavailable'
        });
        continue;
      }

      // Check working hours
      const workStart = this.parseTimeToMinutes(availability.start_time);
      const workEnd = this.parseTimeToMinutes(availability.end_time);
      const bookingStartMinutes = bookingStart.getHours() * 60 + bookingStart.getMinutes();
      const bookingEndMinutes = bookingEnd.getHours() * 60 + bookingEnd.getMinutes();

      if (bookingStartMinutes < workStart || bookingEndMinutes > workEnd) {
        conflicts.push({
          reservation_id: '',
          start_at: startAt,
          end_at: endAt,
          resource_id: staffId,
          conflict_type: 'staff_unavailable'
        });
      }

      // Check break times
      if (availability.break_start && availability.break_end) {
        const breakStart = this.parseTimeToMinutes(availability.break_start);
        const breakEnd = this.parseTimeToMinutes(availability.break_end);

        if (
          (bookingStartMinutes >= breakStart && bookingStartMinutes < breakEnd) ||
          (bookingEndMinutes > breakStart && bookingEndMinutes <= breakEnd) ||
          (bookingStartMinutes <= breakStart && bookingEndMinutes >= breakEnd)
        ) {
          conflicts.push({
            reservation_id: '',
            start_at: startAt,
            end_at: endAt,
            resource_id: staffId,
            conflict_type: 'staff_unavailable'
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Parse time string (HH:MM) to minutes
   */
  private parseTimeToMinutes(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

export default DoubleBookingPrevention;