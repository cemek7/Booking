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
import { AdvancedConversationAI } from '@/lib/ai/advancedConversationAI';
import { loadTenantDocuments, queryTenant } from '@/lib/retrieval';
import { SmartBookingRecommendations } from '@/lib/ai/smartBookingRecommendations';

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
  | 'email_collection'
  | 'confirm_booking'
  | 'payment'
  | 'completed'
  | 'error'
  | 'closed';

class WhatsAppMessageHandler {
  private supabase = createServerSupabaseClient();
  private evolutionClient = new EvolutionClient();
  private bookingEngine = new BookingEngine();
  private conversationAI = new AdvancedConversationAI();
  private smartRecs = new SmartBookingRecommendations();

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
      // Ensure tenant knowledge articles are loaded for RAG
      void loadTenantDocuments(tenantId, this.supabase);

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

      // Maintain advanced AI conversation context and check for escalation
      const aiContext = await this.conversationAI.maintainContext(tenantId, customerPhone, messageContent);
      const multiTurnResult = await this.conversationAI.manageMultiTurnDialog(tenantId, customerPhone, messageContent, aiContext);

      if (multiTurnResult.requires_human_escalation) {
        await this.triggerHumanEscalation(tenantId, customerPhone, sessionId, dialogState, 'AI escalation triggered');
        return '🙋 Let me connect you with a member of our team who can better assist you. Someone will respond shortly.';
      }

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

      // Update context, fetch staff options, and advance
      bookingContext.service_id = serviceId;
      bookingContext.service_name = serviceEntity.value;

      // Fetch staff with ratings for this service
      const staffOptions = await this.getStaffOptions(tenantId, serviceId);
      bookingContext.staff_options = staffOptions;
      await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);

      if (staffOptions.length === 0) {
        // No staff available — skip staff selection, go straight to date
        await dialogManagerWhatsApp.advanceStep(sessionId, 'date_selection');
        return await this.getDateSelectionMessage(tenantId, serviceId);
      }

      await dialogManagerWhatsApp.advanceStep(sessionId, 'staff_selection');
      return this.formatStaffSelectionMessage(staffOptions);
    }

    if (currentStep === 'staff_selection') {
      // Parse staff selection — accept number ("1", "2"), name match, or "any"
      const trimmed = messageContent.trim().toLowerCase();
      const staffList: Array<{ id: string; name: string; rating: number | null }> =
        bookingContext.staff_options || [];

      let selectedStaff: { id: string; name: string } | undefined;
      if (trimmed === 'any' || trimmed === 'anyone') {
        // Auto-assign — leave staff_id null (booking engine will pick)
        selectedStaff = undefined;
      } else {
        const numChoice = parseInt(messageContent.trim(), 10);
        if (!isNaN(numChoice) && numChoice >= 1 && numChoice <= staffList.length) {
          selectedStaff = staffList[numChoice - 1];
        } else if (staffList.length > 0) {
          selectedStaff = staffList.find(s => s.name.toLowerCase().includes(trimmed));
        }
      }

      if (selectedStaff === undefined && trimmed !== 'any' && trimmed !== 'anyone' && staffList.length > 0) {
        return this.formatStaffSelectionMessage(staffList);
      }

      bookingContext.staff_id = selectedStaff?.id ?? null;
      bookingContext.staff_name = selectedStaff?.name ?? 'Any available';
      await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);
      await dialogManagerWhatsApp.advanceStep(sessionId, 'date_selection');

      return await this.getDateSelectionMessage(tenantId, bookingContext.service_id);
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

      // Check if we already have the customer's email
      const { data: customerRow } = await this.supabase
        .from('customers')
        .select('email')
        .eq('id', customerId)
        .maybeSingle();

      if (customerRow?.email) {
        // Email already on file — skip collection step
        bookingContext.email = customerRow.email;
        await dialogManagerWhatsApp.updateBookingContext(sessionId, bookingContext);
        await dialogManagerWhatsApp.advanceStep(sessionId, 'confirm_booking');
        return await this.getConfirmationMessage(tenantId, bookingContext, flow.customerPhone);
      }

      // Ask for email before confirming
      await dialogManagerWhatsApp.advanceStep(sessionId, 'email_collection');
      return '📧 Please share your email address so we can send you a booking confirmation.';
    }

    if (currentStep === 'email_collection') {
      // Validate email format
      const emailMatch = messageContent.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
      if (!emailMatch) {
        return 'That doesn\'t look like a valid email address. Please send your email (e.g., name@example.com).';
      }

      const email = emailMatch[0].toLowerCase();
      bookingContext.email = email;

      // Persist email to customer record
      await this.supabase
        .from('customers')
        .update({ email })
        .eq('id', customerId);

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
   * Handle inquiry intent — uses RAG against tenant knowledge articles
   */
  private async handleInquiryIntent(
    flow: ConversationFlow,
    messageContent: string,
    intent: Intent
  ): Promise<string> {
    console.log('❓ Processing inquiry');

    const lower = messageContent.toLowerCase();

    // 1. RAG: search tenant knowledge articles first
    const ragDocs = queryTenant(flow.tenantId, messageContent, 2);
    if (ragDocs.length > 0 && ragDocs[0].text.length > 10) {
      // Return the best-matching article content (trim to first 300 chars for WhatsApp)
      const answer = ragDocs[0].text.length > 300
        ? ragDocs[0].text.slice(0, 300) + '…'
        : ragDocs[0].text;
      return `${answer}\n\nIs there anything else I can help you with?`;
    }

    // 2. Keyword-based fallback routing
    if (lower.includes('service')) {
      return await this.getServiceSelectionMessage(flow.tenantId);
    }

    if (lower.includes('hours') || lower.includes('open')) {
      return await this.getBusinessHoursMessage(flow.tenantId);
    }

    if (lower.includes('price') || lower.includes('cost')) {
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

  private async getStaffOptions(
    tenantId: string,
    serviceId: string,
  ): Promise<Array<{ id: string; name: string; rating: number | null }>> {
    try {
      const staffList = await (this.smartRecs as any).getStaffForService(tenantId, serviceId);
      if (!staffList || staffList.length === 0) return [];

      const enriched: Array<{ id: string; name: string; rating: number | null }> = await Promise.all(
        staffList.map(async (s: { id: string; name: string }) => {
          const { data: fb } = await this.supabase
            .from('customer_feedback')
            .select('score')
            .eq('tenant_id', tenantId)
            .eq('staff_user_id', s.id);
          const avg = fb && fb.length > 0
            ? fb.reduce((sum: number, f: { score: number }) => sum + f.score, 0) / fb.length
            : null;
          return { id: s.id, name: s.name, rating: avg };
        })
      );

      // Sort by rating descending (nulls last)
      enriched.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      return enriched;
    } catch {
      return [];
    }
  }

  private formatStaffSelectionMessage(
    staffOptions: Array<{ id: string; name: string; rating: number | null }>,
  ): string {
    if (staffOptions.length === 0) {
      return `Who would you like to see? Type the staff name or "any" for next available.`;
    }
    const lines = staffOptions.map((s, i) => {
      const stars = s.rating !== null ? ` ⭐ ${s.rating.toFixed(1)}` : '';
      return `${i + 1}. ${s.name}${stars}`;
    });
    return `Who would you like to see?\n\n${lines.join('\n')}\n\nReply with a number or name.`;
  }

  private async getDateSelectionMessage(tenantId: string, serviceId: string): Promise<string> {
    return `When would you like to book? You can say:\n📅 Tomorrow\n📅 Next Monday\n📅 2025-01-20\n\nOr type "available" to see open slots.`;
  }

  private async getTimeSelectionMessage(tenantId: string, serviceId: string, date: string): Promise<string> {
    try {
      // Parse the requested date — accept ISO dates or relative strings
      const requestedDate = new Date(date);
      const dayStart = isNaN(requestedDate.getTime())
        ? new Date(new Date().setHours(8, 0, 0, 0))
        : new Date(requestedDate.setHours(8, 0, 0, 0));
      const dayEnd = new Date(dayStart.getTime() + 12 * 3_600_000); // 8am – 8pm

      // 1. Try precomputed availability_slots first
      const { data: slots } = await this.supabase
        .from('availability_slots')
        .select('start_time, end_time')
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString())
        .eq('is_available', true)
        .order('start_time', { ascending: true })
        .limit(8);

      if (slots && slots.length > 0) {
        const slotList = slots
          .map((s: { start_time: string; end_time: string }, i: number) => {
            const t = new Date(s.start_time);
            return `${i + 1}. ${t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
          })
          .join('\n');
        return `Available times for ${dayStart.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}:\n\n${slotList}\n\nReply with a number or the time (e.g., "10:30 AM").`;
      }

      // 2. Fall back to checking reservations for free windows
      const { data: existingBookings } = await this.supabase
        .from('reservations')
        .select('start_at, end_at')
        .eq('tenant_id', tenantId)
        .gte('start_at', dayStart.toISOString())
        .lte('start_at', dayEnd.toISOString())
        .not('status', 'in', '("cancelled","no_show")');

      const booked = new Set<number>(
        (existingBookings ?? []).map((b: { start_at: string }) =>
          Math.floor(new Date(b.start_at).getTime() / (30 * 60_000))
        )
      );

      const freeSlots: string[] = [];
      for (let ts = dayStart.getTime(); ts < dayEnd.getTime() && freeSlots.length < 6; ts += 30 * 60_000) {
        const bucket = Math.floor(ts / (30 * 60_000));
        if (!booked.has(bucket)) {
          freeSlots.push(
            new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
          );
        }
      }

      if (freeSlots.length > 0) {
        const list = freeSlots.map((t, i) => `${i + 1}. ${t}`).join('\n');
        return `Available times for ${dayStart.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}:\n\n${list}\n\nReply with a number or the time (e.g., "10:30 AM").`;
      }
    } catch (err) {
      console.warn('[messageHandler] getTimeSelectionMessage error:', err);
    }

    // Final fallback if no availability data at all
    return `What time works best for you on ${date}?\n\n⏰ Morning (9 AM – 12 PM)\n⏰ Afternoon (12 PM – 5 PM)\n⏰ Evening (5 PM – 8 PM)\n\nOr type a specific time like "10:30 AM".`;
  }

  private async getConfirmationMessage(tenantId: string, context: Record<string, any>, phone: string): Promise<string> {
    const staffLine = context.staff_name ? `\n👤 Staff: ${context.staff_name}` : '';
    return `Great! Let me confirm your booking:\n\n📋 Service: ${context.service_name}${staffLine}\n📅 Date: ${context.date}\n⏰ Time: ${context.time}\n\nDoes this look correct? (yes/no)`;
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
      const { service_id, date, time, staff_id } = context;
      if (!service_id || !date || !time) {
        console.error('Missing booking context fields:', { service_id, date, time });
        return null;
      }

      // Normalise date/time into an ISO datetime
      const startTime = new Date(`${date}T${time}`);
      if (isNaN(startTime.getTime())) {
        console.error('Invalid date/time in booking context:', { date, time });
        return null;
      }

      // Look up service duration so we can compute end_at
      const { data: service } = await this.supabase
        .from('services')
        .select('duration')
        .eq('id', service_id)
        .maybeSingle();

      const durationMinutes: number = service?.duration ?? 60;
      const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

      const { data: booking, error } = await this.supabase
        .from('reservations')
        .insert({
          tenant_id: tenantId,
          customer_id: customerId,
          service_id,
          staff_user_id: staff_id ?? null,
          start_at: startTime.toISOString(),
          end_at: endTime.toISOString(),
          status: 'pending',
          source: 'whatsapp',
          metadata: {
            booking_source: 'whatsapp_chat',
            timestamp: new Date().toISOString(),
          },
        })
        .select('id')
        .single();

      if (error || !booking) {
        console.error('Error inserting booking:', error);
        return null;
      }

      return booking.id as string;
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
      if (!date && !time) return false;

      // Fetch current booking to derive existing date/time and service duration
      const { data: booking } = await this.supabase
        .from('reservations')
        .select('start_at, service_id')
        .eq('id', bookingId)
        .maybeSingle();

      if (!booking) return false;

      const existingStart = new Date(booking.start_at as string);
      const newDate = date ?? existingStart.toISOString().split('T')[0];
      const newTime = time ?? existingStart.toTimeString().substring(0, 5);

      const newStartAt = new Date(`${newDate}T${newTime}`);
      if (isNaN(newStartAt.getTime())) return false;

      const { data: service } = await this.supabase
        .from('services')
        .select('duration')
        .eq('id', booking.service_id)
        .maybeSingle();

      const durationMs = ((service?.duration as number) ?? 60) * 60_000;
      const newEndAt = new Date(newStartAt.getTime() + durationMs);

      const { error } = await this.supabase
        .from('reservations')
        .update({
          start_at: newStartAt.toISOString(),
          end_at: newEndAt.toISOString(),
          status: 'confirmed',
        })
        .eq('id', bookingId);

      return !error;
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

  /**
   * Insert an escalation_queue row so a human agent can pick up this chat.
   */
  private async triggerHumanEscalation(
    tenantId: string,
    customerPhone: string,
    sessionId: string,
    dialogState: Record<string, any>,
    reason: string
  ): Promise<void> {
    try {
      // Snapshot the recent conversation history if stored on dialogState
      const snapshot = Array.isArray(dialogState?.conversation_history)
        ? dialogState.conversation_history.slice(-20)
        : [];

      const { error } = await this.supabase
        .from('escalation_queue')
        .insert({
          tenant_id: tenantId,
          customer_phone: customerPhone,
          session_id: sessionId,
          reason,
          status: 'pending',
          conversation_snapshot: snapshot,
        });

      if (error) {
        console.error('[messageHandler] Failed to create escalation record:', error.message);
      } else {
        console.log(`[messageHandler] Escalation created for ${customerPhone} (tenant ${tenantId})`);
      }
    } catch (err) {
      console.error('[messageHandler] triggerHumanEscalation error:', err);
    }
  }
}

export const whatsappMessageHandler = new WhatsAppMessageHandler();
