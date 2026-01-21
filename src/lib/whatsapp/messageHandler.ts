/**
 * WhatsApp Message Handler
 * Orchestrates the complete flow: message → intent → dialog → booking
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { detectIntent, Intent } from '@/lib/intentDetector';
import { dialogManagerWhatsApp } from './dialogManagerExtension';
import { EvolutionClient } from './evolutionClient';
import { BookingEngine } from '@/lib/booking/engine';
import { dialogBookingBridge } from '@/lib/dialogBookingBridge';

interface ConversationFlow {
  tenantId: string;
  sessionId: string;
  customerPhone: string;
  customerId: string;
  currentStep: string;
  bookingContext: Record<string, any>;
}

type DialogStep =
  | 'greeting'
  | 'service_selection'
  | 'staff_selection'
  | 'date_selection'
  | 'time_selection'
  | 'confirm_booking'
  | 'payment'
  | 'completed'
  | 'error'
  | 'closed';

class WhatsAppMessageHandler {
  private supabase = createServerSupabaseClient();
  private evolutionClient = new EvolutionClient();
  private bookingEngine = new BookingEngine();

  /**
   * Main entry point: handle incoming message
   */
  async handleMessage(
    tenantId: string,
    sessionId: string,
    customerPhone: string,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log(`\n🤖 Handling WhatsApp message for tenant ${tenantId}`);

    try {
      // Get or create customer
      const customer = await dialogManagerWhatsApp.getOrCreateCustomer(
        tenantId,
        customerPhone
      );

      // Get dialog state
      const dialogState = await dialogManagerWhatsApp.getDialogState(sessionId);
      if (!dialogState) {
        throw new Error('Dialog session not found');
      }

      const flow: ConversationFlow = {
        tenantId,
        sessionId,
        customerPhone,
        customerId: customer.id,
        currentStep: dialogState.current_step as DialogStep,
        bookingContext: dialogState.booking_context || {},
      };

      // Route based on intent
      let response: string;
      switch (intent.intent) {
        case 'booking':
          response = await this.handleBookingIntent(flow, messageContent, intent);
          break;
        case 'reschedule':
          response = await this.handleRescheduleIntent(flow, messageContent, intent);
          break;
        case 'cancel':
          response = await this.handleCancelIntent(flow, messageContent, intent);
          break;
        case 'inquiry':
          response = await this.handleInquiryIntent(flow, messageContent, intent);
          break;
        default:
          response = await this.handleUnknownIntent(flow, messageContent);
      }

      return response;
    } catch (error) {
      console.error('Error handling message:', error);
      return `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`;
    }
  }

  /**
   * Handle booking intent
   */
  private async handleBookingIntent(
    flow: ConversationFlow,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log('📋 Processing booking intent');

    const { tenantId, sessionId, customerId, currentStep, bookingContext } = flow;

    // Extract entities from intent
    const entities = intent.entities || [];

    // Route through conversation steps
    if (currentStep === 'greeting' || currentStep === undefined) {
      // Start booking flow
      await dialogManagerWhatsApp.advanceStep(sessionId, 'service_selection');
      return await this.getServiceSelectionMessage(tenantId);
    }

    if (currentStep === 'service_selection') {
      // Extract service from message or entities
      const serviceEntity = entities.find(e => e.type === 'service');
      if (!serviceEntity) {
        return 'Please tell me which service you are interested in. Type "services" to see all options.';
      }

      const serviceId = await this.findServiceId(tenantId, serviceEntity.value);
      if (!serviceId) {
        return `I couldn't find a service called "${serviceEntity.value}". Please choose from available services.`;
      }

      // Update context and advance
      bookingContext.service_id = serviceId;
      bookingContext.service_name = serviceEntity.value;
      await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);
      await dialogManagerWhatsApp.advanceStep(sessionId, 'date_selection');

      return await this.getDateSelectionMessage(tenantId, serviceId);
    }

    if (currentStep === 'date_selection') {
      // Parse date from message
      const dateEntity = entities.find(e => e.type === 'date');
      if (!dateEntity) {
        return 'Please tell me what date works for you (e.g., tomorrow, next Monday, 2025-01-15).';
      }

      bookingContext.date = dateEntity.value;
      await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);
      await dialogManagerWhatsApp.advanceStep(sessionId, 'time_selection');

      return await this.getTimeSelectionMessage(tenantId, bookingContext.service_id, dateEntity.value);
    }

    if (currentStep === 'time_selection') {
      // Parse time from message
      const timeEntity = entities.find(e => e.type === 'time');
      if (!timeEntity) {
        return 'Please tell me what time you prefer (e.g., 10:00 AM, 14:30, afternoon).';
      }

      bookingContext.time = timeEntity.value;
      await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);
      await dialogManagerWhatsApp.advanceStep(sessionId, 'confirm_booking');

      return await this.getConfirmationMessage(tenantId, bookingContext, flow.customerPhone);
    }

    if (currentStep === 'confirm_booking') {
      // Confirm or reject
      if (messageContent.toLowerCase().includes('yes') || messageContent.toLowerCase().includes('confirm')) {
        // Create booking
        const bookingId = await this.createBookingFromContext(
          tenantId,
          customerId,
          bookingContext
        );

        if (bookingId) {
          await dialogManagerWhatsApp.advanceStep(sessionId, 'completed');
          await dialogManagerWhatsApp.closeSession(sessionId, 'completed');
          return await this.getCompletionMessage(bookingId, bookingContext);
        } else {
          return 'Sorry, I could not complete your booking. Please try again.';
        }
      } else {
        // Cancel and restart
        await dialogManagerWhatsApp.advanceStep(sessionId, 'greeting');
        return 'No problem! Would you like to start over? Just say "book" whenever you\'re ready.';
      }
    }

    return 'I\'m not sure what to do next. Please say "book" to make a booking.';
  }

  /**
   * Handle reschedule intent
   */
  private async handleRescheduleIntent(
    flow: ConversationFlow,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log('🔄 Processing reschedule intent');

    const { tenantId, customerId } = flow;

    // Find customer's next booking
    const { data: booking, error } = await this.supabase
      .from('reservations')
      .select('id, start_at, service_id, staff_id')
      .eq('customer_id', customerId)
      .eq('status', 'confirmed')
      .gt('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return 'You don\'t have any upcoming bookings to reschedule. Would you like to make a new booking instead?';
    }

    // Extract new date/time from entities
    const dateEntity = intent.entities.find(e => e.type === 'date');
    const timeEntity = intent.entities.find(e => e.type === 'time');

    if (!dateEntity && !timeEntity) {
      return `Your next booking is on ${new Date(booking.start_at).toLocaleDateString()}. What date and time would you prefer?`;
    }

    // Reschedule booking
    const rescheduleSuccess = await this.rescheduleBooking(
      booking.id,
      dateEntity?.value,
      timeEntity?.value
    );

    if (rescheduleSuccess) {
      return `✅ Your booking has been rescheduled! You'll receive a confirmation message shortly.`;
    } else {
      return 'Sorry, I couldn\'t reschedule your booking. The requested time might not be available. Please try another time.';
    }
  }

  /**
   * Handle cancel intent
   */
  private async handleCancelIntent(
    flow: ConversationFlow,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log('❌ Processing cancel intent');

    const { customerId } = flow;

    // Find customer's next booking
    const { data: booking, error } = await this.supabase
      .from('reservations')
      .select('id, start_at')
      .eq('customer_id', customerId)
      .eq('status', 'confirmed')
      .gt('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return 'You don\'t have any bookings to cancel.';
    }

    // Confirm cancellation
    if (messageContent.toLowerCase().includes('yes') || messageContent.toLowerCase().includes('confirm')) {
      const cancelSuccess = await this.cancelBooking(booking.id);
      if (cancelSuccess) {
        return `✅ Your booking on ${new Date(booking.start_at).toLocaleDateString()} has been cancelled.`;
      }
    }

    return `Please confirm: Would you like to cancel your booking on ${new Date(booking.start_at).toLocaleDateString()}?`;
  }

  /**
   * Handle inquiry intent
   */
  private async handleInquiryIntent(
    flow: ConversationFlow,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log('❓ Processing inquiry');

    // Generic response for inquiries
    if (messageContent.toLowerCase().includes('service')) {
      return await this.getServiceSelectionMessage(flow.tenantId);
    }

    if (messageContent.toLowerCase().includes('hours') || messageContent.toLowerCase().includes('open')) {
      return await this.getBusinessHoursMessage(flow.tenantId);
    }

    if (messageContent.toLowerCase().includes('price') || messageContent.toLowerCase().includes('cost')) {
      return await this.getPricingMessage(flow.tenantId);
    }

    return 'How can I help you? I can help you:\n\n1️⃣ Make a booking\n2️⃣ Reschedule an appointment\n3️⃣ Cancel a booking\n4️⃣ Check business hours';
  }

  /**
   * Handle unknown intent
   */
  private async handleUnknownIntent(
    flow: ConversationFlow,
    messageContent: string
  ): Promise<string> {
    console.log('❓ Unknown intent');

    const commands = messageContent.toLowerCase();

    if (commands.includes('book') || commands.includes('appointment') || commands.includes('booking')) {
      return await this.handleBookingIntent(flow, messageContent, { intent: 'booking', confidence: 0.8, entities: [], fallbackUsed: false });
    }

    if (commands.includes('cancel') || commands.includes('remove')) {
      return await this.handleCancelIntent(flow, messageContent, { intent: 'cancel', confidence: 0.8, entities: [], fallbackUsed: false });
    }

    if (commands.includes('reschedule') || commands.includes('change') || commands.includes('move')) {
      return await this.handleRescheduleIntent(flow, messageContent, { intent: 'reschedule', confidence: 0.8, entities: [], fallbackUsed: false });
    }

    return 'I didn\'t quite understand that. Try typing:\n\n📅 "book" - to make an appointment\n🔄 "reschedule" - to change a booking\n❌ "cancel" - to cancel a booking';
  }

  // Helper methods for messages and lookups

  private async getServiceSelectionMessage(tenantId: string): Promise<string> {
    const { data: services } = await this.supabase
      .from('services')
      .select('id, name, duration')
      .eq('tenant_id', tenantId)
      .limit(5);

    if (!services || services.length === 0) {
      return 'We don\'t have any services available right now. Please contact us directly.';
    }

    const serviceList = services
      .map((s, i) => `${i + 1}. ${s.name} (${s.duration} mins)`)
      .join('\n');

    return `Which service would you like to book?\n\n${serviceList}`;
  }

  private async getDateSelectionMessage(tenantId: string, serviceId: string): Promise<string> {
    return `When would you like to book? You can say:\n📅 Tomorrow\n📅 Next Monday\n📅 2025-01-20\n\nOr type "available" to see open slots.`;
  }

  private async getTimeSelectionMessage(tenantId: string, serviceId: string, date: string): Promise<string> {
    return `What time works best for you?\n\n⏰ Morning (9 AM - 12 PM)\n⏰ Afternoon (12 PM - 5 PM)\n⏰ Evening (5 PM - 9 PM)\n\nOr specify a time like "10:30 AM"`;
  }

  private async getConfirmationMessage(tenantId: string, context: Record<string, any>, phone: string): Promise<string> {
    return `Great! Let me confirm your booking:\n\n📋 Service: ${context.service_name}\n📅 Date: ${context.date}\n⏰ Time: ${context.time}\n\nDoes this look correct? (yes/no)`;
  }

  private async getCompletionMessage(bookingId: string, context: Record<string, any>): Promise<string> {
    return `✅ Perfect! Your booking is confirmed!\n\n📋 Booking ID: ${bookingId}\n📅 ${context.date}\n⏰ ${context.time}\n\nYou'll receive a reminder 24 hours before your appointment.`;
  }

  private async getBusinessHoursMessage(tenantId: string): Promise<string> {
    return `We're open:\n\n📅 Monday - Friday: 9 AM - 6 PM\n📅 Saturday: 10 AM - 4 PM\n📅 Sunday: Closed`;
  }

  private async getPricingMessage(tenantId: string): Promise<string> {
    return `Pricing varies by service. Once you select a service, I'll show you the exact price.`;
  }

  private async findServiceId(tenantId: string, serviceName: string): Promise<string | null> {
    const { data: service } = await this.supabase
      .from('services')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', `%${serviceName}%`)
      .limit(1)
      .maybeSingle();

    return service?.id || null;
  }

  private async createBookingFromContext(
    tenantId: string,
    customerId: string,
    context: Record<string, any>
  ): Promise<string | null> {
    try {
      // TODO: Implement booking creation from context
      // This should call the booking engine with the extracted details
      return 'booking-id-' + Date.now();
    } catch (error) {
      console.error('Error creating booking:', error);
      return null;
    }
  }

  private async rescheduleBooking(
    bookingId: string,
    date?: string,
    time?: string
  ): Promise<boolean> {
    try {
      // TODO: Implement reschedule logic
      return true;
    } catch (error) {
      console.error('Error rescheduling booking:', error);
      return false;
    }
  }

  private async cancelBooking(bookingId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('reservations')
        .update({ status: 'cancelled' })
        .eq('id', bookingId);

      return !error;
    } catch (error) {
      console.error('Error cancelling booking:', error);
      return false;
    }
  }
}

export const whatsappMessageHandler = new WhatsAppMessageHandler();
