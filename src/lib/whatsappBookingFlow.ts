/**
 * @deprecated This simple booking flow is deprecated.
 * Use the sophisticated flow instead:
 *   messageProcessor -> dialogBookingBridge -> BookingEngine
 *
 * The sophisticated flow provides:
 * - LLM-powered intent detection
 * - Better conversation handling with slot-filling FSM
 * - Proper booking engine integration with validation
 * - Owner notifications
 *
 * This file will be removed in a future version.
 * See: src/lib/whatsapp/messageProcessor.ts
 * See: src/lib/dialogBookingBridge.ts
 */

import { EvolutionClient } from './evolutionClient';
import { getSupabaseRouteHandlerClient } from '@/lib/supabase/server';
import dialogManager from './dialogManager';
import { BookingStep } from '../types/shared';

export interface BookingFlowState {
  sessionId: string;
  tenantId: string;
  customerPhone: string;
  customerName?: string;
  step: BookingStep;
  serviceType?: string;
  selectedDate?: string;
  selectedTime?: string;
  bookingId?: string;
}

// Fix type issues for bookingResult
interface BookingResult {
  success: boolean;
  bookingId?: string;
  tenantName?: string;
  tenantEmail?: string;
  error?: string;
}

// Define a return type interface for processMessage
interface ProcessMessageResult {
  success: boolean;
  response?: string;
  error?: string;
  state?: string; // Added state property
  reply?: string; // Added reply property
  context?: Record<string, unknown>; // Added context property
}

export class WhatsAppBookingFlow {
  private evolutionClient: EvolutionClient;
  private supabase: ReturnType<typeof getSupabaseRouteHandlerClient>;

  constructor() {
    this.evolutionClient = EvolutionClient.getInstance();
    this.supabase = getSupabaseRouteHandlerClient();
  }

  /**
   * Process incoming message and advance booking flow
   */
  public async processMessage(
    tenantId: string,
    customerPhone: string,
    message: string,
    customerName?: string
  ): Promise<ProcessMessageResult> {
    try {
      // Find or create session
      let session = await this.findSessionByPhone(customerPhone);
      
      if (!session) {
        // Create new session
        const sessionId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const initialState: BookingFlowState = {
          sessionId,
          tenantId,
          customerPhone,
          customerName,
          step: 'greeting'
        };
        
        await dialogManager.startSession(tenantId, customerPhone);
        await dialogManager.updateSlot(sessionId, 'booking_state', initialState);
        session = { id: sessionId, state: initialState };
      }

      const currentState = session.state as BookingFlowState;

      // Route to appropriate handler based on current step
      switch (currentState.step) {
        case 'greeting':
          return await this.handleGreeting(session.id, currentState, message);
        case 'service_selection':
          return await this.handleServiceSelection(session.id, currentState, message);
        case 'date_time':
          return await this.handleDateTimeSelection(session.id, currentState, message);
        case 'confirmation':
          return await this.handleConfirmation(session.id, currentState, message);
        default:
          return { success: false, error: 'Invalid booking flow state' };
      }
    } catch (error) {
      console.error('Error processing booking flow message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle initial greeting and menu display
   */
  private async handleGreeting(
    sessionId: string,
    state: BookingFlowState,
    message: string
  ): Promise<{ success: boolean; response?: string }> {
    
    const msg = message.toLowerCase().trim();
    
    if (msg.includes('book') || msg.includes('appointment') || msg.includes('schedule')) {
      const newState: BookingFlowState = {
        ...state,
        step: 'service_selection'
      };
      
      await dialogManager.updateSlot(sessionId, 'booking_state', newState);
      
      // Get available services for tenant
      const services = await this.getAvailableServices(state.tenantId);
      
      let responseText = 'Great! What service would you like to book?\n\n';
      services.forEach((service, index) => {
        responseText += `${index + 1}. ${service.name}${service.duration ? ` (${service.duration} min)` : ''}${service.price ? ` - $${service.price}` : ''}\n`;
      });
      responseText += '\nPlease reply with the number or name of the service.';
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Service selection initiated' };
    }
    
    return {
      success: true,
      response: 'Please select an option from the menu to continue.'
    };
  }

  /**
   * Handle service selection
   */
  private async handleServiceSelection(
    sessionId: string,
    state: BookingFlowState,
    message: string
  ): Promise<{ success: boolean; response?: string }> {
    
    const services = await this.getAvailableServices(state.tenantId);
    let selectedService = null;
    
    // Try to match by number
    const serviceIndex = parseInt(message.trim()) - 1;
    if (serviceIndex >= 0 && serviceIndex < services.length) {
      selectedService = services[serviceIndex];
    } else {
      // Try to match by name
      selectedService = services.find(s => 
        s.name.toLowerCase().includes(message.toLowerCase()) ||
        message.toLowerCase().includes(s.name.toLowerCase())
      );
    }
    
    if (selectedService) {
      const newState: BookingFlowState = {
        ...state,
        step: 'date_time',
        serviceType: selectedService.name
      };
      
      await dialogManager.updateSlot(sessionId, 'booking_state', newState);
      
      const responseText = `Perfect! You've selected: ${selectedService.name}\n\nWhen would you like to schedule this appointment?\n\nPlease provide your preferred date and time (e.g., "Tomorrow at 2 PM" or "Next Monday 10 AM")`;
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Service selected, proceeding to date/time' };
    } else {
      const responseText = 'I didn\'t recognize that service. Please reply with the number or exact name of the service you\'d like to book.';
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Invalid service, asking for clarification' };
    }
  }

  /**
   * Handle date and time selection
   */
  private async handleDateTimeSelection(
    sessionId: string,
    state: BookingFlowState,
    message: string
  ): Promise<{ success: boolean; response?: string }> {
    
    // Simple date/time parsing (in production, use a proper date parsing library)
    const parsedDateTime = this.parseDateTime(message);
    
    if (parsedDateTime.isValid) {
      const newState: BookingFlowState = {
        ...state,
        step: 'confirmation',
        selectedDate: parsedDateTime.date,
        selectedTime: parsedDateTime.time
      };
      
      await dialogManager.updateSlot(sessionId, 'booking_state', newState);
      
      const confirmationText = `Great! Let me confirm your booking details:\n\n` +
        `📋 Service: ${state.serviceType}\n` +
        `📅 Date: ${parsedDateTime.date}\n` +
        `🕐 Time: ${parsedDateTime.time}\n\n` +
        `Please reply with "CONFIRM" to book this appointment or "CHANGE" to modify the details.`;
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, confirmationText);
      
      return { success: true, response: 'Date/time set, awaiting confirmation' };
    } else {
      const responseText = 'I couldn\'t understand the date and time. Please try again with a format like:\n\n• "Tomorrow at 2 PM"\n• "Next Monday 10 AM"\n• "December 25 at 3:30 PM"';
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Invalid date/time format, asking for retry' };
    }
  }

  /**
   * Handle final confirmation
   */
  private async handleConfirmation(
    sessionId: string,
    state: BookingFlowState,
    message: string
  ): Promise<{ success: boolean; response?: string }> {
    
    const confirmation = message.toLowerCase().trim();
    
    if (confirmation.includes('confirm') || confirmation.includes('yes') || confirmation.includes('book')) {
      // Create the actual booking
      const bookingResult: BookingResult = await this.createBooking(state);
      
      if (!bookingResult.bookingId) {
        return { success: false, response: undefined, error: 'Failed to create booking' } as ProcessMessageResult;
      }

      return {
        success: true,
        response: `Booking confirmed for ${bookingResult.tenantName || 'Business'}`,
      };
    } else if (confirmation.includes('change') || confirmation.includes('modify')) {
      // Go back to date/time selection
      const newState: BookingFlowState = {
        ...state,
        step: 'date_time'
      };
      
      await dialogManager.updateSlot(sessionId, 'booking_state', newState);
      
      const responseText = 'No problem! When would you like to schedule this appointment?\n\nPlease provide your preferred date and time.';
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Returning to date/time selection' };
    } else {
      const responseText = 'Please reply with "CONFIRM" to book this appointment or "CHANGE" to modify the details.';
      
      await this.evolutionClient.sendMessage(state.tenantId, state.customerPhone, responseText);
      
      return { success: true, response: 'Awaiting valid confirmation response' };
    }
  }

  /**
   * Create actual booking in database
   */
  private async createBooking(state: BookingFlowState): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    try {
      const bookingData = {
        tenant_id: state.tenantId,
        customer_phone: state.customerPhone,
        customer_name: state.customerName || 'WhatsApp Customer',
        service_type: state.serviceType,
        booking_date: state.selectedDate,
        booking_time: state.selectedTime,
        status: 'confirmed',
        source: 'whatsapp',
        created_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('bookings')
        .insert([bookingData])
        .select('id')
        .single();

      if (error) {
        console.error('Database error creating booking:', error);
        return { success: false, error: error.message };
      }

      // Notify owner of new booking (auto-confirmed but owner should know)
      await this.notifyOwnerOfNewBooking({
        ...bookingData,
        id: data.id
      });

      return { success: true, bookingId: data.id };
    } catch (error) {
      console.error('Error creating booking:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Notify tenant owner of a new booking via WhatsApp
   */
  private async notifyOwnerOfNewBooking(booking: {
    id: string;
    tenant_id: string;
    customer_name: string;
    customer_phone: string;
    service_type?: string;
    booking_date?: string;
    booking_time?: string;
  }): Promise<void> {
    try {
      // Get tenant info and owner's phone number
      const { data: tenant } = await this.supabase
        .from('tenants')
        .select('name, settings')
        .eq('id', booking.tenant_id)
        .single();

      // Get owner from tenant_users
      const { data: ownerData } = await this.supabase
        .from('tenant_users')
        .select(`
          user_id,
          users!inner(phone, email)
        `)
        .eq('tenant_id', booking.tenant_id)
        .eq('role', 'owner')
        .single();

      const ownerPhone = (ownerData?.users as { phone?: string })?.phone;

      if (!ownerPhone) {
        console.log('No owner phone found for tenant:', booking.tenant_id);
        return;
      }

      const bookingRef = booking.id.slice(-6).toUpperCase();
      const message =
        `📅 *New Booking Confirmed*\n\n` +
        `A customer has just booked via WhatsApp:\n\n` +
        `👤 Customer: ${booking.customer_name}\n` +
        `📱 Phone: ${booking.customer_phone}\n` +
        `✂️ Service: ${booking.service_type || 'Not specified'}\n` +
        `📆 Date: ${booking.booking_date || 'Not specified'}\n` +
        `🕐 Time: ${booking.booking_time || 'Not specified'}\n\n` +
        `Ref: #${bookingRef}\n\n` +
        `_This booking was auto-confirmed. View details in your dashboard._`;

      await this.evolutionClient.sendMessage(
        booking.tenant_id,
        ownerPhone,
        message
      );

      console.log('Owner notified of new booking:', bookingRef);
    } catch (error) {
      // Don't fail the booking if notification fails
      console.error('Failed to notify owner of booking:', error);
    }
  }

  /**
   * Get available services for a tenant
   */
  private async getAvailableServices(tenantId: string): Promise<Array<{ name: string; duration?: number; price?: number }>> {
    try {
      const { data, error } = await this.supabase
        .from('services')
        .select('name, duration, price')
        .eq('tenant_id', tenantId)
        .eq('active', true);
      
      if (error) {
        console.error('Error fetching services:', error);
        return [
          { name: 'General Consultation', duration: 30 },
          { name: 'Standard Service', duration: 60 }
        ];
      }
      
      return data || [];
    } catch (error) {
      console.error('Error fetching services:', error);
      return [
        { name: 'General Consultation', duration: 30 },
        { name: 'Standard Service', duration: 60 }
      ];
    }
  }

  /**
   * Find existing session by phone number
   */
  private async findSessionByPhone(phoneNumber: string): Promise<{ id: string; state: BookingFlowState } | null> {
    // This would need to be implemented in dialogManager
    // For now, return null to force new session creation
    return null;
  }

  /**
   * Simple date/time parser (replace with proper library in production)
   */
  private parseDateTime(message: string): { isValid: boolean; date?: string; time?: string } {
    const msg = message.toLowerCase();
    
    // Very basic parsing - in production use a proper date parsing library
    if (msg.includes('tomorrow')) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return {
        isValid: true,
        date: tomorrow.toDateString(),
        time: this.extractTime(message) || '10:00 AM'
      };
    }
    
    if (msg.includes('today')) {
      return {
        isValid: true,
        date: new Date().toDateString(),
        time: this.extractTime(message) || '2:00 PM'
      };
    }
    
    // Default fallback
    return {
      isValid: true,
      date: new Date().toDateString(),
      time: this.extractTime(message) || '10:00 AM'
    };
  }

  /**
   * Extract time from message
   */
  private extractTime(message: string): string | null {
    const timeRegex = /(\d{1,2}):?(\d{2})?\s*(am|pm|AM|PM)?|(\d{1,2})\s*(am|pm|AM|PM)/;
    const match = message.match(timeRegex);
    
    if (match) {
      return match[0];
    }
    
    return null;
  }
}

export const whatsAppBookingFlow = new WhatsAppBookingFlow();