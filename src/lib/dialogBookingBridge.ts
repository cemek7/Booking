import { createServerSupabaseClient } from '@/lib/supabase/server';
import { BookingEngine } from './booking/engine';
import { detectIntent, type Intent, type ContextualHints } from './intentDetector';
import * as dialogManager from './dialogManager';
import { observability } from './observability/observability';
import { EvolutionClient } from './evolutionClient';
import { z } from 'zod';
import { BookingStep } from '../types/shared';

// Dialog state for booking flow
export interface BookingDialogState {
  step: BookingStep;
  intent?: 'booking' | 'reschedule' | 'cancel' | 'inquiry' | 'business_info' | 'product_inquiry';
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
  tentantId?: string;
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
  private bookingEngine: BookingEngine;
  private supabase: any;
  private isInitialized = false;

  constructor() {
    this.supabase = createServerSupabaseClient();
    this.bookingEngine = new BookingEngine();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    
    await this.bookingEngine.initialize();
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

      const state = this.parseDialogState(session.slots);
      
      // Detect intent if not already determined
      if (!state.step || state.step === 'intent') {
        const context: ContextualHints = {
          conversationTurn: 1,
          tenantVertical: await this.getTenantVertical(tenantId),
          timeOfDay: this.getTimeOfDay()
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
        state.intent = intent.intent as any;
        state.step = intent.intent === 'booking' ? 'service' : intent.intent;
        
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
        
        await this.updateSessionState(sessionId, state);
      }

      // Process based on current step
      switch (state.step) {
        case 'booking':
          return await this.handleBookingFlow(tenantId, sessionId, state, message);
        case 'reschedule':
          return await this.handleRescheduleFlow(tenantId, sessionId, state, message);
        case 'cancel':
          return await this.handleCancelFlow(tenantId, sessionId, state, message);
        case 'service':
          return await this.handleServiceSelection(tenantId, sessionId, state, message);
        case 'staff':
          return await this.handleStaffSelection(tenantId, sessionId, state, message);
        case 'time':
          return await this.handleTimeSelection(tenantId, sessionId, state, message);
        case 'contact':
          return await this.handleContactInfo(tenantId, sessionId, state, message, userPhone);
        case 'confirm':
          return await this.handleConfirmation(tenantId, sessionId, state, message);
        case 'business_info':
          return await this.handleBusinessInfoInquiry(tenantId, sessionId, state, message);
        case 'product_inquiry':
          return await this.handleProductInquiry(tenantId, sessionId, state, message);
        case 'inquiry':
          return await this.handleGeneralInquiry(tenantId, sessionId, state, message);
        default:
          return {
            response: 'I\'m having trouble understanding where we are in the booking process. Let\'s start over. What would you like to do?',
            completed: false,
            nextStep: 'intent'
          };
      }
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', `Dialog processing error: ${error}`);
      return {
        response: 'I\'m sorry, I\'m having technical difficulties. Please try again or contact support.',
        completed: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      observability.endTrace(traceContext);
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
      await this.updateSessionState(sessionId, state);
      
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
      await this.updateSessionState(sessionId, state);
      
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
      await this.updateSessionState(sessionId, state);
      
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
    const timeInfo = this.extractTimeFromMessage(message);
    
    if (timeInfo.startTime) {
      // Validate availability
      const isAvailable = await this.checkAvailability(
        tenantId,
        timeInfo.startTime,
        state.serviceId!,
        state.staffId
      );
      
      if (isAvailable) {
        state.startTime = timeInfo.startTime;
        state.endTime = timeInfo.endTime;
        state.step = 'contact';
        await this.updateSessionState(sessionId, state);
        
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
        
        return {
          response: `I'm sorry, ${timeInfo.formatted} isn't available. How about: ${alternatives.join(', ')}?`,
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
      await this.updateSessionState(sessionId, state);

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
      await this.updateSessionState(sessionId, state);

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
   * Attempt to create the booking
   */
  private async attemptBooking(
    tenantId: string,
    sessionId: string,
    state: BookingDialogState
  ) {
    try {
      const bookingData = {
        customer_name: state.customerName || 'Walk-in Customer',
        customer_email: state.customerEmail || `${state.customerPhone}@temp.booking`,
        customer_phone: state.customerPhone!,
        service_id: state.serviceId!,
        provider_id: state.staffId || await this.autoAssignStaff(tenantId, state.serviceId!, state.startTime!),
        start_time: state.startTime!,
        end_time: state.endTime || this.calculateEndTime(state.startTime!, state.serviceId!),
        notes: state.notes,
        metadata: {
          source: 'whatsapp_conversation',
          session_id: sessionId
        }
      };
      
      const result = await this.bookingEngine.createBooking(tenantId, bookingData);

      if (result.booking) {
        state.step = 'complete';
        await this.updateSessionState(sessionId, state);

        // Notify owner of new booking (async, don't block response)
        this.notifyOwnerOfNewBooking(tenantId, {
          bookingId: result.booking.id,
          customerName: state.customerName || 'WhatsApp Customer',
          customerPhone: state.customerPhone!,
          serviceName: state.serviceName,
          startTime: state.startTime,
          staffName: state.staffName
        }).catch(err => console.error('Failed to notify owner:', err));

        return {
          response: `✅ Your appointment has been booked successfully!\n\nBooking ID: ${result.booking.id}\n\nYou'll receive a confirmation message shortly. Thank you!`,
          completed: true
        };
      } else {
        return {
          response: 'I\'m sorry, there was a problem creating your booking. Please try again or call us directly.',
          completed: false,
          error: 'Booking creation failed'
        };
      }
    } catch (error) {
      return {
        response: 'I\'m sorry, I couldn\'t complete your booking due to a technical issue. Please try again.',
        completed: false,
        error: error instanceof Error ? error.message : 'Booking failed'
      };
    }
  }

  // Helper methods
  private parseDialogState(slots: Record<string, unknown>): BookingDialogState {
    return {
      step: (slots.step as string) || 'intent',
      intent: slots.intent as any,
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
      errors: (slots.errors as string[]) || [],
      retryCount: (slots.retryCount as number) || 0
    };
  }

  private async updateSessionState(sessionId: string, state: BookingDialogState): Promise<void> {
    await dialogManager.updateSlot(sessionId, 'step', state.step);
    await dialogManager.updateSlot(sessionId, 'intent', state.intent);
    await dialogManager.updateSlot(sessionId, 'serviceId', state.serviceId);
    await dialogManager.updateSlot(sessionId, 'serviceName', state.serviceName);
    await dialogManager.updateSlot(sessionId, 'staffId', state.staffId);
    await dialogManager.updateSlot(sessionId, 'staffName', state.staffName);
    await dialogManager.updateSlot(sessionId, 'startTime', state.startTime);
    await dialogManager.updateSlot(sessionId, 'endTime', state.endTime);
    await dialogManager.updateSlot(sessionId, 'customerName', state.customerName);
    await dialogManager.updateSlot(sessionId, 'customerPhone', state.customerPhone);
    await dialogManager.updateSlot(sessionId, 'customerEmail', state.customerEmail);
    await dialogManager.updateSlot(sessionId, 'notes', state.notes);
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
    // Simple time parsing - in production, use a proper date parsing library
    const now = new Date();
    // This is a placeholder - implement proper time parsing
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(); // Tomorrow
  }

  private extractTimeFromMessage(message: string): {
    startTime?: string;
    endTime?: string;
    formatted?: string;
  } {
    // Placeholder for time extraction logic
    // In production, implement proper date/time parsing
    return {};
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
    const low = message.toLowerCase();
    return services.find(s => low.includes(s.name.toLowerCase())) || null;
  }

  private async getAvailableStaff(tenantId: string): Promise<Array<{ id: string; name: string }>> {
    const { data } = await this.supabase
      .from('tenant_users')
      .select('user_id, users(full_name)')
      .eq('tenant_id', tenantId)
      .eq('role', 'staff');
    return data?.map(u => ({ id: u.user_id, name: u.users?.full_name || 'Staff Member' })) || [];
  }

  private matchStaff(message: string, staff: Array<{ id: string; name: string }>): { id: string; name: string } | null {
    const low = message.toLowerCase();
    return staff.find(s => low.includes(s.name.toLowerCase().split(' ')[0])) || null;
  }

  private async checkAvailability(tenantId: string, startTime: string, serviceId: string, staffId?: string): Promise<boolean> {
    // Use existing booking engine availability check
    // Placeholder implementation
    return true;
  }

  private async suggestAlternativeTimes(tenantId: string, requestedTime: string, serviceId: string, staffId?: string): Promise<string[]> {
    // Get alternative time suggestions from booking engine
    return ['Tomorrow at 2pm', 'Friday at 10am', 'Monday at 3pm'];
  }

  private async autoAssignStaff(tenantId: string, serviceId: string, startTime: string): Promise<string> {
    const staff = await this.getAvailableStaff(tenantId);
    return staff[0]?.id || '';
  }

  private calculateEndTime(startTime: string, serviceId: string): string {
    // Default 1 hour appointment
    const start = new Date(startTime);
    return new Date(start.getTime() + 60 * 60 * 1000).toISOString();
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
    // Implement reschedule logic
    return {
      response: 'Reschedule functionality is coming soon. Please call us to reschedule your appointment.',
      completed: true
    };
  }

  private async handleCancelFlow(tenantId: string, sessionId: string, state: BookingDialogState, message: string) {
    // Implement cancellation logic
    return {
      response: 'I understand you\'d like to cancel. Please call us directly to cancel your appointment.',
      completed: true
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
        console.log('No owner phone found for tenant:', tenantId);
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

      const evolutionClient = EvolutionClient.getInstance();
      await evolutionClient.sendMessage(tenantId, ownerPhone, message);

      console.log('Owner notified of new booking:', bookingRef);
    } catch (error) {
      // Don't fail the booking if notification fails
      console.error('Failed to notify owner of booking:', error);
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
      console.error('Error handling business info inquiry:', error);
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
      await this.updateSessionState(sessionId, state);

      return {
        response: responseLines.join('\n'),
        completed: false,
        nextStep: 'intent'
      };
    } catch (error) {
      console.error('Error handling product inquiry:', error);
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
      console.error('Error handling general inquiry:', error);
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
      console.error('Error fetching tenant info:', error);
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
          product_categories(name)
        `)
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('is_featured', { ascending: false })
        .order('name', { ascending: true })
        .limit(20);

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching products:', error);
        return [];
      }

      return (data || []).map(p => ({
        ...p,
        category: p.product_categories?.name
      }));
    } catch (error) {
      console.error('Error in getProducts:', error);
      return [];
    }
  }
}

export const dialogBookingBridge = new DialogBookingBridge();