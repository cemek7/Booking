import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { EventBusService } from '../eventbus/eventBus';
import { observability } from '../observability/observability';
import { WebhookSecurityService } from '../webhooks/security';
import crypto from 'crypto';

// Types and schemas for WhatsApp Business API integration
const MessageTemplateSchema = z.object({
  name: z.string(),
  language: z.string(),
  components: z.array(z.object({
    type: z.enum(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']),
    parameters: z.array(z.object({
      type: z.enum(['TEXT', 'CURRENCY', 'DATE_TIME', 'IMAGE', 'DOCUMENT']),
      text: z.string().optional(),
      currency: z.object({
        fallback_value: z.string(),
        code: z.string(),
        amount_1000: z.number()
      }).optional(),
      date_time: z.object({
        fallback_value: z.string(),
        day_of_week: z.number().optional(),
        year: z.number().optional(),
        month: z.number().optional(),
        day_of_month: z.number().optional(),
        hour: z.number().optional(),
        minute: z.number().optional()
      }).optional(),
      image: z.object({
        link: z.string()
      }).optional()
    })).optional()
  }))
});

const ConversationStateSchema = z.object({
  customer_phone: z.string(),
  tenant_id: z.string(),
  current_flow: z.enum(['booking_creation', 'booking_modification', 'booking_cancellation', 'support', 'general']),
  flow_step: z.string(),
  context: z.record(z.any()),
  last_interaction: z.string().datetime(),
  session_timeout: z.string().datetime()
});

const IncomingMessageSchema = z.object({
  from: z.string(),
  to: z.string(),
  message_id: z.string(),
  timestamp: z.string(),
  type: z.enum(['text', 'image', 'document', 'audio', 'video', 'location', 'contacts']),
  text: z.object({
    body: z.string()
  }).optional(),
  image: z.object({
    id: z.string(),
    mime_type: z.string(),
    sha256: z.string(),
    caption: z.string().optional()
  }).optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional()
  }).optional(),
  context: z.object({
    forwarded: z.boolean().optional(),
    frequently_forwarded: z.boolean().optional(),
    from: z.string().optional(),
    id: z.string().optional(),
    referred_product: z.object({
      catalog_id: z.string(),
      product_retailer_id: z.string()
    }).optional()
  }).optional()
});

interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  webhookSecret: string;
  apiVersion: string;
  baseUrl: string;
}

interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: any[];
}

interface ConversationFlow {
  id: string;
  name: string;
  trigger_keywords: string[];
  steps: ConversationStep[];
  timeout_minutes: number;
}

interface ConversationStep {
  id: string;
  name: string;
  message_template?: string;
  custom_message?: string;
  expected_input: 'text' | 'number' | 'date' | 'choice' | 'location' | 'contact';
  validation_rules?: any;
  next_step_conditions?: Array<{
    condition: string;
    next_step_id: string;
  }>;
  actions?: Array<{
    type: string;
    parameters: any;
  }>;
}

interface CustomerSession {
  phone: string;
  tenant_id: string;
  current_flow: string;
  current_step: string;
  context: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
}

/**
 * WhatsApp Business API integration for automated booking flows
 * Handles conversation management, message templates, and chatbot flows
 */
export class DialogIntegrationService {
  private supabase: any;
  private eventBus: EventBusService;
  private webhookSecurity: WebhookSecurityService;
  private config: WhatsAppConfig;
  private isInitialized = false;

  // Conversation flows
  private conversationFlows: Map<string, ConversationFlow> = new Map();
  private activeSessions: Map<string, CustomerSession> = new Map();
  private messageTemplates: Map<string, MessageTemplate> = new Map();

  // Performance metrics
  private metrics = {
    messagesReceived: 0,
    messagesSent: 0,
    conversationsStarted: 0,
    conversationsCompleted: 0,
    bookingsCreatedViaChat: 0,
    errorCount: 0
  };

  constructor() {
    this.supabase = createServerSupabaseClient();
    this.eventBus = new EventBusService();
    this.webhookSecurity = new WebhookSecurityService();

    // Initialize WhatsApp configuration
    this.config = {
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
      webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET!,
      apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
      baseUrl: process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com'
    };
  }

  /**
   * Initialize the dialog integration service
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;

      await this.eventBus.initialize();
      await this.webhookSecurity.initialize();

      // Load conversation flows from database
      await this.loadConversationFlows();

      // Load message templates
      await this.loadMessageTemplates();

      // Set up session cleanup
      this.startSessionCleanup();

      this.isInitialized = true;
      console.log('DialogIntegrationService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize DialogIntegrationService:', error);
      throw error;
    }
  }

  /**
   * Handle incoming WhatsApp webhook
   */
  async handleWebhook(payload: any, signature: string): Promise<void> {
    const traceContext = observability.startTrace('whatsapp.webhook');
    
    try {
      observability.setTraceTag(traceContext, 'webhook_type', 'whatsapp');

      // Verify webhook signature
      const isValid = await this.webhookSecurity.validateSignature(
        'whatsapp',
        JSON.stringify(payload),
        signature,
        this.config.webhookSecret
      );

      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }

      // Handle verification challenge (for webhook setup)
      if (payload['hub.mode'] === 'subscribe' && payload['hub.verify_token'] === this.config.webhookSecret) {
        observability.addTraceLog(traceContext, 'info', 'Webhook verification challenge received');
        return;
      }

      // Process webhook entries
      if (payload.entry) {
        for (const entry of payload.entry) {
          await this.processWebhookEntry(entry, traceContext);
        }
      }

      this.metrics.messagesReceived++;
      observability.recordBusinessMetric('whatsapp_webhook_processed_total', 1);

      observability.finishTrace(traceContext, 'success');
    } catch (error) {
      this.metrics.errorCount++;
      observability.addTraceLog(traceContext, 'error', 'Webhook processing failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Process a webhook entry (contains message/status updates)
   */
  private async processWebhookEntry(entry: any, traceContext: any): Promise<void> {
    try {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.field === 'messages') {
            await this.processMessagesChange(change.value, traceContext);
          }
        }
      }
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Entry processing failed', {
        entry_id: entry.id,
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Process messages change event
   */
  private async processMessagesChange(value: any, traceContext: any): Promise<void> {
    try {
      // Process incoming messages
      if (value.messages) {
        for (const message of value.messages) {
          await this.handleIncomingMessage(message, traceContext);
        }
      }

      // Process message status updates
      if (value.statuses) {
        for (const status of value.statuses) {
          await this.handleMessageStatus(status, traceContext);
        }
      }
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Messages change processing failed', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Handle incoming message from customer
   */
  private async handleIncomingMessage(message: any, traceContext: any): Promise<void> {
    try {
      const validatedMessage = IncomingMessageSchema.parse(message);
      const customerPhone = validatedMessage.from;
      
      observability.setTraceTag(traceContext, 'customer_phone', customerPhone);
      observability.setTraceTag(traceContext, 'message_type', validatedMessage.type);

      // Get or create customer session
      let session = await this.getCustomerSession(customerPhone);
      if (!session) {
        session = await this.createCustomerSession(customerPhone, validatedMessage);
      } else {
        // Update session activity
        session.updated_at = new Date();
        await this.updateCustomerSession(session);
      }

      // Process message based on current conversation flow
      if (session.current_flow && session.current_step) {
        await this.processFlowMessage(session, validatedMessage, traceContext);
      } else {
        await this.processInitialMessage(session, validatedMessage, traceContext);
      }

      // Log message to database
      await this.logMessage(validatedMessage, session.tenant_id, 'incoming');

      observability.addTraceLog(traceContext, 'info', 'Incoming message processed successfully');
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Incoming message processing failed', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Process message within an existing conversation flow
   */
  private async processFlowMessage(
    session: CustomerSession,
    message: z.infer<typeof IncomingMessageSchema>,
    traceContext: any
  ): Promise<void> {
    try {
      const flow = this.conversationFlows.get(session.current_flow);
      if (!flow) {
        throw new Error(`Flow not found: ${session.current_flow}`);
      }

      const currentStep = flow.steps.find(step => step.id === session.current_step);
      if (!currentStep) {
        throw new Error(`Step not found: ${session.current_step}`);
      }

      // Validate input based on expected type
      const validationResult = await this.validateInput(message, currentStep);
      if (!validationResult.isValid) {
        await this.sendValidationErrorMessage(session, validationResult.error);
        return;
      }

      // Store validated input in session context
      session.context[currentStep.id] = validationResult.value;

      // Execute step actions
      if (currentStep.actions) {
        for (const action of currentStep.actions) {
          await this.executeStepAction(session, action, traceContext);
        }
      }

      // Determine next step
      const nextStepId = await this.determineNextStep(session, currentStep, validationResult.value);
      
      if (nextStepId) {
        session.current_step = nextStepId;
        await this.updateCustomerSession(session);
        
        // Send message for next step
        const nextStep = flow.steps.find(step => step.id === nextStepId);
        if (nextStep) {
          await this.sendStepMessage(session, nextStep, traceContext);
        }
      } else {
        // Flow completed
        await this.completeConversationFlow(session, traceContext);
      }

    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Flow message processing failed', {
        flow: session.current_flow,
        step: session.current_step,
        error_message: error.message
      });
      
      // Send error message to customer
      await this.sendErrorMessage(session, 'Sorry, something went wrong. Please try again or contact support.');
      throw error;
    }
  }

  /**
   * Process initial message to determine conversation flow
   */
  private async processInitialMessage(
    session: CustomerSession,
    message: z.infer<typeof IncomingMessageSchema>,
    traceContext: any
  ): Promise<void> {
    try {
      const messageText = message.text?.body?.toLowerCase() || '';
      
      // Find matching conversation flow based on keywords
      let matchedFlow: ConversationFlow | null = null;
      
      for (const flow of this.conversationFlows.values()) {
        if (flow.trigger_keywords.some(keyword => messageText.includes(keyword.toLowerCase()))) {
          matchedFlow = flow;
          break;
        }
      }

      if (!matchedFlow) {
        // No specific flow matched, use general support flow
        matchedFlow = this.conversationFlows.get('general_support') || null;
      }

      if (matchedFlow) {
        // Start conversation flow
        session.current_flow = matchedFlow.id;
        session.current_step = matchedFlow.steps[0]?.id;
        session.expires_at = new Date(Date.now() + matchedFlow.timeout_minutes * 60000);
        
        await this.updateCustomerSession(session);

        // Send welcome message for the flow
        const firstStep = matchedFlow.steps[0];
        if (firstStep) {
          await this.sendStepMessage(session, firstStep, traceContext);
        }

        this.metrics.conversationsStarted++;
        observability.recordBusinessMetric('whatsapp_conversation_started_total', 1, {
          flow: matchedFlow.id
        });
      } else {
        // Send default welcome message
        await this.sendMessage(session.phone, {
          type: 'text',
          text: {
            body: 'Hello! Welcome to our booking system. How can I help you today?\n\n' +
                  'You can:\n' +
                  '📅 Book an appointment\n' +
                  '✏️ Modify a booking\n' +
                  '❌ Cancel a booking\n' +
                  '🆘 Get support\n\n' +
                  'Just type what you need!'
          }
        });
      }

    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Initial message processing failed', {
        error_message: error.message
      });
      throw error;
    }
  }

  /**
   * Send a WhatsApp message
   */
  private async sendMessage(to: string, messageData: any): Promise<string> {
    try {
      const url = `${this.config.baseUrl}/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
      
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        ...messageData
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`WhatsApp API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      this.metrics.messagesSent++;

      return result.messages[0].id;
    } catch (error) {
      this.metrics.errorCount++;
      console.error('Failed to send WhatsApp message:', error);
      throw error;
    }
  }

  /**
   * Send message using template
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string,
    parameters: any[] = []
  ): Promise<string> {
    try {
      const messageData = {
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: languageCode
          },
          components: parameters.length > 0 ? [{
            type: 'body',
            parameters: parameters
          }] : []
        }
      };

      return await this.sendMessage(to, messageData);
    } catch (error) {
      console.error('Failed to send template message:', error);
      throw error;
    }
  }

  /**
   * Send booking confirmation via WhatsApp
   */
  async sendBookingConfirmation(
    customerPhone: string,
    bookingData: any,
    tenantId: string
  ): Promise<void> {
    try {
      const traceContext = observability.startTrace('whatsapp.send_booking_confirmation');
      
      observability.setTraceTag(traceContext, 'customer_phone', customerPhone);
      observability.setTraceTag(traceContext, 'booking_id', bookingData.id);

      // Send confirmation message
      const confirmationMessage = this.formatBookingConfirmation(bookingData);
      await this.sendMessage(customerPhone, {
        type: 'text',
        text: {
          body: confirmationMessage
        }
      });

      // Schedule reminder
      await this.scheduleBookingReminder(customerPhone, bookingData, tenantId);

      observability.recordBusinessMetric('whatsapp_booking_confirmation_sent_total', 1);
      observability.finishTrace(traceContext, 'success');
    } catch (error) {
      console.error('Failed to send booking confirmation:', error);
      throw error;
    }
  }

  /**
   * Send booking reminder
   */
  async sendBookingReminder(
    customerPhone: string,
    bookingData: any,
    reminderType: 'day_before' | 'hour_before'
  ): Promise<void> {
    try {
      const reminderMessage = this.formatBookingReminder(bookingData, reminderType);
      await this.sendMessage(customerPhone, {
        type: 'text',
        text: {
          body: reminderMessage
        }
      });

      observability.recordBusinessMetric('whatsapp_reminder_sent_total', 1, {
        reminder_type: reminderType
      });
    } catch (error) {
      console.error('Failed to send booking reminder:', error);
      throw error;
    }
  }

  /**
   * Get conversation metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      if (this.eventBus) {
        await this.eventBus.shutdown();
      }
      console.log('DialogIntegrationService shutdown complete');
    } catch (error) {
      console.error('DialogIntegrationService shutdown error:', error);
    }
  }

  // Private helper methods (implementations would be completed)
  private async loadConversationFlows(): Promise<void> {
    // Load flows from database
  }

  private async loadMessageTemplates(): Promise<void> {
    // Load templates from WhatsApp Business API or database
  }

  private startSessionCleanup(): void {
    // Start periodic cleanup of expired sessions
    setInterval(async () => {
      await this.cleanupExpiredSessions();
    }, 300000); // Every 5 minutes
  }

  private async cleanupExpiredSessions(): Promise<void> {
    // Remove expired sessions
  }

  private async getCustomerSession(phone: string): Promise<CustomerSession | null> {
    // Get session from cache or database
    return this.activeSessions.get(phone) || null;
  }

  private async createCustomerSession(phone: string, message: any): Promise<CustomerSession> {
    // Create new session
    const session: CustomerSession = {
      phone,
      tenant_id: '', // Would be determined based on phone number or other context
      current_flow: '',
      current_step: '',
      context: {},
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 3600000) // 1 hour default
    };

    this.activeSessions.set(phone, session);
    return session;
  }

  private async updateCustomerSession(session: CustomerSession): Promise<void> {
    // Update session in cache and database
    this.activeSessions.set(session.phone, session);
  }

  private async validateInput(message: any, step: ConversationStep): Promise<{ isValid: boolean; value?: any; error?: string }> {
    // Validate user input based on expected type
    return { isValid: true, value: message.text?.body };
  }

  private async sendValidationErrorMessage(session: CustomerSession, error: string): Promise<void> {
    // Send validation error message
  }

  private async executeStepAction(session: CustomerSession, action: any, traceContext: any): Promise<void> {
    // Execute step actions (create booking, fetch data, etc.)
  }

  private async determineNextStep(session: CustomerSession, currentStep: ConversationStep, input: any): Promise<string | null> {
    // Determine next step based on conditions
    return null;
  }

  private async sendStepMessage(session: CustomerSession, step: ConversationStep, traceContext: any): Promise<void> {
    // Send message for conversation step
  }

  private async completeConversationFlow(session: CustomerSession, traceContext: any): Promise<void> {
    // Complete conversation flow
    this.metrics.conversationsCompleted++;
  }

  private async sendErrorMessage(session: CustomerSession, message: string): Promise<void> {
    // Send error message
  }

  private async logMessage(message: any, tenantId: string, direction: 'incoming' | 'outgoing'): Promise<void> {
    // Log message to database
  }

  private async handleMessageStatus(status: any, traceContext: any): Promise<void> {
    // Handle message delivery status updates
  }

  private formatBookingConfirmation(bookingData: any): string {
    // Format booking confirmation message
    return `✅ Booking Confirmed!\n\nDetails:\n📅 ${bookingData.start_time}\n👤 ${bookingData.customer_name}\n🏢 ${bookingData.service_name}\n\nThank you for booking with us!`;
  }

  private formatBookingReminder(bookingData: any, reminderType: string): string {
    // Format booking reminder message
    const timeText = reminderType === 'day_before' ? 'tomorrow' : 'in 1 hour';
    return `⏰ Reminder: You have an appointment ${timeText}!\n\n📅 ${bookingData.start_time}\n🏢 ${bookingData.service_name}\n\nSee you soon!`;
  }

  private async scheduleBookingReminder(customerPhone: string, bookingData: any, tenantId: string): Promise<void> {
    // Schedule reminder using job queue
  }
}

// Export singleton instance
export const dialogIntegration = new DialogIntegrationService();