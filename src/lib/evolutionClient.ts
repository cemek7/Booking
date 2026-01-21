import { getAppConfig } from './configManager';
import { createServerSupabaseClient } from '@/lib/supabase/server';

type SendResult = { success: boolean; response?: Record<string, unknown> | string | undefined };
type BookingContext = {
  bookingId: string;
  tenantId: string;
  customerId?: string;
  serviceType?: string;
  status: 'requested' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
};

interface EvolutionMessage {
  to: string;
  type: 'text' | 'interactive';
  text?: { body: string };
  interactive?: {
    type: 'button' | 'list';
    body?: { text: string };
    action: {
      buttons?: Array<{ id: string; title: string }>;
      sections?: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    };
  };
}

const EVOLUTION_BASE = process.env.EVOLUTION_API_BASE || 'https://api.evolution.example';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE_NAME || 'booka_instance';

export class EvolutionClient {
  private static instance: EvolutionClient;
  private apiKey: string;
  private baseUrl: string;
  private instanceName: string;

  constructor() {
    const config = getAppConfig();
    
    if (!config.integrations.evolution.enabled) {
      throw new Error('Evolution API integration is not enabled');
    }
    
    this.apiKey = config.integrations.evolution.apiKey || '';
    this.baseUrl = config.integrations.evolution.baseUrl || EVOLUTION_BASE;
    this.instanceName = config.integrations.evolution.instanceName || EVOLUTION_INSTANCE;
  }

  public static getInstance(): EvolutionClient {
    if (!EvolutionClient.instance) {
      EvolutionClient.instance = new EvolutionClient();
    }
    return EvolutionClient.instance;
  }

  /**
   * Send a basic text message
   */
  public async sendMessage(tenantId: string, toNumber: string, text: string): Promise<SendResult> {
    if (!this.apiKey) return { success: false, response: 'no_api_key' };
    
    const message: EvolutionMessage = {
      to: toNumber,
      type: 'text',
      text: { body: text }
    };
    
    return this.sendEvolutionMessage(message, tenantId);
  }

  /**
   * Send booking confirmation with interactive buttons
   */
  public async sendBookingConfirmation(tenantId: string, toNumber: string, bookingContext: BookingContext): Promise<SendResult> {
    const message: EvolutionMessage = {
      to: toNumber,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: `Your booking (ID: ${bookingContext.bookingId}) has been confirmed! Please choose an option:` },
        action: {
          buttons: [
            { id: 'view_booking', title: '📋 View Details' },
            { id: 'reschedule', title: '📅 Reschedule' },
            { id: 'cancel', title: '❌ Cancel' }
          ]
        }
      }
    };
    
    const result = await this.sendEvolutionMessage(message, tenantId);
    
    // Log the booking notification
    if (result.success) {
      await this.logBookingNotification(bookingContext, 'confirmation_sent', toNumber);
    }
    
    return result;
  }

  /**
   * Send booking reminder
   */
  public async sendBookingReminder(tenantId: string, toNumber: string, bookingContext: BookingContext, minutesBefore: number): Promise<SendResult> {
    const reminderText = `⏰ Reminder: You have a booking (ID: ${bookingContext.bookingId}) in ${minutesBefore} minutes. Please arrive on time!`;
    
    const result = await this.sendMessage(tenantId, toNumber, reminderText);
    
    if (result.success) {
      await this.logBookingNotification(bookingContext, 'reminder_sent', toNumber);
    }
    
    return result;
  }

  /**
   * Send booking status update
   */
  public async sendBookingStatusUpdate(tenantId: string, toNumber: string, bookingContext: BookingContext): Promise<SendResult> {
    const statusMessages = {
      requested: '📝 Your booking request has been received and is being processed.',
      confirmed: '✅ Your booking has been confirmed!',
      completed: '🎉 Your booking has been completed. Thank you!',
      cancelled: '❌ Your booking has been cancelled.',
      no_show: '😔 You missed your appointment. Please reschedule if needed.'
    };
    
    const statusText = statusMessages[bookingContext.status] || 'Your booking status has been updated.';
    const fullMessage = `${statusText}\n\nBooking ID: ${bookingContext.bookingId}`;
    
    const result = await this.sendMessage(tenantId, toNumber, fullMessage);
    
    if (result.success) {
      await this.logBookingNotification(bookingContext, 'status_update', toNumber);
    }
    
    return result;
  }

  /**
   * Create a new booking via WhatsApp conversation
   */
  public async initiateBookingFlow(tenantId: string, phoneNumber: string, customerName?: string): Promise<SendResult> {
    const message: EvolutionMessage = {
      to: phoneNumber,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: `Hello ${customerName || 'there'}! 👋 Welcome to our booking system. What would you like to do?` },
        action: {
          sections: [
            {
              title: 'Booking Options',
              rows: [
                { id: 'new_booking', title: '📅 New Booking', description: 'Schedule a new appointment' },
                { id: 'view_bookings', title: '👀 View Bookings', description: 'See your existing appointments' },
                { id: 'reschedule', title: '🔄 Reschedule', description: 'Change an existing booking' },
                { id: 'cancel_booking', title: '❌ Cancel', description: 'Cancel an appointment' }
              ]
            }
          ]
        }
      }
    };
    
    return this.sendEvolutionMessage(message, tenantId);
  }

  /**
   * Core method to send messages via Evolution API
   */
  private async sendEvolutionMessage(message: EvolutionMessage, tenantId: string): Promise<SendResult> {
    try {
      const url = `${this.baseUrl}/message/sendMessage/${this.instanceName}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey,
          'x-tenant-id': tenantId // Include tenant context
        },
        body: JSON.stringify(message)
      });
      
      const responseData = await response.json();
      
      return {
        success: response.ok,
        response: responseData
      };
    } catch (error) {
      console.error('Evolution API Error:', error);
      return {
        success: false,
        response: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Log booking notification for audit trail
   */
  private async logBookingNotification(bookingContext: BookingContext, type: string, phoneNumber: string): Promise<void> {
    try {
      const supabase = createServerSupabaseClient();
      
      await supabase.from('booking_notifications').insert({
        booking_id: bookingContext.bookingId,
        tenant_id: bookingContext.tenantId,
        customer_id: bookingContext.customerId,
        notification_type: type,
        channel: 'whatsapp',
        recipient: phoneNumber,
        status: 'sent',
        sent_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log booking notification:', error);
    }
  }

  /**
   * Get instance health status
   */
  public async getInstanceStatus(): Promise<{ connected: boolean; instanceName: string; error?: string }> {
    try {
      const url = `${this.baseUrl}/instance/connectionState/${this.instanceName}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'apikey': this.apiKey
        }
      });
      
      if (!response.ok) {
        return {
          connected: false,
          instanceName: this.instanceName,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      
      const data = await response.json();
      
      return {
        connected: data.state === 'open',
        instanceName: this.instanceName
      };
    } catch (error) {
      return {
        connected: false,
        instanceName: this.instanceName,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Legacy function for backward compatibility
export async function sendWhatsAppMessage(tenantId: string | null, toNumber: string, text: string): Promise<SendResult> {
  if (!tenantId) return { success: false, response: 'no_tenant_id' };
  
  try {
    const client = EvolutionClient.getInstance();
    return await client.sendMessage(tenantId, toNumber, text);
  } catch (error) {
    return {
      success: false,
      response: error instanceof Error ? error.message : 'Evolution client error'
    };
  }
}

const EvolutionClientLegacy = { sendWhatsAppMessage };
export default EvolutionClientLegacy;
