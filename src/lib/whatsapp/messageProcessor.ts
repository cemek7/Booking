import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createEvolutionClient, getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { detectIntent } from '@/lib/intentDetector';
import { dialogBookingBridge } from '@/lib/dialogBookingBridge';
import dialogManager from '@/lib/dialogManager';

export interface MessageQueueItem {
  id: string;
  tenant_id: string;
  message_id: string;
  from_number: string;
  to_number: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retry';
  retry_count: number;
  max_retries: number;
  scheduled_at?: string;
  processed_at?: string;
  error_message?: string;
  metadata: Record<string, any>;
  created_at: string;
}

export interface ConversationState {
  tenant_id: string;
  phone_number: string;
  session_id: string;
  current_step: string;
  context: Record<string, any>;
  last_activity: string;
  conversation_history: Array<{
    message: string;
    from_me: boolean;
    timestamp: string;
  }>;
}

class WhatsAppMessageProcessor {
  private supabase = createServerSupabaseClient();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly PROCESSING_INTERVAL = 2000; // 2 seconds

  /**
   * Start the message processor
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      console.log('WhatsApp message processor already running');
      return;
    }

    console.log('Starting WhatsApp message processor...');
    this.isProcessing = true;

    // Initialize dialog booking bridge
    await dialogBookingBridge.initialize();

    // Start processing loop
    this.processingInterval = setInterval(() => {
      this.processBatch().catch(error => {
        console.error('Error in message processing batch:', error);
      });
    }, this.PROCESSING_INTERVAL);

    console.log('WhatsApp message processor started');
  }

  /**
   * Stop the message processor
   */
  stop(): void {
    console.log('Stopping WhatsApp message processor...');
    this.isProcessing = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    console.log('WhatsApp message processor stopped');
  }

  /**
   * Process a batch of pending messages
   */
  private async processBatch(): Promise<void> {
    if (!this.isProcessing) return;

    try {
      // Get pending messages ordered by priority and creation time
      const { data: messages, error } = await this.supabase
        .from('whatsapp_message_queue')
        .select('*')
        .in('status', ['pending', 'retry'])
        .lte('scheduled_at', new Date().toISOString())
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(this.BATCH_SIZE);

      if (error) {
        console.error('Failed to fetch pending messages:', error);
        return;
      }

      if (!messages || messages.length === 0) {
        return; // No messages to process
      }

      console.log(`Processing batch of ${messages.length} messages`);

      // Process messages in parallel with limited concurrency
      const promises = messages.map(message => 
        this.processMessage(message).catch(error => {
          console.error(`Failed to process message ${message.id}:`, error);
          return this.markMessageFailed(message.id, error.message);
        })
      );

      await Promise.allSettled(promises);

    } catch (error) {
      console.error('Error processing message batch:', error);
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: MessageQueueItem): Promise<void> {
    console.log(`Processing message ${message.id} from ${message.from_number}`);

    try {
      // Mark message as processing
      await this.updateMessageStatus(message.id, 'processing');

      // Get WhatsApp configuration for tenant
      const whatsappConfig = await getTenantWhatsAppConfig(message.tenant_id);
      if (!whatsappConfig) {
        throw new Error('No WhatsApp configuration found for tenant');
      }

      const evolutionClient = createEvolutionClient(whatsappConfig);

      // Get or create conversation state
      let conversationState = await this.getConversationState(
        message.tenant_id, 
        message.from_number
      );

      if (!conversationState) {
        conversationState = await this.createConversationState(
          message.tenant_id,
          message.from_number
        );
      }

      // Update conversation history
      conversationState.conversation_history.push({
        message: message.content,
        from_me: false,
        timestamp: new Date().toISOString()
      });

      // Detect intent with conversation context
      const intentResult = await detectIntent(
        message.content,
        {
          previousIntent: conversationState.context.last_intent,
          conversationTurn: conversationState.conversation_history.length,
          tenantVertical: conversationState.context.tenant_vertical,
          timeOfDay: this.getTimeOfDay()
        },
        message.tenant_id,
        message.from_number // Use phone number as user ID for now
      );

      // Update conversation state with intent
      conversationState.context.last_intent = intentResult.intent;
      conversationState.context.last_confidence = intentResult.confidence;
      conversationState.context.entities = intentResult.entities;

      // Process message through dialog booking bridge
      const dialogResponse = await dialogBookingBridge.processMessage(
        message.tenant_id,
        conversationState.session_id,
        message.content,
        message.from_number
      );

      let responseMessage = dialogResponse.response;
      let shouldCompleteConversation = dialogResponse.completed;

      // Handle different response scenarios
      if (dialogResponse.error) {
        console.warn('Dialog booking bridge error:', dialogResponse.error);
        responseMessage = this.getErrorResponse(intentResult.intent);
      } else if (!responseMessage && intentResult.intent !== 'unknown') {
        // Generate contextual response based on intent
        responseMessage = await this.generateContextualResponse(
          intentResult,
          conversationState
        );
      }

      // Send response if we have one
      if (responseMessage) {
        const sendResult = await evolutionClient.sendTextMessage(
          message.from_number,
          responseMessage
        );

        if (sendResult.success) {
          // Update conversation history with response
          conversationState.conversation_history.push({
            message: responseMessage,
            from_me: true,
            timestamp: new Date().toISOString()
          });

          // Store outbound message
          await evolutionClient.storeMessage(message.tenant_id, {
            id: sendResult.messageId || `out-${Date.now()}`,
            from: whatsappConfig.instanceName,
            to: message.from_number,
            body: responseMessage,
            type: 'text',
            timestamp: Date.now(),
            messageId: sendResult.messageId || `out-${Date.now()}`,
            fromMe: true
          });
        }
      }

      // Update conversation state
      conversationState.last_activity = new Date().toISOString();
      conversationState.current_step = dialogResponse.nextStep || conversationState.current_step;

      if (shouldCompleteConversation) {
        conversationState.current_step = 'completed';
      }

      await this.saveConversationState(conversationState);

      // Mark message as completed
      await this.updateMessageStatus(message.id, 'completed');

      console.log(`Successfully processed message ${message.id}`);

    } catch (error) {
      console.error(`Error processing message ${message.id}:`, error);
      await this.handleMessageError(message, error);
    }
  }

  /**
   * Get conversation state for tenant and phone number
   */
  private async getConversationState(
    tenantId: string,
    phoneNumber: string
  ): Promise<ConversationState | null> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_conversations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .eq('active', true)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Failed to get conversation state:', error);
        return null;
      }

      return data as ConversationState;
    } catch (error) {
      console.error('Error getting conversation state:', error);
      return null;
    }
  }

  /**
   * Create new conversation state
   */
  private async createConversationState(
    tenantId: string,
    phoneNumber: string
  ): Promise<ConversationState> {
    try {
      // Create new dialog session
      const session = await dialogManager.startSession(tenantId, null);

      const conversationState: ConversationState = {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        session_id: session.id,
        current_step: 'greeting',
        context: {
          created_at: new Date().toISOString(),
          tenant_vertical: 'general' // TODO: Get from tenant settings
        },
        last_activity: new Date().toISOString(),
        conversation_history: []
      };

      const { data, error } = await this.supabase
        .from('whatsapp_conversations')
        .insert(conversationState)
        .select()
        .single();

      if (error) {
        console.error('Failed to create conversation state:', error);
        throw error;
      }

      return data as ConversationState;

    } catch (error) {
      console.error('Error creating conversation state:', error);
      throw error;
    }
  }

  /**
   * Save conversation state
   */
  private async saveConversationState(state: ConversationState): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_conversations')
        .update({
          current_step: state.current_step,
          context: state.context,
          last_activity: state.last_activity,
          conversation_history: state.conversation_history
        })
        .eq('tenant_id', state.tenant_id)
        .eq('phone_number', state.phone_number);

      if (error) {
        console.error('Failed to save conversation state:', error);
        throw error;
      }
    } catch (error) {
      console.error('Error saving conversation state:', error);
      throw error;
    }
  }

  /**
   * Generate contextual response based on intent and conversation state
   */
  private async generateContextualResponse(
    intentResult: any,
    conversationState: ConversationState
  ): Promise<string> {
    const { intent, confidence } = intentResult;

    // Low confidence responses
    if (confidence < 0.6) {
      return "I'm not sure I understand. Could you please rephrase that? You can also type 'help' to see what I can do for you.";
    }

    // Intent-based responses
    switch (intent) {
      case 'booking':
        return "Great! I'd be happy to help you book an appointment. What type of service are you interested in?";
      
      case 'inquiry':
        return "I'm here to help! What would you like to know about our services?";
      
      case 'reschedule':
        return "I can help you reschedule your appointment. Could you please provide your booking reference or the date of your current appointment?";
      
      case 'cancel':
        return "I understand you need to cancel an appointment. Could you please provide your booking reference or appointment details?";
      
      default:
        return "Thank you for contacting us! How can I help you today? You can book an appointment, ask about our services, or reschedule an existing booking.";
    }
  }

  /**
   * Get error response based on intent
   */
  private getErrorResponse(intent: string): string {
    switch (intent) {
      case 'booking':
        return "I apologize, but I'm having trouble processing your booking request. Please call us directly or try again in a moment.";
      
      case 'reschedule':
      case 'cancel':
        return "I'm sorry, I'm unable to process appointment changes right now. Please call us directly for assistance.";
      
      default:
        return "I'm experiencing technical difficulties. Please try again in a moment or call us directly for immediate assistance.";
    }
  }

  /**
   * Get current time of day
   */
  private getTimeOfDay(): 'morning' | 'afternoon' | 'evening' | 'night' {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  /**
   * Update message status
   */
  private async updateMessageStatus(
    messageId: string,
    status: MessageQueueItem['status'],
    errorMessage?: string
  ): Promise<void> {
    try {
      const updates: Partial<MessageQueueItem> = {
        status,
        processed_at: new Date().toISOString()
      };

      if (errorMessage) {
        updates.error_message = errorMessage;
      }

      const { error } = await this.supabase
        .from('whatsapp_message_queue')
        .update(updates)
        .eq('id', messageId);

      if (error) {
        console.error('Failed to update message status:', error);
      }
    } catch (error) {
      console.error('Error updating message status:', error);
    }
  }

  /**
   * Handle message processing error
   */
  private async handleMessageError(
    message: MessageQueueItem,
    error: Error
  ): Promise<void> {
    const newRetryCount = message.retry_count + 1;
    
    if (newRetryCount <= message.max_retries) {
      // Schedule retry with exponential backoff
      const retryDelay = Math.min(300000, 1000 * Math.pow(2, newRetryCount)); // Max 5 minutes
      const scheduledAt = new Date(Date.now() + retryDelay).toISOString();
      
      await this.supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'retry',
          retry_count: newRetryCount,
          scheduled_at: scheduledAt,
          error_message: error.message
        })
        .eq('id', message.id);
      
      console.log(`Scheduled retry for message ${message.id} in ${retryDelay}ms`);
    } else {
      await this.markMessageFailed(message.id, error.message);
    }
  }

  /**
   * Mark message as failed
   */
  private async markMessageFailed(messageId: string, errorMessage: string): Promise<void> {
    await this.updateMessageStatus(messageId, 'failed', errorMessage);
    console.error(`Message ${messageId} failed permanently: ${errorMessage}`);
  }
}

// Export singleton instance
export const whatsappMessageProcessor = new WhatsAppMessageProcessor();

// Convenience functions
export async function startWhatsAppProcessor(): Promise<void> {
  await whatsappMessageProcessor.start();
}

export function stopWhatsAppProcessor(): void {
  whatsappMessageProcessor.stop();
}

export async function queueWhatsAppMessage(
  tenantId: string,
  fromNumber: string,
  toNumber: string,
  content: string,
  priority: MessageQueueItem['priority'] = 'normal',
  metadata: Record<string, any> = {}
): Promise<string | null> {
  try {
    const supabase = createClient();
    
    const queueItem: Omit<MessageQueueItem, 'id' | 'created_at'> = {
      tenant_id: tenantId,
      message_id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      from_number: fromNumber,
      to_number: toNumber,
      content,
      priority,
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      scheduled_at: new Date().toISOString(),
      metadata
    };

    const { data, error } = await supabase
      .from('whatsapp_message_queue')
      .insert(queueItem)
      .select('id')
      .single();

    if (error) {
      console.error('Failed to queue WhatsApp message:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    console.error('Error queuing WhatsApp message:', error);
    return null;
  }
}