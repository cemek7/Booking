import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace } from '@opentelemetry/api';
import { publishEvent } from './eventBus';

export interface StaffSchedule {
  id: string;
  user_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface AvailabilitySlot {
  id: string;
  staff_id: string;
  slot_date: string;
  slot_time: string;
  duration_minutes: number;
  is_available: boolean;
  reservation_id?: string;
}

export interface FindSlotsOptions {
  tenantId: string;
  startDate: string;
  endDate: string;
  durationMinutes?: number;
  staffId?: string;
  serviceId?: string;
  limit?: number;
}

export interface OptimizedSlot {
  start_at: string;
  end_at: string;
  staff_id: string;
  staff_name?: string;
  confidence: number; // 0-1 score based on availability density
}

export class OptimizedScheduler {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-scheduler');

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Precompute availability slots for staff based on their working schedules
   */
  async precomputeAvailability(params: {
    tenantId: string;
    staffId?: string;
    startDate: string;
    endDate: string;
    slotDurationMinutes?: number;
  }): Promise<{ success: boolean; slotsGenerated: number; error?: string }> {
    const span = this.tracer.startSpan('scheduler.precompute_availability');
    
    try {
      const { tenantId, staffId, startDate, endDate, slotDurationMinutes = 60 } = params;
      
      // Get staff to process
      let staffQuery = this.supabase
        .from('tenant_users')
        .select('user_id, name')
        .eq('tenant_id', tenantId)
        .eq('role', 'staff');
        
      if (staffId) {
        staffQuery = staffQuery.eq('user_id', staffId);
      }
      
      const { data: staff, error: staffError } = await staffQuery;
      if (staffError) throw staffError;

      let totalSlotsGenerated = 0;

      for (const staffMember of staff || []) {
        try {
          // Use the database function to generate slots
          const { error: genError } = await this.supabase.rpc('generate_availability_slots', {
            p_tenant_id: tenantId,
            p_staff_id: staffMember.user_id,
            p_start_date: startDate,
            p_end_date: endDate,
            p_slot_duration_minutes: slotDurationMinutes,
          });

          if (genError) {
            console.warn(`Failed to generate slots for staff ${staffMember.user_id}:`, genError);
            continue;
          }

          // Count generated slots
          const { count } = await this.supabase
            .from('availability_slots')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('staff_id', staffMember.user_id)
            .gte('slot_date', startDate)
            .lte('slot_date', endDate);

          totalSlotsGenerated += count || 0;
          
        } catch (error) {
          console.warn(`Error processing staff ${staffMember.user_id}:`, error);
        }
      }

      span.setAttribute('slots.generated', totalSlotsGenerated);
      span.setAttribute('slots.date_range', `${startDate} to ${endDate}`);

      return { success: true, slotsGenerated: totalSlotsGenerated };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, slotsGenerated: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Find optimal available slots using precomputed availability
   */
  async findOptimalSlots(options: FindSlotsOptions): Promise<OptimizedSlot[]> {
    const span = this.tracer.startSpan('scheduler.find_optimal_slots');
    
    try {
      const {
        tenantId,
        startDate,
        endDate,
        durationMinutes = 60,
        staffId,
        limit = 20
      } = options;

      // Build query for available slots
      let slotsQuery = this.supabase
        .from('availability_slots')
        .select(`
          id,
          staff_id,
          slot_date,
          slot_time,
          duration_minutes,
          tenant_users!inner(name)
        `)
        .eq('tenant_id', tenantId)
        .eq('is_available', true)
        .eq('duration_minutes', durationMinutes)
        .gte('slot_date', startDate)
        .lte('slot_date', endDate)
        .order('slot_date', { ascending: true })
        .order('slot_time', { ascending: true })
        .limit(limit * 2); // Get more to calculate confidence scores

      if (staffId) {
        slotsQuery = slotsQuery.eq('staff_id', staffId);
      }

      const { data: slots, error } = await slotsQuery;
      if (error) throw error;

      if (!slots || slots.length === 0) {
        return [];
      }

      // Calculate confidence scores based on availability density
      const slotsWithConfidence = await Promise.all(
        slots.map(async (slot) => {
          const confidence = await this.calculateSlotConfidence(
            tenantId,
            slot.staff_id,
            slot.slot_date,
            slot.slot_time,
            durationMinutes
          );

          const startDateTime = new Date(`${slot.slot_date}T${slot.slot_time}`);
          const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60000);

          return {
            start_at: startDateTime.toISOString(),
            end_at: endDateTime.toISOString(),
            staff_id: slot.staff_id,
            staff_name: (slot as { tenant_users?: { name?: string } }).tenant_users?.name,
            confidence,
          };
        })
      );

      // Sort by confidence score and return top results
      const optimizedSlots = slotsWithConfidence
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);

      span.setAttribute('slots.found', optimizedSlots.length);
      span.setAttribute('slots.avg_confidence', 
        optimizedSlots.reduce((sum, s) => sum + s.confidence, 0) / optimizedSlots.length
      );

      return optimizedSlots;

    } catch (error) {
      span.recordException(error as Error);
      return [];
    } finally {
      span.end();
    }
  }

  /**
   * Calculate confidence score for a slot based on surrounding availability
   */
  private async calculateSlotConfidence(
    tenantId: string,
    staffId: string,
    slotDate: string,
    slotTime: string,
    _durationMinutes: number // Kept for future slot duration analysis
  ): Promise<number> {
    try {
      // Check availability in a 4-hour window around the slot
      const baseDateTime = new Date(`${slotDate}T${slotTime}`);
      const windowStart = new Date(baseDateTime.getTime() - 2 * 60 * 60 * 1000); // 2 hours before
      const windowEnd = new Date(baseDateTime.getTime() + 2 * 60 * 60 * 1000);   // 2 hours after

      // Count available slots in the window
      const { count: availableCount } = await this.supabase
        .from('availability_slots')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('staff_id', staffId)
        .eq('slot_date', slotDate)
        .gte('slot_time', windowStart.toTimeString().slice(0, 8))
        .lte('slot_time', windowEnd.toTimeString().slice(0, 8))
        .eq('is_available', true);

      // Count total slots in the window  
      const { count: totalCount } = await this.supabase
        .from('availability_slots')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('staff_id', staffId)
        .eq('slot_date', slotDate)
        .gte('slot_time', windowStart.toTimeString().slice(0, 8))
        .lte('slot_time', windowEnd.toTimeString().slice(0, 8));

      // Base confidence on availability density
      const densityScore = totalCount ? (availableCount || 0) / totalCount : 0;
      
      // Boost confidence for prime booking hours (9 AM - 5 PM)
      const hour = baseDateTime.getHours();
      const primeTimeBoost = (hour >= 9 && hour <= 17) ? 0.1 : 0;
      
      // Reduce confidence for very early or late slots
      const timeOfDayPenalty = (hour < 8 || hour > 18) ? 0.1 : 0;

      return Math.max(0, Math.min(1, densityScore + primeTimeBoost - timeOfDayPenalty));

    } catch (error) {
      console.warn('Error calculating slot confidence:', error);
      return 0.5; // Default moderate confidence
    }
  }

  /**
   * Book a specific slot and update availability
   */
  async bookSlot(params: {
    tenantId: string;
    slotId: string;
    reservationId: string;
    customerId: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }> {
    const span = this.tracer.startSpan('scheduler.book_slot');
    
    try {
      const { tenantId, slotId, reservationId } = params;

      // Mark slot as unavailable and link to reservation
      const { error } = await this.supabase
        .from('availability_slots')
        .update({
          is_available: false,
          reservation_id: reservationId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', slotId)
        .eq('tenant_id', tenantId)
        .eq('is_available', true); // Ensure slot is still available

      if (error) {
        span.setAttribute('booking.success', false);
        return { success: false, error: error.message };
      }

      // Publish slot booked event
      await publishEvent({
        supabase: this.supabase,
        event: 'slot.booked',
        payload: {
          slot_id: slotId,
          reservation_id: reservationId,
          tenant_id: tenantId,
        },
        tenant_id: tenantId,
      });

      span.setAttribute('booking.success', true);
      return { success: true };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Release a slot when reservation is cancelled
   */
  async releaseSlot(params: {
    tenantId: string;
    reservationId: string;
  }): Promise<{ success: boolean; slotsReleased: number; error?: string }> {
    const span = this.tracer.startSpan('scheduler.release_slot');
    
    try {
      const { tenantId, reservationId } = params;

      // Free up slots linked to the reservation
      const { count, error } = await this.supabase
        .from('availability_slots')
        .update({
          is_available: true,
          reservation_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('reservation_id', reservationId);

      if (error) {
        span.recordException(error);
        return { success: false, slotsReleased: 0, error: error.message };
      }

      // Publish slot released event
      await publishEvent({
        supabase: this.supabase,
        event: 'slot.released',
        payload: {
          reservation_id: reservationId,
          slots_released: count || 0,
          tenant_id: tenantId,
        },
        tenant_id: tenantId,
      });

      span.setAttribute('release.slots_count', count || 0);
      return { success: true, slotsReleased: count || 0 };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, slotsReleased: 0, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Update staff working hours and regenerate availability
   */
  async updateStaffSchedule(params: {
    tenantId: string;
    staffId: string;
    schedule: Array<{
      day_of_week: number;
      start_time: string;
      end_time: string;
      is_active: boolean;
    }>;
  }): Promise<{ success: boolean; error?: string }> {
    const span = this.tracer.startSpan('scheduler.update_staff_schedule');
    
    try {
      const { tenantId, staffId, schedule } = params;

      // Delete existing schedule
      await this.supabase
        .from('staff_schedules')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('user_id', staffId);

      // Insert new schedule
      if (schedule.length > 0) {
        const scheduleRows = schedule.map(s => ({
          tenant_id: tenantId,
          user_id: staffId,
          day_of_week: s.day_of_week,
          start_time: s.start_time,
          end_time: s.end_time,
          is_active: s.is_active,
        }));

        const { error: insertError } = await this.supabase
          .from('staff_schedules')
          .insert(scheduleRows);

        if (insertError) throw insertError;
      }

      // Regenerate availability slots for next 30 days
      const startDate = new Date().toISOString().split('T')[0];
      const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      await this.precomputeAvailability({
        tenantId,
        staffId,
        startDate,
        endDate,
      });

      span.setAttribute('schedule.success', true);
      return { success: true };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }
}

export default OptimizedScheduler;