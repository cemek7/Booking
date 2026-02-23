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

    const lower = messageContent.toLowerCase();

    // Handle service inquiries
    if (lower.includes('service')) {
      return await this.getServiceSelectionMessage(flow.tenantId);
    }

    // Handle business hours
    if (lower.includes('hours') || lower.includes('open')) {
      return await this.getBusinessHoursMessage(flow.tenantId);
    }

    // Handle pricing
    if (lower.includes('price') || lower.includes('cost')) {
      return await this.getPricingMessage(flow.tenantId);
    }

    // Handle availability checking
    if (lower.includes('available') || lower.includes('availability') || lower.includes('open slot')) {
      return await this.handleAvailabilityCheck(flow, intent);
    }

    // Handle staff inquiries
    if (lower.includes('staff') || lower.includes('who') || lower.includes('therapist') || lower.includes('stylist')) {
      return await this.getStaffListMessage(flow.tenantId);
    }

    return 'How can I help you? I can help you:\n\n1️⃣ Make a booking\n2️⃣ Reschedule an appointment\n3️⃣ Cancel a booking\n4️⃣ Check availability\n5️⃣ View business hours';
  }

  /**
   * Handle availability checking
   */
  private async handleAvailabilityCheck(
    flow: ConversationFlow,
    intent: Intent
  ): Promise<string> {
    try {
      // Extract date and service from entities
      const dateEntity = intent.entities.find(e => e.type === 'date');
      const serviceEntity = intent.entities.find(e => e.type === 'service');

      if (!dateEntity) {
        return 'Which date would you like to check? (e.g., tomorrow, next Monday, 2025-01-20)';
      }

      const date = this.parseDateToISO(dateEntity.value);

      // If no service specified, show general availability
      if (!serviceEntity) {
        // Get all services to check general availability
        const { data: services } = await this.supabase
          .from('services')
          .select('id, name, duration')
          .eq('tenant_id', flow.tenantId)
          .limit(3);

        if (!services || services.length === 0) {
          return 'No services available. Please contact us directly.';
        }

        // Check availability for first service as example
        const publicBookingService = await import('@/lib/publicBookingService');
        const slots = await publicBookingService.default.getAvailability(
          flow.tenantId,
          services[0].id,
          date
        );

        const availableSlots = slots.filter(s => s.available).slice(0, 5);

        if (availableSlots.length === 0) {
          return `❌ Sorry, we're fully booked on ${date}. Would you like to check another date?`;
        }

        const slotList = availableSlots.map(s => `⏰ ${s.time}`).join('\n');
        return `✅ Available times on ${date}:\n\n${slotList}\n\nWould you like to book one of these?`;
      }

      // Service specified, check specific availability
      const serviceId = await this.findServiceId(flow.tenantId, serviceEntity.value);
      
      if (!serviceId) {
        return `I couldn't find a service called "${serviceEntity.value}". Please check the spelling or type "services" to see all options.`;
      }

      const publicBookingService = await import('@/lib/publicBookingService');
      const slots = await publicBookingService.default.getAvailability(
        flow.tenantId,
        serviceId,
        date
      );

      const availableSlots = slots.filter(s => s.available).slice(0, 6);

      if (availableSlots.length === 0) {
        return `❌ Sorry, no availability for ${serviceEntity.value} on ${date}. Try another date?`;
      }

      const slotList = availableSlots.map(s => `⏰ ${s.time}`).join('\n');
      return `✅ Available times for ${serviceEntity.value} on ${date}:\n\n${slotList}\n\nReply with a time to book!`;
    } catch (error) {
      console.error('Error checking availability:', error);
      return 'Sorry, I had trouble checking availability. Please try again.';
    }
  }

  /**
   * Get staff list message
   */
  private async getStaffListMessage(tenantId: string): Promise<string> {
    try {
      const { data: staff } = await this.supabase
        .from('users')
        .select('id, full_name, metadata')
        .eq('tenant_id', tenantId)
        .in('role', ['staff', 'manager'])
        .limit(5);

      if (!staff || staff.length === 0) {
        return 'Our team is ready to serve you! Please book an appointment to meet them.';
      }

      const staffList = staff
        .map((s, i) => `${i + 1}. ${s.full_name}`)
        .join('\n');

      return `Our team:\n\n${staffList}\n\nYou can request a specific team member when booking!`;
    } catch (error) {
      console.error('Error getting staff list:', error);
      return 'Our team is ready to serve you! Please book an appointment to meet them.';
    }
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
      // Extract and validate booking details from conversation context
      const { service_id, service_name, date, time, staff_id, notes } = context;

      if (!service_id) {
        console.error('Missing service_id in booking context');
        return null;
      }

      if (!date || !time) {
        console.error('Missing date or time in booking context');
        return null;
      }

      // Parse date and time to ISO format
      let bookingDate: string;
      let bookingTime: string;

      // Handle various date formats (tomorrow, next Monday, 2025-01-15, etc.)
      bookingDate = this.parseDateToISO(date);
      
      // Handle various time formats (10:00 AM, 14:30, afternoon, etc.)
      bookingTime = this.parseTimeToFormat(time);

      // Get customer details for booking
      const { data: customer } = await this.supabase
        .from('customers')
        .select('name, email, phone')
        .eq('id', customerId)
        .single();

      if (!customer) {
        console.error('Customer not found:', customerId);
        return null;
      }

      // Use publicBookingService to create the booking
      const publicBookingService = await import('@/lib/publicBookingService');
      
      const booking = await publicBookingService.default.createPublicBooking(
        tenantId,
        {
          service_id: service_id,
          staff_id: staff_id || undefined,
          date: bookingDate,
          time: bookingTime,
          customer_name: customer.name || 'WhatsApp Customer',
          customer_email: customer.email || `${customer.phone}@whatsapp.booking`,
          customer_phone: customer.phone,
          notes: notes || 'Booked via WhatsApp',
        }
      );

      console.log('✅ Booking created successfully:', booking.id);
      return booking.id;
    } catch (error) {
      console.error('Error creating booking:', error);
      return null;
    }
  }

  /**
   * Parse natural language date to ISO format (YYYY-MM-DD)
   */
  private parseDateToISO(dateStr: string): string {
    const lower = dateStr.toLowerCase().trim();
    const now = new Date();

    // Handle "today"
    if (lower.includes('today')) {
      return now.toISOString().split('T')[0];
    }

    // Handle "tomorrow"
    if (lower.includes('tomorrow')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    }

    // Handle "next monday", "next tuesday", etc.
    const dayMatch = lower.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dayMatch) {
      const targetDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(dayMatch[1]);
      const currentDay = now.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      return targetDate.toISOString().split('T')[0];
    }

    // Handle ISO format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }

    // Handle MM/DD/YYYY or DD/MM/YYYY
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) {
      const parts = dateStr.split('/');
      // Assume MM/DD/YYYY format
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}-${day}`;
    }

    // Default: return current date
    console.warn('Could not parse date, using today:', dateStr);
    return now.toISOString().split('T')[0];
  }

  /**
   * Parse natural language time to HH:MM format
   */
  private parseTimeToFormat(timeStr: string): string {
    const lower = timeStr.toLowerCase().trim();

    // Handle "morning" (default to 9:00)
    if (lower.includes('morning')) {
      return '09:00';
    }

    // Handle "afternoon" (default to 14:00)
    if (lower.includes('afternoon')) {
      return '14:00';
    }

    // Handle "evening" (default to 18:00)
    if (lower.includes('evening')) {
      return '18:00';
    }

    // Handle "noon"
    if (lower.includes('noon')) {
      return '12:00';
    }

    // Handle "10:00 AM", "2:30 PM", etc.
    const time12Match = lower.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/);
    if (time12Match) {
      let hours = parseInt(time12Match[1]);
      const minutes = time12Match[2] || '00';
      const meridiem = time12Match[3];

      if (meridiem === 'pm' && hours !== 12) {
        hours += 12;
      } else if (meridiem === 'am' && hours === 12) {
        hours = 0;
      }

      return `${hours.toString().padStart(2, '0')}:${minutes}`;
    }

    // Handle 24-hour format "14:30", "9:00"
    const time24Match = lower.match(/(\d{1,2}):(\d{2})/);
    if (time24Match) {
      const hours = time24Match[1].padStart(2, '0');
      const minutes = time24Match[2];
      return `${hours}:${minutes}`;
    }

    // Handle just hour "10", "14"
    const hourMatch = lower.match(/^(\d{1,2})$/);
    if (hourMatch) {
      const hours = hourMatch[1].padStart(2, '0');
      return `${hours}:00`;
    }

    // Default: return 10:00 AM
    console.warn('Could not parse time, using 10:00:', timeStr);
    return '10:00';
  }

  private async rescheduleBooking(
    bookingId: string,
    date?: string,
    time?: string
  ): Promise<boolean> {
    try {
      if (!date && !time) {
        console.error('No date or time provided for rescheduling');
        return false;
      }

      // Get existing booking details
      const { data: existing, error: fetchErr } = await this.supabase
        .from('reservations')
        .select('start_at, end_at, service_id, staff_id, tenant_id')
        .eq('id', bookingId)
        .single();

      if (fetchErr || !existing) {
        console.error('Failed to fetch existing booking:', fetchErr);
        return false;
      }

      // Calculate new start and end times
      let newStartTime: Date;
      let newEndTime: Date;

      if (date && time) {
        // Both date and time provided
        const bookingDate = this.parseDateToISO(date);
        const bookingTime = this.parseTimeToFormat(time);
        newStartTime = new Date(`${bookingDate}T${bookingTime}`);
      } else if (date) {
        // Only date provided, keep same time
        const oldStartTime = new Date(existing.start_at);
        const bookingDate = this.parseDateToISO(date);
        newStartTime = new Date(`${bookingDate}T${oldStartTime.toTimeString().substring(0, 5)}`);
      } else {
        // Only time provided, keep same date
        const oldStartTime = new Date(existing.start_at);
        const bookingTime = this.parseTimeToFormat(time!);
        const bookingDate = oldStartTime.toISOString().split('T')[0];
        newStartTime = new Date(`${bookingDate}T${bookingTime}`);
      }

      // Calculate duration and new end time
      const duration = new Date(existing.end_at).getTime() - new Date(existing.start_at).getTime();
      newEndTime = new Date(newStartTime.getTime() + duration);

      // Check for conflicts using the same logic as booking creation
      const { data: conflicts, error: conflictErr } = await this.supabase
        .from('reservations')
        .select('id')
        .eq('tenant_id', existing.tenant_id)
        .neq('id', bookingId) // Exclude current booking
        .in('status', ['confirmed', 'pending'])
        .lte('start_at', newEndTime.toISOString())
        .gte('end_at', newStartTime.toISOString());

      if (conflictErr) {
        console.error('Error checking conflicts:', conflictErr);
        return false;
      }

      // If staff-specific booking, check staff conflicts only
      if (existing.staff_id && conflicts && conflicts.length > 0) {
        const staffConflicts = await this.supabase
          .from('reservations')
          .select('id')
          .eq('staff_id', existing.staff_id)
          .in('id', conflicts.map(c => c.id));

        if (staffConflicts.data && staffConflicts.data.length > 0) {
          console.log('Staff has conflict at requested time');
          return false;
        }
      } else if (conflicts && conflicts.length > 0) {
        console.log('Time slot conflict detected');
        return false;
      }

      // Update the booking
      const { error: updateErr } = await this.supabase
        .from('reservations')
        .update({
          start_at: newStartTime.toISOString(),
          end_at: newEndTime.toISOString(),
          metadata: {
            ...existing.metadata,
            rescheduled: true,
            rescheduled_at: new Date().toISOString(),
            previous_start: existing.start_at,
          },
        })
        .eq('id', bookingId);

      if (updateErr) {
        console.error('Error updating booking:', updateErr);
        return false;
      }

      console.log('✅ Booking rescheduled successfully:', bookingId);
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
