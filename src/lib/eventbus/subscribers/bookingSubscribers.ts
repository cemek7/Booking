/**
 * Booking Event Subscribers
 * 
 * Handles booking-related events published by the booking engine:
 * - booking.created
 * - booking.confirmation_required
 * - booking.updated
 * - booking.cancelled
 */

import { Event, EventHandler } from '../eventBus';
import { BookingNotificationService } from '@/lib/bookingNotifications';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Subscriber for booking.confirmation_required events
 * Sends WhatsApp confirmation and schedules reminders
 */
export const bookingConfirmationRequiredHandler: EventHandler = {
  eventType: 'booking.confirmation_required',
  handler: async (event: Event) => {
    console.log('[Subscriber] Processing booking.confirmation_required', event.aggregateId);
    
    const notificationService = new BookingNotificationService();
    const { booking_id, tenant_id, customer_phone, customer_name, service_id, start_time, end_time } = event.payload;

    try {
      // Fetch full booking details
      const supabase = createServerSupabaseClient();
      const { data: booking, error } = await supabase
        .from('reservations')
        .select('*, services(name)')
        .eq('id', booking_id)
        .single();

      if (error || !booking) {
        console.error('[Subscriber] Failed to fetch booking:', error);
        return;
      }

      // Send WhatsApp confirmation
      const serviceName = (booking.services as any)?.name || 'Service';
      await notificationService.sendWhatsAppConfirmation({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: customer_phone,
        customerName: customer_name,
        serviceName,
        bookingDate: new Date(start_time).toLocaleDateString(),
        bookingTime: new Date(start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: booking.status
      });

      // Schedule reminders
      await notificationService.scheduleBookingReminders({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: customer_phone,
        customerName: customer_name,
        serviceName,
        bookingDate: new Date(start_time).toLocaleDateString(),
        bookingTime: new Date(start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        appointmentTime: new Date(start_time)
      });

      console.log('[Subscriber] Booking confirmation sent and reminders scheduled:', booking_id);
    } catch (error) {
      console.error('[Subscriber] Error processing booking.confirmation_required:', error);
      throw error; // Re-throw to trigger retry in event bus
    }
  },
  options: {
    idempotent: true,
    maxRetries: 3,
    retryDelay: 5000,
    deadLetterQueue: true
  }
};

/**
 * Subscriber for booking.created events
 * Triggers analytics, webhooks, and other post-creation tasks
 */
export const bookingCreatedHandler: EventHandler = {
  eventType: 'booking.created',
  handler: async (event: Event) => {
    console.log('[Subscriber] Processing booking.created', event.aggregateId);
    
    const { booking_id, tenant_id } = event.payload;

    try {
      const supabase = createServerSupabaseClient();

      // Update analytics metrics (fire and forget)
      await supabase.rpc('increment_booking_count', {
        p_tenant_id: tenant_id,
        p_date: new Date().toISOString().split('T')[0]
      }).catch(err => console.warn('[Subscriber] Analytics update failed:', err));

      // Trigger external webhooks (if configured)
      const { data: webhooks } = await supabase
        .from('tenant_webhooks')
        .select('*')
        .eq('tenant_id', tenant_id)
        .eq('event_type', 'booking.created')
        .eq('is_active', true);

      if (webhooks && webhooks.length > 0) {
        for (const webhook of webhooks) {
          // Fire webhook asynchronously
          fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': webhook.secret || ''
            },
            body: JSON.stringify(event.payload)
          }).catch(err => console.warn('[Subscriber] Webhook delivery failed:', err));
        }
      }

      console.log('[Subscriber] Booking created event processed:', booking_id);
    } catch (error) {
      console.error('[Subscriber] Error processing booking.created:', error);
      // Don't throw - these are non-critical operations
    }
  },
  options: {
    idempotent: true,
    maxRetries: 2,
    retryDelay: 3000
  }
};

/**
 * Subscriber for booking.cancelled events
 * Sends cancellation notification and cleans up reminders
 */
export const bookingCancelledHandler: EventHandler = {
  eventType: 'booking.cancelled',
  handler: async (event: Event) => {
    console.log('[Subscriber] Processing booking.cancelled', event.aggregateId);
    
    const notificationService = new BookingNotificationService();
    const { booking_id, tenant_id, customer_phone, cancellation_reason } = event.payload;

    try {
      const supabase = createServerSupabaseClient();

      // Fetch booking details
      const { data: booking, error } = await supabase
        .from('reservations')
        .select('*, services(name)')
        .eq('id', booking_id)
        .single();

      if (error || !booking) {
        console.error('[Subscriber] Failed to fetch booking for cancellation:', error);
        return;
      }

      // Send cancellation notification
      const serviceName = (booking.services as any)?.name || 'Service';
      await notificationService.sendCancellationNotification({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: customer_phone,
        serviceName,
        bookingDate: new Date(booking.start_at).toLocaleDateString(),
        bookingTime: new Date(booking.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        cancellationReason: cancellation_reason
      });

      // Cancel scheduled reminders
      await supabase
        .from('scheduled_notifications')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('booking_id', booking_id)
        .eq('status', 'scheduled');

      console.log('[Subscriber] Booking cancellation processed:', booking_id);
    } catch (error) {
      console.error('[Subscriber] Error processing booking.cancelled:', error);
      throw error;
    }
  },
  options: {
    idempotent: true,
    maxRetries: 3,
    retryDelay: 5000
  }
};

/**
 * All booking event subscribers
 */
export const bookingSubscribers: EventHandler[] = [
  bookingConfirmationRequiredHandler,
  bookingCreatedHandler,
  bookingCancelledHandler
];
