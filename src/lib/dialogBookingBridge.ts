/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const */
import { defaultLogger } from '@/lib/logger';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { createReservation } from './reservationService';
import { detectIntent, type Intent, type IntentType, type ContextualHints } from './intentDetector';
import * as dialogManager from './dialogManager';
import { observability } from './observability/observability';
import { z } from 'zod';
import { BookingStep } from '../types/shared';
import { PaymentsAdapter } from './paymentsAdapter';
import { generateCalendarLinks, bookingToCalendarEvent } from './integrations/universalCalendar';

// Dialog state for booking flow
export interface BookingDialogState {
  step: BookingStep;
  intent?: IntentType;
  serviceId?: string;
  serviceName?: string;
  staffId?: string;
  staffName?: string;
  startTime?: string;
  endTime?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  tenantId?: string;
  bookingId?: string;
  paymentUrl?: string;
  errors?: string[];
  retryCount?: number;
  // For product inquiry context
  productQuery?: string;
}

const BookingSlotSchema = z.object({
  serviceId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  customerName: z.string().min(1).optional(),
  customerPhone: z.string().min(10).optional(),
  customerEmail: z.string().email().optional(),
  notes: z.string().max(500).optional()
});

/**
 * Dialog-to-Booking Bridge Service
 * Coordinates conversation flows with booking engine operations
 */
export class DialogBookingBridge {
  private supabase: any;
  private isInitialized = false;

  constructor() {
    this.supabase = createServerSupabaseClient();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;
  }

  /**
   * Process incoming message and advance booking dialog
   */
  async processMessage(
    tenantId: string,
    sessionId: string,
    message: string,
    userPhone?: string
  ): Promise<{
    response: string;
    completed: boolean;
    error?: string;
    nextStep?: string;
  }> {
    const traceContext = observability.startTrace('dialog_booking.process_message');
    
    try {
      // Get current session state
      const session = await dialogManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }
      // Prevent cross-tenant session access
      if (session.tenant_id && session.tenant_id !== tenantId) {
        defaultLogger.error('[dialog] Cross-tenant session access attempt', { sessionId, tenantId, sessionTenantId: session.tenant_id });
        throw new Error('Session tenant mismatch');
      }

      const state = this.parseDialogState(session.slots);

      // Business hours check — respond warmly if outside hours
      const oohResponse = await this.checkOutsideBusinessHours(tenantId, state);
      if (oohResponse) {
        observability.addTraceLog(traceContext, 'info', 'Out-of-hours response triggered');
        return oohResponse;
      }

      // Detect intent if not already determined
      if (!state.step || state.step === 'intent') {
        const [messageCount, services] = await Promise.all([
          this.getSessionMessageCount(tenantId, sessionId),
          this.getAvailableServices(tenantId),
        ]);
        const context: ContextualHints = {
          conversationTurn: messageCount + 1,
          tenantVertical: await this.getTenantVertical(tenantId),
          timeOfDay: this.getTimeOfDay(),
          services: services.map((s) => ({ name: s.name })),
        };

        const intent = await detectIntent(message, context);
        observability.setTraceTag(traceContext, 'detected_intent', intent.intent);
        observability.setTraceTag(traceContext, 'intent_confidence', intent.confidence.toString());
        
        if (intent.intent === 'unknown' && intent.confidence < 0.6) {
          return {
            response: 'I\'m not sure what you\'d like to do. Could you please clarify if you want to book an appointment, reschedule, or cancel?',
            completed: false,
            nextStep: 'intent'
          };
        }
        
        // Update state with intent and extracted entities
        state.intent = intent.intent;
        state.step = this.normalizeBookingStep(intent.intent);
        
        // Extract entities from intent detection
        if (intent.entities) {
          for (const entity of intent.entities) {
            switch (entity.type) {
              case 'time':
                if (!state.startTime) {
                  state.startTime = this.parseTimeEntity(entity.value);
                }
                break;
              case 'service':
                if (!state.serviceName) {
                  state.serviceName = entity.value;
                }
                break;
              case 'phone':
                if (!state.customerPhone) {
                  state.customerPhone = entity.value;
                }
                break;
              case 'email':
                if (!state.customerEmail) {
                  state.customerEmail = entity.value;
                }
                break;
            }
          }
        }
        
        await this.updateSessionState(sessionId, state, tenantId);
      }

      // Process based on current step
      let flowResult: { response: string; completed: boolean; error?: string; nextStep?: string };
      switch (state.step) {
        case 'booking':
          flowResult = await this.handleBookingFlow(tenantId, sessionId, state, message);
          break;
        case 'reschedule':
          flowResult = await this.handleRescheduleFlow(tenantId, sessionId, state, message);
          break;
        case 'cancel':
          flowResult = await this.handleCancelFlow(tenantId, sessionId, state, message);
          break;
        case 'service':
          flowResult = await this.handleServiceSelection(tenantId, sessionId, state, message);
          break;
        case 'staff':
          flowResult = await this.handleStaffSelection(tenantId, sessionId, state, message);
          break;
        case 'time':
          flowResult = await this.handleTimeSelection(tenantId, sessionId, state, message);
          break;
        case 'contact':
          flowResult = await this.handleContactInfo(tenantId, sessionId, state, message, userPhone);
          break;
        case 'confirm':
          flowResult = await this.handleConfirmation(tenantId, sessionId, state, message);
          break;
        case 'payment_pending':
          flowResult = await this.handlePaymentPending(tenantId, sessionId, state, message);
          break;
        case 'business_info':
          flowResult = await this.handleBusinessInfoInquiry(tenantId, sessionId, state, message);
          break;
        case 'product_inquiry':
          flowResult = await this.handleProductInquiry(tenantId, sessionId, state, message);
          break;
        case 'inquiry':
          flowResult = await this.handleGeneralInquiry(tenantId, sessionId, state, message);
          break;
        default:
          flowResult = {
            response: 'I\'m having trouble understanding where we are in the booking process. Let\'s start over. What would you like to do?',
            completed: false,
            nextStep: 'intent'
          };
      }

      // Lead capture: when session completes without a confirmed booking, capture the lead
      if (flowResult.completed && state.intent !== 'booking') {
        await this.captureLeadIfEnabled(tenantId, state, userPhone);
      }

      return flowResult;
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', `Dialog processing error: ${error}`);
      return {
        response: 'I\'m sorry, I\'m having technical difficulties. Please try again or contact support.',
        completed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      observability.finishTrace(traceContext);
    }
  }

  /**
   * Handle booking flow steps
   */
  private async handleBookingFlow(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    // If we have all required info, proceed to booking
    if (state.serviceId && state.startTime && state.customerPhone) {
      return await this.attemptBooking(tenantId, sessionId, state);
    }
    
    // Otherwise, guide through missing info
    if (!state.serviceId) {
      return await this.handleServiceSelection(tenantId, sessionId, state, message);
    }
    if (!state.startTime) {
      return await this.handleTimeSelection(tenantId, sessionId, state, message);
    }
    if (!state.customerPhone) {
      return await this.handleContactInfo(tenantId, sessionId, state, message);
    }
    
    return {
      response: 'I have all the information I need. Let me book that appointment for you.',
      completed: false,
      nextStep: 'confirm'
    };
  }

  /**
   * Handle service selection
   */
  private async handleServiceSelection(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    // Try to match service from message
    const services = await this.getAvailableServices(tenantId);
    const matched = this.matchService(message, services);
    
    if (matched) {
      state.serviceId = matched.id;
      state.serviceName = matched.name;
      state.step = 'staff';
      await this.updateSessionState(sessionId, state, tenantId);
      
      return {
        response: `Great! I'll book a ${matched.name} for you. Do you have a preferred staff member, or would you like me to assign someone available?`,
        completed: false,
        nextStep: 'staff'
      };
    }
    
    // List available services
    const serviceList = services.slice(0, 5).map(s => s.name).join(', ');
    return {
      response: `I'd be happy to book an appointment for you. We offer: ${serviceList}. Which service would you like?`,
      completed: false,
      nextStep: 'service'
    };
  }

  /**
   * Handle staff selection
   */
  private async handleStaffSelection(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    const low = message.toLowerCase();
    
    if (/\b(any|anyone|don't care|no preference|available)\b/.test(low)) {
      // Auto-assign staff later
      state.step = 'time';
      await this.updateSessionState(sessionId, state, tenantId);
      
      return {
        response: 'Perfect! I\'ll assign an available staff member. When would you like your appointment? Please provide a date and time.',
        completed: false,
        nextStep: 'time'
      };
    }
    
    // Try to match staff name
    const staff = await this.getAvailableStaff(tenantId);
    const matched = this.matchStaff(message, staff);
    
    if (matched) {
      state.staffId = matched.id;
      state.staffName = matched.name;
      state.step = 'time';
      await this.updateSessionState(sessionId, state, tenantId);
      
      return {
        response: `Great choice! I'll book you with ${matched.name}. When would you like your appointment?`,
        completed: false,
        nextStep: 'time'
      };
    }
    
    const staffList = staff.slice(0, 3).map(s => s.name).join(', ');
    return {
      response: `Our available staff includes: ${staffList}. Who would you prefer, or say \"any available\" for auto-assignment?`,
      completed: false,
      nextStep: 'staff'
    };
  }

  /**
   * Handle time selection
   */
  private async handleTimeSelection(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    // Guard: service must be selected before time
    if (!state.serviceId) {
      return {
        response: 'Before we pick a time, I need to know which service you\'d like. What service can I book for you?',
        completed: false,
        nextStep: 'service'
      };
    }

    const timeInfo = this.extractTimeFromMessage(message);

    if (timeInfo.startTime) {
      // Validate availability
      const isAvailable = await this.checkAvailability(
        tenantId,
        timeInfo.startTime,
        state.serviceId,
        state.staffId
      );
      
      if (isAvailable) {
        state.startTime = timeInfo.startTime;
        state.endTime = timeInfo.endTime;
        state.step = 'contact';
        await this.updateSessionState(sessionId, state, tenantId);
        
        return {
          response: `Perfect! ${timeInfo.formatted} is available. I'll need your contact information to complete the booking. What's your phone number?`,
          completed: false,
          nextStep: 'contact'
        };
      } else {
        // Suggest alternatives
        const alternatives = await this.suggestAlternativeTimes(
          tenantId,
          timeInfo.startTime,
          state.serviceId!,
          state.staffId
        );
        
        const altText = alternatives.length > 0
          ? ` How about: ${alternatives.join(', ')}?`
          : ' Please suggest a different date or time.';
        return {
          response: `I'm sorry, ${timeInfo.formatted} isn't available.${altText}`,
          completed: false,
          nextStep: 'time'
        };
      }
    }
    
    return {
      response: 'I need a specific date and time for your appointment. For example, you could say \'tomorrow at 2pm\' or \'Friday at 10:30am\'.',
      completed: false,
      nextStep: 'time'
    };
  }

  /**
   * Handle contact information
   */
  private async handleContactInfo(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string,
    userPhone?: string
  ) {
    // Use existing phone if available
    if (userPhone && !state.customerPhone) {
      state.customerPhone = userPhone;
    }
    
    // Extract contact info from message
    const phoneMatch = message.match(/(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/);
    const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    
    if (phoneMatch && !state.customerPhone) {
      state.customerPhone = phoneMatch[0];
    }
    if (emailMatch && !state.customerEmail) {
      state.customerEmail = emailMatch[0];
    }
    
    // Extract name if mentioned
    const nameMatch = message.match(/(?:name is|i'm|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    if (nameMatch && !state.customerName) {
      state.customerName = nameMatch[1];
    }

    if (state.customerPhone) {
      state.step = 'confirm';
      await this.updateSessionState(sessionId, state, tenantId);

      const summary = this.createBookingSummary(state);
      return {
        response: `Great! Here's your booking summary:\n${summary}\n\nPlease reply 'YES' to confirm or let me know if you'd like to change anything.`,
        completed: false,
        nextStep: 'confirm'
      };
    }
    
    return {
      response: 'I\'ll need your phone number to complete the booking. What\'s the best number to reach you?',
      completed: false,
      nextStep: 'contact'
    };
  }

  /**
   * Handle booking confirmation
   */
  private async handleConfirmation(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    const low = message.toLowerCase();

    if (/\b(yes|y|confirm|book|ok|sure|correct)\b/.test(low)) {
      return await this.attemptBooking(tenantId, sessionId, state);
    }

    if (/\b(no|n|cancel|change|different)\b/.test(low)) {
      state.step = 'service';
      await this.updateSessionState(sessionId, state, tenantId);

      return {
        response: 'No problem! What would you like to change? (service, time, or staff)',
        completed: false,
        nextStep: 'service'
      };
    }
    
    return {
      response: 'Please reply \'YES\' to confirm your booking or \'NO\' to make changes.',
      completed: false,
      nextStep: 'confirm'
    };
  }

  /**
   * Attempt to create the booking, then request payment via Paystack
   */
  private async attemptBooking(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState
  ) {
    try {
      // Idempotency: if a booking was already created for this session, skip creation
      const existingBookingId = state.bookingId;
      if (existingBookingId) {
        const { data: existingBooking } = await this.supabase
          .from('reservations')
          .select('id, status')
          .eq('id', existingBookingId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (existingBooking) {
          if (state.paymentUrl) {
            return {
              response:
                `✅ Your booking already exists! Ref: #${existingBooking.id.slice(-6).toUpperCase()}\n\n` +
                `💳 *Complete your payment here:*\n${state.paymentUrl}\n\n` +
                `_Reply DONE once payment is complete._`,
              completed: false,
              nextStep: 'payment_pending'
            };
          }
          return await this.sendBookingConfirmedResponse(tenantId, sessionId, state, existingBooking);
        }
      }

      const staffId = state.staffId || await this.autoAssignStaff(tenantId, state.serviceId!, state.startTime!);
      const bookingData = {
        customer_name: state.customerName || 'Walk-in Customer',
        phone: state.customerPhone!,
        service_id: state.serviceId!,
        service: state.serviceName || state.serviceId!,
        staff_id: staffId,
        start_time: state.startTime!,
        end_time: state.endTime || await this.calculateEndTime(state.startTime!, state.serviceId!),
        notes: state.notes,
        metadata: {
          source: 'whatsapp_conversation',
          session_id: sessionId
        }
      };

      const reservation = await createReservation(
        createSupabaseAdminClient(),
        {
          tenant_id: tenantId,
          customer_name: bookingData.customer_name,
          phone: bookingData.phone,
          service_id: bookingData.service_id,
          service: bookingData.service,
          start_at: bookingData.start_time,
          end_at: bookingData.end_time,
          status: 'confirmed',
          metadata: bookingData.metadata,
          staff_id: bookingData.staff_id,
        }
      );

      if (!reservation) {
        return {
          response: 'I\'m sorry, there was a problem creating your booking. Please try again or call us directly.',
          completed: false,
          error: 'Booking creation failed'
        };
      }

      state.bookingId = reservation.id;

      // Fetch service price for deposit
      const { data: service } = await this.supabase
        .from('services')
        .select('price, currency')
        .eq('id', state.serviceId!)
        .maybeSingle();

      const currency = service?.currency || 'NGN';
      const priceMinor = Math.round((service?.price || 0) * 100); // convert to kobo/cents

      // Attempt to create a deposit via paymentsAdapter (defaults to Paystack)
      let paymentUrl: string | null = null;
      if (priceMinor > 0) {
        try {
          // Idempotency: check for an existing pending deposit before creating a new one
          const { data: existingDeposit } = await this.supabase
            .from('transactions')
            .select('id, raw')
            .eq('tenant_id', tenantId)
            .eq('type', 'deposit')
            .in('status', ['pending', 'success'])
            .filter('raw->reservation_id', 'eq', reservation.id)
            .maybeSingle();

          if (existingDeposit) {
            paymentUrl = existingDeposit.raw?.provider_response?.authorizationUrl || null;
          } else {
            const adapter = new PaymentsAdapter();
            const depositResult = await adapter.createDeposit({
              tenant_id: tenantId,
              reservation_id: reservation.id,
              amount_minor_units: priceMinor,
              currency,
              customer_phone: state.customerPhone,
              customer_email: state.customerEmail,
              metadata: { session_id: sessionId, source: 'whatsapp_conversation' }
            });
            if (depositResult.status === 'created' && depositResult.payment_url) {
              paymentUrl = depositResult.payment_url;
            }
          }
        } catch (payErr) {
          defaultLogger.warn('dialogBookingBridge: deposit creation failed, continuing without payment link', payErr);
        }
      }

      if (paymentUrl) {
          state.step = 'payment_pending';
          state.paymentUrl = paymentUrl;
          await this.updateSessionState(sessionId, state, tenantId);

        // Notify owner async
          this.notifyOwnerOfNewBooking(tenantId, {
          bookingId: reservation.id,
          customerName: state.customerName || 'WhatsApp Customer',
          customerPhone: state.customerPhone!,
          serviceName: state.serviceName,
          startTime: state.startTime,
          staffName: state.staffName
        }).catch(err => defaultLogger.error('Failed to notify owner:', err));

        return {
          response:
            `✅ Booking created! Ref: #${reservation.id.slice(-6).toUpperCase()}\n\n` +
            `💳 *To confirm your appointment, please complete payment:*\n${paymentUrl}\n\n` +
            `_Your slot is reserved for 15 minutes. Reply DONE once payment is complete._`,
          completed: false,
          nextStep: 'payment_pending'
        };
      }

      // No deposit required — confirm immediately with calendar link
      return await this.sendBookingConfirmedResponse(tenantId, sessionId, state, reservation);
    } catch (error) {
      return {
        response: 'I\'m sorry, I couldn\'t complete your booking due to a technical issue. Please try again.',
        completed: false,
        error: error instanceof Error ? error.message : 'Booking failed'
      };
    }
  }

  /**
   * Handle payment_pending step — customer replies after paying
   */
  private async handlePaymentPending(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ) {
    const low = message.toLowerCase();

    if (/\b(done|paid|complete|completed|payment done|i paid)\b/.test(low)) {
      // Fetch the booking and confirm
      if (state.bookingId) {
        const { data: booking } = await this.supabase
          .from('reservations')
          .select('id, start_at, end_at, status')
          .eq('id', state.bookingId)
          .maybeSingle();

        if (booking) {
          return await this.sendBookingConfirmedResponse(tenantId, sessionId, state, booking);
        }
      }
    }

    // Re-send the payment link if they're asking again
    const paymentUrl = state.paymentUrl;
    return {
      response:
        `⏳ We're waiting for your payment to be confirmed.\n\n` +
        (paymentUrl ? `💳 Payment link: ${paymentUrl}\n\n` : '') +
        `Reply *DONE* once you've completed the payment.`,
      completed: false,
      nextStep: 'payment_pending'
    };
  }

  /**
   * Send a confirmed booking response with a universal calendar link
   */
  private async sendBookingConfirmedResponse(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    booking: { id: string; start_at?: string; end_at?: string }
  ) {
    state.step = 'complete';
    await this.updateSessionState(sessionId, state, tenantId);

    // Generate calendar link (Google Calendar as primary for WhatsApp)
    let calendarLine = '';
    try {
      const tenantInfo = await this.getTenantInfo(tenantId);
      const startTime = new Date(booking.start_at || state.startTime!);
      const endTime = new Date(booking.end_at || state.endTime || await this.calculateEndTime(startTime.toISOString(), state.serviceId!));
      const calendarLinks = generateCalendarLinks({
        title: `${state.serviceName || 'Appointment'} - ${tenantInfo?.name || 'Booking'}`,
        description: `Service: ${state.serviceName || 'Appointment'}\nBooking ref: #${booking.id.slice(-6).toUpperCase()}`,
        location: tenantInfo?.address,
        startTime,
        endTime
      });
      const googleLink = calendarLinks.find(l => l.name === 'Google Calendar');
      if (googleLink) {
        calendarLine = `\n\n📅 Add to calendar: ${googleLink.url}`;
      }
    } catch (calErr) {
      defaultLogger.warn('dialogBookingBridge: calendar link generation failed', calErr);
    }

    // Notify owner async
    this.notifyOwnerOfNewBooking(tenantId, {
      bookingId: booking.id,
      customerName: state.customerName || 'WhatsApp Customer',
      customerPhone: state.customerPhone!,
      serviceName: state.serviceName,
      startTime: state.startTime,
      staffName: state.staffName
    }).catch(err => defaultLogger.error('Failed to notify owner:', err));

    return {
      response:
        `🎉 *Booking Confirmed!*\n\n` +
        `Booking Ref: #${booking.id.slice(-6).toUpperCase()}\n` +
        `📋 Service: ${state.serviceName || 'Appointment'}\n` +
        `📅 Time: ${state.startTime ? new Date(state.startTime).toLocaleString() : 'TBD'}` +
        calendarLine +
        `\n\nThank you! We'll see you soon. 👋`,
      completed: true
    };
  }

  // Helper methods
  private parseDialogState(slots: Record<string, unknown>): BookingDialogState {
    return {
      step: this.normalizeBookingStep(typeof slots.step === 'string' ? slots.step : 'intent'),
      intent: typeof slots.intent === 'string' ? (slots.intent as IntentType) : undefined,
      serviceId: slots.serviceId as string,
      serviceName: slots.serviceName as string,
      staffId: slots.staffId as string,
      staffName: slots.staffName as string,
      startTime: slots.startTime as string,
      endTime: slots.endTime as string,
      customerName: slots.customerName as string,
      customerPhone: slots.customerPhone as string,
      customerEmail: slots.customerEmail as string,
      notes: slots.notes as string,
      bookingId: slots.bookingId as string,
      paymentUrl: slots.paymentUrl as string,
      errors: (slots.errors as string[]) || [],
      retryCount: (slots.retryCount as number) || 0
    };
  }

  private async updateSessionState(sessionId: string, state: BookingDialogState, tenantId?: string): Promise<void> {
    // Merge all state fields into a single write to prevent concurrent requests seeing partial state
    await dialogManager.updateSlots(sessionId, {
      step: state.step,
      intent: state.intent,
      serviceId: state.serviceId,
      serviceName: state.serviceName,
      staffId: state.staffId,
      staffName: state.staffName,
      startTime: state.startTime,
      endTime: state.endTime,
      customerName: state.customerName,
      customerPhone: state.customerPhone,
      customerEmail: state.customerEmail,
      notes: state.notes,
      bookingId: state.bookingId,
      paymentUrl: state.paymentUrl,
    }, tenantId);
  }

  private async getTenantVertical(tenantId: string): Promise<'beauty' | 'hospitality' | 'medicine' | undefined> {
    try {
      const { data } = await this.supabase
        .from('tenants')
        .select('industry')
        .eq('id', tenantId)
        .single();
      return data?.industry;
    } catch {
      return undefined;
    }
  }

  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour < 6) return 'night';
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'night';
  }

  private parseTimeEntity(timeStr: string): string {
    // Delegate to extractTimeFromMessage which handles natural language time parsing
    const result = this.extractTimeFromMessage(timeStr);
    if (result.startTime) return result.startTime;
    // Fallback: try parsing as direct ISO/date string
    const parsed = new Date(timeStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
    // Default: 24h from now
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  private extractTimeFromMessage(message: string): {
    startTime?: string;
    endTime?: string;
    formatted?: string;
  } {
    const msg = message.toLowerCase();
    const now = new Date();

    // Resolve the date part
    let baseDate = new Date(now);
    let explicitDayMatch = -1;
    if (msg.includes('tomorrow')) {
      baseDate.setDate(baseDate.getDate() + 1);
    } else {
      // e.g. "monday", "tuesday" etc.
      const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
      explicitDayMatch = days.findIndex(d => msg.includes(d));
      if (explicitDayMatch !== -1) {
        const diff = (explicitDayMatch - now.getDay() + 7) % 7 || 7;
        baseDate.setDate(baseDate.getDate() + diff);
      }
    }

    // Extract time: "3pm", "3:30pm", "15:00", "3 pm", "3:30 pm"
    // Hours constrained to 1-12 for 12h format, 0-23 for 24h format; minutes constrained to 00-59
    const timeRegex = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/i;
    const match = message.match(timeRegex);
    if (!match) return {};

    let hours = parseInt(match[1] ?? match[4] ?? '0', 10);
    const minutes = parseInt(match[2] ?? match[5] ?? '0', 10);
    const meridiem = (match[3] ?? '').toLowerCase();
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;

    baseDate.setHours(hours, minutes, 0, 0);

    // Advance past datetimes so we never book in the past
    if (baseDate <= now) {
      if (explicitDayMatch !== -1) {
        baseDate.setDate(baseDate.getDate() + 7);
      } else {
        baseDate.setDate(baseDate.getDate() + 1);
      }
    }

    const startTime = baseDate.toISOString();
    const endDate = new Date(baseDate.getTime() + 60 * 60 * 1000); // default 1h duration
    const endTime = endDate.toISOString();
    const formatted = baseDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return { startTime, endTime, formatted };
  }

  private async getAvailableServices(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    const { data } = await this.supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('active', true);
    return data || [];
  }

  private matchService(message: string, services: Array<{ id: string; name: string }>): { id: string; name: string } | null {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const msgNorm = norm(message);
    const msgWords = new Set(msgNorm.split(/\s+/).filter((w) => w.length > 2));

    let best: { service: { id: string; name: string }; score: number } | null = null;
    for (const svc of services) {
      const svcNorm = norm(svc.name);
      // Exact substring match — return immediately
      if (msgNorm.includes(svcNorm)) return svc;
      // Word-overlap ratio
      const svcWords = svcNorm.split(/\s+/).filter((w) => w.length > 2);
      const overlap = svcWords.filter((w) => msgWords.has(w)).length;
      const score = svcWords.length ? overlap / svcWords.length : 0;
      if (score > 0 && (!best || score > best.score)) best = { service: svc, score };
    }
    return best && best.score >= 0.5 ? best.service : null;
  }

  private async getSessionMessageCount(tenantId: string, sessionId: string): Promise<number> {
    try {
      const { count } = await this.supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('session_id', sessionId);
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  private async getAvailableStaff(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    const { data } = await this.supabase
      .from('tenant_users')
      .select('user_id, users(full_name)')
      .eq('tenant_id', tenantId)
      .eq('role', 'staff');
    return (data as Array<{ user_id: string; users?: { full_name?: string | null } | null }> | undefined)?.map((u) => ({
      id: u.user_id,
      name: u.users?.full_name || 'Staff Member',
    })) || [];
  }

  private matchStaff(message: string, staff: Array<{ id: string; name: string }>): { id: string; name: string } | null {
    const low = message.toLowerCase();
    return staff.find(s => low.includes(s.name.toLowerCase().split(' ')[0])) || null;
  }

  private async checkAvailability(tenantId: string, startTime: string, serviceId: string, staffId?: string): Promise<boolean> {
    try {
      const start = new Date(startTime);
      if (isNaN(start.getTime())) return false;

      const { data: service } = await this.supabase
        .from('services')
        .select('duration')
        .eq('id', serviceId)
        .maybeSingle();

      const end = new Date(start.getTime() + ((service?.duration ?? 60) * 60000));

      let query = this.supabase
        .from('reservations')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .in('status', ['confirmed', 'pending'])
        .lt('start_at', end.toISOString())
        .gt('end_at', start.toISOString());

      if (staffId) {
        query = query.eq('staff_id', staffId);
      }

      const { count } = await query;
      return (count ?? 0) === 0;
    } catch {
      return false;
    }
  }

  private async suggestAlternativeTimes(tenantId: string, requestedTime: string, serviceId: string, staffId?: string): Promise<string[]> {
    const suggestions: string[] = [];
    try {
      const base = new Date(requestedTime);
      if (isNaN(base.getTime())) return [];

      // Try next 8 hourly slots from the requested time; return up to 3 that are available
      for (let i = 1; i <= 8 && suggestions.length < 3; i++) {
        const candidate = new Date(base.getTime() + i * 60 * 60 * 1000);
        const available = await this.checkAvailability(tenantId, candidate.toISOString(), serviceId, staffId);
        if (available) {
          suggestions.push(candidate.toLocaleString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true,
          }));
        }
      }
    } catch {
      // ignore errors — caller will handle empty list
    }
    return suggestions;
  }

  private async autoAssignStaff(tenantId: string, serviceId: string, startTime: string): Promise<string> {
    const staff = await this.getAvailableStaff(tenantId);
    return staff[0]?.id || '';
  }

  private async calculateEndTime(startTime: string, serviceId: string): Promise<string> {
    const start = new Date(startTime);
    let durationMinutes = 60; // default fallback
    try {
      const { data: service } = await this.supabase
        .from('services')
        .select('duration')
        .eq('id', serviceId)
        .single();
      if (service?.duration && typeof service.duration === 'number' && service.duration > 0) {
        durationMinutes = service.duration;
      }
    } catch {
      // fall back to 60 min
    }
    return new Date(start.getTime() + durationMinutes * 60 * 1000).toISOString();
  }

  private createBookingSummary(state: BookingDialogState): string {
    return [
      `Service: ${state.serviceName}`,
      state.staffName ? `Staff: ${state.staffName}` : '',
      `Time: ${state.startTime ? new Date(state.startTime).toLocaleString() : 'TBD'}`,
      `Phone: ${state.customerPhone}`,
      state.customerEmail ? `Email: ${state.customerEmail}` : ''
    ].filter(Boolean).join('\n');
  }

  private async handleRescheduleFlow(tenantId: string, sessionId: string, state: BookingDialogState, message: string) {
    if (!state.customerPhone) {
      return { response: 'I need your phone number to look up your booking. What number did you use?', completed: false };
    }

    const { data: booking } = await this.supabase
      .from('reservations')
      .select('id, service_id, staff_id, start_at, end_at, status')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', state.customerPhone)
      .in('status', ['confirmed', 'pending'])
      .order('start_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return { response: 'I couldn\'t find an upcoming booking for your number. Would you like to make a new booking instead?', completed: true };
    }

    // Update booking status to pending_reschedule for staff to action
    await this.supabase
      .from('reservations')
      .update({ status: 'pending_reschedule', updated_at: new Date().toISOString() })
      .eq('id', booking.id);

    const formattedTime = booking.start_at ? new Date(booking.start_at).toLocaleString() : 'your appointment';
    return {
      response: `I've flagged your booking on ${formattedTime} for rescheduling. A team member will contact you shortly to confirm your new time.`,
      completed: true,
    };
  }

  private async handleCancelFlow(tenantId: string, sessionId: string, state: BookingDialogState, message: string) {
    if (!state.customerPhone) {
      return { response: 'I need your phone number to look up your booking. What number did you use?', completed: false };
    }

    const { data: booking } = await this.supabase
      .from('reservations')
      .select('id, start_at, status')
      .eq('tenant_id', tenantId)
      .eq('customer_phone', state.customerPhone)
      .in('status', ['confirmed', 'pending'])
      .order('start_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return { response: 'I couldn\'t find an active booking for your number.', completed: true };
    }

    await this.supabase
      .from('reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', booking.id);

    const formattedTime = booking.start_at ? new Date(booking.start_at).toLocaleString() : 'your appointment';
    return {
      response: `Your booking on ${formattedTime} has been cancelled. We hope to see you again soon!`,
      completed: true,
    };
  }

  /**
   * Notify tenant owner of a new booking via WhatsApp
   */
  private async notifyOwnerOfNewBooking(
    tenantId: string,
    booking: {
      bookingId: string;
      customerName: string;
      customerPhone: string;
      serviceName?: string;
      startTime?: string;
      staffName?: string;
    }
  ): Promise<void> {
    try {
      // Get tenant info
      const { data: tenant } = await this.supabase
        .from('tenants')
        .select('name, settings')
        .eq('id', tenantId)
        .single();

      // Get owner's phone from tenant_users
      const { data: ownerData } = await this.supabase
        .from('tenant_users')
        .select(`
          user_id,
          users!inner(phone, email)
        `)
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .single();

      const ownerPhone = (ownerData?.users as { phone?: string })?.phone;

      if (!ownerPhone) {
        defaultLogger.info('No owner phone found for tenant:', tenantId);
        return;
      }

      const bookingRef = booking.bookingId.slice(-6).toUpperCase();
      const formattedTime = booking.startTime
        ? new Date(booking.startTime).toLocaleString()
        : 'Not specified';

      const message =
        `📅 *New Booking Confirmed*\n\n` +
        `A customer has just booked via WhatsApp:\n\n` +
        `👤 Customer: ${booking.customerName}\n` +
        `📱 Phone: ${booking.customerPhone}\n` +
        `✂️ Service: ${booking.serviceName || 'Not specified'}\n` +
        `📆 Time: ${formattedTime}\n` +
        (booking.staffName ? `👨‍💼 Staff: ${booking.staffName}\n` : '') +
        `\nRef: #${bookingRef}\n\n` +
        `_View details in your dashboard._`;

      const { getTenantWhatsAppProviderClient } = await import('@/lib/whatsapp/providers/providerSelection');
      const client = await getTenantWhatsAppProviderClient(tenantId);
      if (client) {
        await client.sendTextMessage(ownerPhone, message);
      }

      defaultLogger.info('Owner notified of new booking:', bookingRef);
    } catch (error) {
      // Don't fail the booking if notification fails
      defaultLogger.error('Failed to notify owner of booking:', error);
    }
  }

  /**
   * Handle business information inquiry
   * Returns tenant details like location, hours, contact info
   */
  private async handleBusinessInfoInquiry(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ): Promise<{ response: string; completed: boolean; nextStep?: string }> {
    try {
      const tenantInfo = await this.getTenantInfo(tenantId);

      if (!tenantInfo) {
        return {
          response: 'I apologize, but I couldn\'t retrieve the business information at this time. Please try again later.',
          completed: false,
          nextStep: 'intent'
        };
      }

      // Format business information
      const infoLines = [
        `📍 *${tenantInfo.name}*`,
        '',
      ];

      if (tenantInfo.description) {
        infoLines.push(`ℹ️ ${tenantInfo.description}`);
        infoLines.push('');
      }

      if (tenantInfo.address) {
        infoLines.push(`📫 Address: ${tenantInfo.address}`);
      }

      if (tenantInfo.phone) {
        infoLines.push(`📞 Phone: ${tenantInfo.phone}`);
      }

      if (tenantInfo.email) {
        infoLines.push(`✉️ Email: ${tenantInfo.email}`);
      }

      if (tenantInfo.businessHours) {
        infoLines.push('');
        infoLines.push('🕐 *Business Hours:*');
        infoLines.push(tenantInfo.businessHours);
      }

      infoLines.push('');
      infoLines.push('Would you like to book an appointment or ask about our products/services?');

      return {
        response: infoLines.join('\n'),
        completed: false,
        nextStep: 'intent'
      };
    } catch (error) {
      defaultLogger.error('Error handling business info inquiry:', error);
      return {
        response: 'I\'m sorry, I couldn\'t retrieve that information right now. How else can I help you?',
        completed: false,
        nextStep: 'intent'
      };
    }
  }

  /**
   * Handle product inquiry
   * Returns available products for the tenant
   */
  private async handleProductInquiry(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ): Promise<{ response: string; completed: boolean; nextStep?: string }> {
    try {
      // Check if user is asking about a specific product
      const products = await this.getProducts(tenantId, message);

      if (!products || products.length === 0) {
        return {
          response: 'We don\'t have any products listed at the moment. Would you like to book a service appointment instead?',
          completed: false,
          nextStep: 'intent'
        };
      }

      // Check if it's a specific product search
      const searchTerms = message.toLowerCase();
      const matchedProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchTerms) ||
        (p.description && p.description.toLowerCase().includes(searchTerms)) ||
        (p.category && p.category.toLowerCase().includes(searchTerms))
      );

      if (matchedProducts.length > 0 && matchedProducts.length <= 3) {
        // Show detailed info for matched products
        const productDetails = matchedProducts.map(p => {
          const price = p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : 'Price on request';
          return [
            `*${p.name}*`,
            p.description ? `  ${p.description}` : '',
            `  💰 ${price}`,
            p.stock_quantity !== undefined && p.track_inventory ? `  📦 ${p.stock_quantity > 0 ? 'In stock' : 'Out of stock'}` : ''
          ].filter(Boolean).join('\n');
        });

        return {
          response: `Here's what I found:\n\n${productDetails.join('\n\n')}\n\nWould you like to know more about any of these, or would you like to book an appointment?`,
          completed: false,
          nextStep: 'intent'
        };
      }

      // Show product categories or featured products
      const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
      const featuredProducts = products.filter(p => p.is_featured).slice(0, 5);

      let responseLines = ['🛍️ *Our Products*\n'];

      if (categories.length > 0) {
        responseLines.push('📂 *Categories:*');
        categories.forEach(cat => responseLines.push(`  • ${cat}`));
        responseLines.push('');
      }

      if (featuredProducts.length > 0) {
        responseLines.push('⭐ *Featured Products:*');
        featuredProducts.forEach(p => {
          const price = p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : '';
          responseLines.push(`  • ${p.name} ${price}`);
        });
      } else if (products.length > 0) {
        // Show first 5 products if no featured
        responseLines.push('📦 *Available Products:*');
        products.slice(0, 5).forEach(p => {
          const price = p.price_cents ? `$${(p.price_cents / 100).toFixed(2)}` : '';
          responseLines.push(`  • ${p.name} ${price}`);
        });
        if (products.length > 5) {
          responseLines.push(`  _...and ${products.length - 5} more_`);
        }
      }

      responseLines.push('\nAsk me about a specific product for more details, or type "book" to schedule an appointment!');

      // Save product query context
      state.productQuery = message;
      await this.updateSessionState(sessionId, state, tenantId);

      return {
        response: responseLines.join('\n'),
        completed: false,
        nextStep: 'intent'
      };
    } catch (error) {
      defaultLogger.error('Error handling product inquiry:', error);
      return {
        response: 'I\'m sorry, I couldn\'t retrieve product information right now. Would you like to book an appointment instead?',
        completed: false,
        nextStep: 'intent'
      };
    }
  }

  /**
   * Handle general service inquiry
   */
  private async handleGeneralInquiry(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState,
    message: string
  ): Promise<{ response: string; completed: boolean; nextStep?: string }> {
    try {
      const services = await this.getAvailableServices(tenantId);

      if (services.length === 0) {
        return {
          response: 'I don\'t see any services configured yet. Please contact us directly for assistance.',
          completed: false,
          nextStep: 'intent'
        };
      }

      const serviceList = services.map(s => `  • ${s.name}`).join('\n');

      return {
        response: `Here are our available services:\n\n${serviceList}\n\nWould you like to book any of these? Just let me know which service interests you!`,
        completed: false,
        nextStep: 'intent'
      };
    } catch (error) {
      defaultLogger.error('Error handling general inquiry:', error);
      return {
        response: 'I\'m sorry, I couldn\'t retrieve service information. Please try again or contact us directly.',
        completed: false,
        nextStep: 'intent'
      };
    }
  }

  /**
   * Get tenant information including business details
   */
  private async getTenantInfo(tenantId: string): Promise<{
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessHours?: string;
    industry?: string;
  } | null> {
    try {
      const { data, error } = await this.supabase
        .from('tenants')
        .select('name, industry, phone, metadata, tone_config')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        return null;
      }

      // Extract additional details from metadata
      const metadata = data.metadata || {};

      return {
        name: data.name,
        description: metadata.description || metadata.about,
        address: metadata.address || metadata.location,
        phone: data.phone || metadata.phone,
        email: metadata.email,
        businessHours: this.formatBusinessHours(metadata.business_hours || metadata.hours),
        industry: data.industry
      };
    } catch (error) {
      defaultLogger.error('Error fetching tenant info:', error);
      return null;
    }
  }

  /**
   * Format business hours for display
   */
  private formatBusinessHours(hours: any): string | undefined {
    if (!hours) return undefined;

    if (typeof hours === 'string') {
      return hours;
    }

    // Handle object format { monday: '9am-5pm', ... }
    if (typeof hours === 'object') {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const formatted = days
        .filter(day => hours[day])
        .map(day => `${day.charAt(0).toUpperCase() + day.slice(1)}: ${hours[day]}`)
        .join('\n  ');
      return formatted || undefined;
    }

    return undefined;
  }

  /**
   * Check whether the current time is outside the tenant's configured business hours.
   * Returns an out-of-hours response object if so, null otherwise.
   */
  private async checkOutsideBusinessHours(
    tenantId: string,
    state: BookingDialogState
  ): Promise<{ response: string; completed: boolean } | null> {
    try {
      const { data: tenant } = await this.supabase
        .from('tenants')
        .select('metadata, timezone')
        .eq('id', tenantId)
        .maybeSingle();

      if (!tenant) return null;

      const meta = (tenant.metadata ?? {}) as Record<string, unknown>;
      const businessHours = meta['business_hours'] as Record<string, { open: string | null; close: string | null; closed: boolean }> | undefined;
      const captureLeads = meta['capture_leads'] as boolean | undefined;

      if (!businessHours) return null;

      const tz = tenant.timezone ?? 'UTC';
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      const parts = formatter.formatToParts(now);
      const weekday = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) ?? '';
      const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
      const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
      const currentMinutes = hour * 60 + minute;

      const DAY_MAP: Record<string, string> = { sun: 'sun', mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat' };
      const dayKey = DAY_MAP[weekday] ?? weekday;
      const dayConfig = businessHours[dayKey];

      if (!dayConfig) return null;
      if (dayConfig.closed) {
        // Find next open day
        const nextOpen = this.findNextOpenDay(businessHours, dayKey);
        return this.buildOutOfHoursResponse(state, nextOpen, captureLeads ?? false);
      }

      if (!dayConfig.open || !dayConfig.close) return null;

      const [openH, openM] = dayConfig.open.split(':').map(Number);
      const [closeH, closeM] = dayConfig.close.split(':').map(Number);
      const openMinutes = openH * 60 + openM;
      const closeMinutes = closeH * 60 + closeM;

      if (currentMinutes < openMinutes || currentMinutes >= closeMinutes) {
        const nextOpen = currentMinutes >= closeMinutes
          ? this.findNextOpenDay(businessHours, dayKey)
          : { day: dayKey, time: dayConfig.open };
        return this.buildOutOfHoursResponse(state, nextOpen, captureLeads ?? false);
      }

      return null;
    } catch {
      return null;
    }
  }

  private findNextOpenDay(
    businessHours: Record<string, { open: string | null; close: string | null; closed: boolean }>,
    fromDay: string
  ): { day: string; time: string } | null {
    const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const idx = order.indexOf(fromDay);
    for (let i = 1; i <= 7; i++) {
      const candidate = order[(idx + i) % 7];
      const config = businessHours[candidate];
      if (config && !config.closed && config.open) {
        return { day: candidate, time: config.open };
      }
    }
    return null;
  }

  private buildOutOfHoursResponse(
    state: BookingDialogState,
    nextOpen: { day: string; time: string } | null,
    captureLeads: boolean
  ): { response: string; completed: boolean } {
    const DAY_LABELS: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
    const nextDesc = nextOpen ? `${DAY_LABELS[nextOpen.day] ?? nextOpen.day} at ${nextOpen.time}` : 'soon';
    const name = state.customerName ? ` ${state.customerName}` : '';
    const captureNote = captureLeads
      ? " Want to leave your details and tell me what you're looking for? Our team will get back to you first thing."
      : '';
    return {
      response: `Hi${name}! Thanks for reaching out — we're not available right now but we'll be back on ${nextDesc}.${captureNote}`,
      completed: captureLeads ? false : true,
    };
  }

  /**
   * Capture a lead row when a session ends without completing a booking.
   */
  private async captureLeadIfEnabled(
    tenantId: string,
    state: BookingDialogState,
    userPhone?: string
  ): Promise<void> {
    try {
      const { data: tenant } = await this.supabase
        .from('tenants')
        .select('metadata')
        .eq('id', tenantId)
        .maybeSingle();

      const meta = (tenant?.metadata ?? {}) as Record<string, unknown>;
      if (!meta['capture_leads']) return;

      const phone = userPhone ?? state.customerPhone;
      if (!phone) return;

      const followUpDelayHours = (meta['follow_up_delay_hours'] as number | undefined) ?? 24;
      const followUpAt = new Date(Date.now() + followUpDelayHours * 60 * 60 * 1000).toISOString();

      await this.supabase.from('leads').insert({
        tenant_id: tenantId,
        name: state.customerName ?? null,
        phone,
        email: state.customerEmail ?? null,
        source: 'whatsapp',
        intent: state.intent ?? 'inquiry',
        status: 'new',
        follow_up_at: followUpAt,
      });
    } catch (e) {
      defaultLogger.warn('[dialog] captureLeadIfEnabled failed', e);
    }
  }

  /**
   * Get products for a tenant
   */
  private async getProducts(tenantId: string, searchQuery?: string): Promise<Array<{
    id: string;
    name: string;
    description?: string;
    short_description?: string;
    price_cents?: number;
    currency?: string;
    category?: string;
    is_featured?: boolean;
    stock_quantity?: number;
    track_inventory?: boolean;
    images?: any[];
  }>> {
    try {
      let query = this.supabase
        .from('products')
        .select(`
          id,
          name,
          description,
          short_description,
          price_cents,
          currency,
          is_featured,
          stock_quantity,
          track_inventory,
          images,
          category
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('is_featured', { ascending: false })
        .order('name', { ascending: true })
        .limit(20);

      const { data, error } = await query;

      if (error) {
        defaultLogger.error('Error fetching products:', error);
        return [];
      }

      const products = (data as Array<{
        id: string;
        name: string;
        description?: string;
        short_description?: string;
        price_cents?: number;
        currency?: string;
        category?: string | null;
        is_featured?: boolean;
        stock_quantity?: number;
        track_inventory?: boolean;
        images?: unknown[];
      }> | undefined) || [];

      return products.map((p) => ({
        ...p,
        category: typeof p.category === 'string' ? p.category : undefined
      }));
    } catch (error) {
      defaultLogger.error('Error in getProducts:', error);
      return [];
    }
  }

  private normalizeBookingStep(step: string): BookingStep {
    switch (step) {
      case 'booking':
        return 'service';
      case 'status':
      case 'unknown':
        return 'intent';
      case 'service':
      case 'staff':
      case 'time':
      case 'contact':
      case 'confirm':
      case 'complete':
      case 'reschedule':
      case 'cancel':
      case 'inquiry':
      case 'business_info':
      case 'product_inquiry':
      case 'greeting':
      case 'service_selection':
      case 'date_time':
      case 'confirmation':
      case 'completed':
      case 'payment_pending':
        return step;
      default:
        return 'intent';
    }
  }
}

export const dialogBookingBridge = new DialogBookingBridge();
