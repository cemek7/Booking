/**
 * WhatsApp Booking Integration Test
 * 
 * Tests the complete WhatsApp booking flow from message receipt
 * to booking creation and confirmation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { whatsAppBookingFlow } from '@/lib/whatsappBookingFlow';
import { EvolutionClient } from '../src/lib/evolutionClient';
import dialogManager from '@/lib/dialogManager';
import { sendBookingConfirmation } from '../src/lib/whatsapp/templateManager';

// Mock data
const MOCK_PHONE = '+1234567890';
const MOCK_TENANT_ID = '12345678-1234-5678-9012-123456789012';

describe('WhatsApp Booking Integration', () => {
  let supabase: ReturnType<typeof createServerSupabaseClient>;
  let testSessionId: string;

  beforeAll(async () => {
    supabase = createServerSupabaseClient();
    
    // Ensure test tenant exists
    const { error: tenantError } = await supabase
      .from('tenants')
      .upsert([{
        id: MOCK_TENANT_ID,
        name: 'Test Tenant',
        subdomain: 'test-tenant',
        settings: {}
      }]);
    
    if (tenantError) {
      console.warn('Tenant setup error (may already exist):', tenantError);
    }
    
    // Ensure test services exist
    const { error: serviceError } = await supabase
      .from('services')
      .upsert([
        {
          id: '11111111-1111-1111-1111-111111111111',
          tenant_id: MOCK_TENANT_ID,
          name: 'Haircut',
          description: 'Professional haircut service',
          duration_minutes: 60,
          price: 50.00,
          is_active: true
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          tenant_id: MOCK_TENANT_ID,
          name: 'Massage',
          description: 'Relaxing massage therapy',
          duration_minutes: 90,
          price: 80.00,
          is_active: true
        }
      ]);
    
    if (serviceError) {
      console.warn('Service setup error (may already exist):', serviceError);
    }
  });

  beforeEach(async () => {
    // Clean up any existing test sessions
    if (testSessionId) {
      await dialogManager.endSession(testSessionId);
    }
    
    // Start fresh session
    const session = await dialogManager.startSession(MOCK_TENANT_ID, null);
    testSessionId = session.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testSessionId) {
      await dialogManager.endSession(testSessionId);
    }
  });

  describe('Booking Flow States', () => {
    it('should start with greeting state', async () => {
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      
      expect(response.state).toBe('greeting');
      expect(response.reply).toContain('Welcome');
      expect(response.context).toBeDefined();
    });

    it('should transition to service selection', async () => {
      // Start conversation
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      
      // Trigger service selection
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      
      expect(response.state).toBe('service_selection');
      expect(response.reply).toContain('services');
      expect(response.reply).toContain('Haircut');
      expect(response.reply).toContain('Massage');
    });

    it('should handle service selection', async () => {
      // Setup conversation state
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      
      // Select service
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '1');
      
      expect(response.state).toBe('date_time');
      expect(response.reply).toContain('date and time');
      expect(response.context?.selectedService).toBeDefined();
    });

    it('should parse date and time input', async () => {
      // Setup conversation state
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '1');
      
      // Provide date/time
      const response = await whatsAppBookingFlow.processMessage(
        MOCK_TENANT_ID, 
        MOCK_PHONE, 
        'Tomorrow at 2 PM'
      );
      
      expect(response.state).toBe('confirmation');
      expect(response.reply).toContain('confirm');
      expect(response.context?.selectedDateTime).toBeDefined();
    });

    it('should complete booking flow', async () => {
      // Complete full flow
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '1');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Tomorrow at 2 PM');
      
      // Confirm booking
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'yes');
      
      expect(response.state).toBe('completed');
      expect(response.reply).toContain('confirmed');
      expect(response.context?.bookingId).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid service selection', async () => {
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '999');
      
      expect(response.state).toBe('service_selection');
      expect(response.reply).toContain('valid option');
    });

    it('should handle invalid date input', async () => {
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '1');
      
      const response = await whatsAppBookingFlow.processMessage(
        MOCK_TENANT_ID, 
        MOCK_PHONE, 
        'invalid date'
      );
      
      expect(response.state).toBe('date_time');
      expect(response.reply).toContain('valid date');
    });

    it('should allow flow restart', async () => {
      // Start a flow
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      
      // Restart
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'start over');
      
      expect(response.state).toBe('greeting');
      expect(response.reply).toContain('Welcome');
    });
  });

  describe('Integration with Dialog Manager', () => {
    it('should persist booking state in dialog session', async () => {
      const response = await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      
      // Find session by phone number (simplified for test)
      const state = await dialogManager.getBookingState(testSessionId);
      const context = await dialogManager.getBookingContext(testSessionId);
      
      expect(state).toBe('greeting');
      expect(context).toBeDefined();
    });

    it('should maintain context across messages', async () => {
      // First message
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'Hello');
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, 'I want to book');
      
      // Check context persistence
      const context1 = await dialogManager.getBookingContext(testSessionId);
      
      // Second message
      await whatsAppBookingFlow.processMessage(MOCK_TENANT_ID, MOCK_PHONE, '1');
      
      // Check context updates
      const context2 = await dialogManager.getBookingContext(testSessionId);
      
      expect(context1?.phone).toBe(MOCK_PHONE);
      expect(context2?.selectedService).toBeDefined();
      expect(context2?.phone).toBe(context1?.phone);
    });
  });

  describe('Evolution Client Integration', () => {
    it('should send booking confirmation via Evolution', async () => {
      const mockBookingId = '33333333-3333-3333-3333-333333333333';
      
      // Create test booking
      const { data: booking } = await supabase
        .from('bookings')
        .insert([{
          id: mockBookingId,
          tenant_id: MOCK_TENANT_ID,
          service_id: '11111111-1111-1111-1111-111111111111',
          customer_name: 'Test Customer',
          customer_phone: MOCK_PHONE,
          start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          status: 'confirmed'
        }])
        .select()
        .single();
      
      expect(booking).toBeDefined();
      
      // Test Evolution client booking confirmation
      const result = await sendBookingConfirmation(
        MOCK_TENANT_ID,
        MOCK_PHONE,
        booking!
      );
      
      expect(result.success).toBe(true);
      
      // Cleanup
      await supabase.from('bookings').delete().eq('id', mockBookingId);
    });

    it('should initiate booking flow via Evolution', async () => {
      const evolutionClient = new EvolutionClient();
      
      const result = await evolutionClient.initiateBookingFlow(
        MOCK_TENANT_ID,
        MOCK_PHONE,
        'Would you like to schedule an appointment?'
      );
      
      expect(result.success).toBe(true);
    });
  });

  describe('Booking Notifications Integration', () => {
    it('should create notification records', async () => {
      const mockBookingId = '44444444-4444-4444-4444-444444444444';
      
      // Create test booking
      const { data: booking } = await supabase
        .from('bookings')
        .insert([{
          id: mockBookingId,
          tenant_id: MOCK_TENANT_ID,
          service_id: '11111111-1111-1111-1111-111111111111',
          customer_name: 'Test Customer',
          customer_phone: MOCK_PHONE,
          start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          end_time: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
          status: 'confirmed'
        }])
        .select()
        .single();
      
      expect(booking).toBeDefined();
      
      // Test notification creation
      const { data: notification } = await supabase
        .from('booking_notifications')
        .insert([{
          booking_id: mockBookingId,
          tenant_id: MOCK_TENANT_ID,
          type: 'confirmation',
          channel: 'whatsapp',
          recipient_phone: MOCK_PHONE,
          message_content: 'Your booking has been confirmed!',
          status: 'sent'
        }])
        .select()
        .single();
      
      expect(notification).toBeDefined();
      expect(notification!.booking_id).toBe(mockBookingId);
      
      // Cleanup
      await supabase.from('booking_notifications').delete().eq('booking_id', mockBookingId);
      await supabase.from('bookings').delete().eq('id', mockBookingId);
    });
  });
});