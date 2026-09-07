/**
 * Booking Event Subscribers
 *
 * Handles booking-related events published by the booking engine:
 * - booking.created
 * - booking.confirmation_required
 * - booking.updated
 * - booking.cancelled
 */

import { defaultLogger } from '@/lib/logger';
import { Event, EventHandler } from '../eventBus';
import { BookingNotificationService } from '@/lib/bookingNotifications';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { siasOperations } from '@/lib/sias-operations';

/**
 * Subscriber for booking.confirmation_required events
 * Sends WhatsApp confirmation and schedules reminders
 */
export const bookingConfirmationRequiredHandler: EventHandler = {
  eventType: 'booking.confirmation_required',
  handler: async (event: Event) => {
    defaultLogger.info('[Subscriber] Processing booking.confirmation_required', event.aggregateId);
    
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
        defaultLogger.error('[Subscriber] Failed to fetch booking:', error);
        return;
      }

      // Send WhatsApp confirmation
      const serviceName = (booking.services as { name?: string } | null | undefined)?.name || 'Service';
      await notificationService.sendBookingConfirmation({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: String(customer_phone ?? ''),
        customerName: customer_name ? String(customer_name) : undefined,
        serviceName,
        bookingDate: new Date(start_time as string).toLocaleDateString(),
        bookingTime: new Date(start_time as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: booking.status
      });

      // Schedule reminders
      await notificationService.scheduleReminders({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: String(customer_phone ?? ''),
        customerName: customer_name ? String(customer_name) : undefined,
        serviceName,
        bookingDate: new Date(start_time as string).toLocaleDateString(),
        bookingTime: new Date(start_time as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: booking.status
      });

      await siasOperations.recordCampaignRun({
        tenantId: booking.tenant_id,
        campaignType: 'booking_confirmation',
        action: 'send_reminder',
        targetPhone: customer_phone != null ? String(customer_phone) : null,
        targetBookingId: booking.id,
        sourceEvent: 'booking.confirmation_required',
        status: 'sent',
        metadata: {
          booking_id,
          service_id,
          start_time,
          end_time,
        },
        attribution: {
          signal: 'no_show_reduction',
          source_event: 'booking.confirmation_required',
        },
      });

      defaultLogger.info('[Subscriber] Booking confirmation sent and reminders scheduled:', booking_id);
    } catch (error) {
      defaultLogger.error('[Subscriber] Error processing booking.confirmation_required:', error);
      await siasOperations.createEscalationTicket({
        tenantId: String(event.tenantId ?? event.payload?.tenant_id ?? ''),
        customerPhone: String(customer_phone ?? 'unknown'),
        sessionId: String(booking_id ?? event.aggregateId),
        reason: 'booking confirmation failed',
        conversationSnapshot: [
          {
            event: 'booking.confirmation_required',
            booking_id,
            tenant_id,
            customer_phone,
          },
        ],
      }).catch(() => undefined);
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
    defaultLogger.info('[Subscriber] Processing booking.created', event.aggregateId);
    
    const { booking_id, tenant_id } = event.payload;

    try {
      const supabase = createServerSupabaseClient();
      const { data: booking } = await supabase
        .from('reservations')
        .select('id, tenant_id, customer_phone, customer_name, service_id, service, services(name)')
        .eq('id', booking_id)
        .maybeSingle();

      // Update analytics metrics (fire and forget)
      try {
        await supabase.rpc('increment_booking_count', {
          p_tenant_id: tenant_id,
          p_date: new Date().toISOString().split('T')[0]
        });
      } catch (err) {
        defaultLogger.warn('[Subscriber] Analytics update failed:', err);
      }

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
          }).catch(err => defaultLogger.warn('[Subscriber] Webhook delivery failed:', err));
        }
      }

      if (booking) {
        await siasOperations.recordBookingMemory({
          tenantId: booking.tenant_id,
          reservationId: booking.id,
          customerPhone: booking.customer_phone ?? null,
          customerName: booking.customer_name ?? null,
          serviceId: booking.service_id ?? null,
          serviceName: (booking as { services?: { name?: string } | null }).services?.name ?? booking.service ?? null,
          sourceEvent: 'booking.created',
        });
      }

      defaultLogger.info('[Subscriber] Booking created event processed:', booking_id);
    } catch (error) {
      defaultLogger.error('[Subscriber] Error processing booking.created:', error);
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
    defaultLogger.info('[Subscriber] Processing booking.cancelled', event.aggregateId);
    
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
        defaultLogger.error('[Subscriber] Failed to fetch booking for cancellation:', error);
        return;
      }

      // Send cancellation notification (status update to "cancelled")
      const serviceName = (booking.services as { name?: string } | null | undefined)?.name || 'Service';
      await notificationService.sendStatusUpdate({
        bookingId: booking.id,
        tenantId: booking.tenant_id,
        customerPhone: String(customer_phone ?? ''),
        serviceName,
        bookingDate: new Date(booking.start_at).toLocaleDateString(),
        bookingTime: new Date(booking.start_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'cancelled'
      });

      // Cancel scheduled reminders
      await supabase
        .from('scheduled_notifications')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('booking_id', booking_id)
        .eq('status', 'scheduled');

      await siasOperations.recordCampaignRun({
        tenantId: booking.tenant_id,
        campaignType: 'reactivation',
        action: 'send_reactivation',
        targetPhone: customer_phone != null ? String(customer_phone) : null,
        targetBookingId: booking.id,
        sourceEvent: 'booking.cancelled',
        status: 'retry_scheduled',
        scheduledFor: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        metadata: {
          cancellation_reason: cancellation_reason ?? null,
          service_name: serviceName,
        },
        attribution: {
          signal: 'revenue_recovery',
          source_event: 'booking.cancelled',
        },
      });

      await siasOperations.updateOperationalMemory({
        tenantId: booking.tenant_id,
        memoryKey: 'last_cancellation_reason',
        memoryValue: {
          booking_id: booking.id,
          cancellation_reason: cancellation_reason ?? null,
          service_id: booking.service_id ?? null,
        },
        source: 'booking.cancelled',
        confidence: 0.8,
      });

      defaultLogger.info('[Subscriber] Booking cancellation processed:', booking_id);
    } catch (error) {
      defaultLogger.error('[Subscriber] Error processing booking.cancelled:', error);
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
