// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { createServerSupabaseClient, createSupabaseAdminClient } from '@/lib/supabase/server';
import { getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';
import { getProviderClient } from '@/lib/whatsapp/providers';
import { detectIntent } from '@/lib/intentDetector';
import { dialogBookingBridge } from '@/lib/dialogBookingBridge';
import dialogManager from '@/lib/dialogManager';
import { reviewCollectionAgent } from '@/lib/ai/reviewCollectionAgent';

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
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ConversationState {
  tenant_id: string;
  phone_number: string;
  session_id: string;
  current_step: string;
  context: Record<string, unknown>;
  last_activity: string;
  conversation_history: Array<{
    message: string;
    from_me: boolean;
    timestamp: string;
  }>;
}

class WhatsAppMessageProcessor {
  private supabase = createSupabaseAdminClient();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10;
  private readonly PROCESSING_INTERVAL = 2000; // 2 seconds

  /**
   * Start the message processor
   */
  async start(): Promise<void> {
    if (this.isProcessing) {
      defaultLogger.info('WhatsApp message processor already running');
      return;
    }

    defaultLogger.info('Starting WhatsApp message processor...');
    this.isProcessing = true;

    // Initialize dialog booking bridge
    await dialogBookingBridge.initialize();

    // Start processing loop
    this.processingInterval = setInterval(() => {
      this.processBatch().catch(error => {
        defaultLogger.error('Error in message processing batch:', error);
      });
    }, this.PROCESSING_INTERVAL);

    defaultLogger.info('WhatsApp message processor started');
  }

  /**
   * Stop the message processor
   */
  stop(): void {
    defaultLogger.info('Stopping WhatsApp message processor...');
    this.isProcessing = false;
    
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    defaultLogger.info('WhatsApp message processor stopped');
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
        defaultLogger.error('Failed to fetch pending messages:', error);
        return;
      }

      if (!messages || messages.length === 0) {
        return; // No messages to process
      }

      defaultLogger.info(`Processing batch of ${messages.length} messages`);

      // Process messages in parallel with limited concurrency
      const promises = messages.map(message => 
        this.processMessage(message).catch(error => {
          defaultLogger.error(`Failed to process message ${message.id}:`, error);
          return this.markMessageFailed(message.id, error.message);
        })
      );

      await Promise.allSettled(promises);

    } catch (error) {
      defaultLogger.error('Error processing message batch:', error);
    }
  }

  /**
   * Process a single message
   */
  private async processMessage(message: MessageQueueItem): Promise<void> {
    defaultLogger.info(`Processing message ${message.id} from ${message.from_number}`);

    try {
      // Mark message as processing
      await this.updateMessageStatus(message.id, 'processing');

      // Get WhatsApp configuration for tenant
      const whatsappConfig = await getTenantWhatsAppConfig(message.tenant_id);
      if (!whatsappConfig) {
        throw new Error('No WhatsApp configuration found for tenant');
      }

      // Only reply if the tenant owner has enabled the AI agent
      if (!whatsappConfig.agent_enabled) {
        defaultLogger.info(`[PROCESSOR] Agent disabled for tenant ${message.tenant_id}, skipping reply`);
        await this.updateMessageStatus(message.id, 'completed');
        return;
      }

      const evolutionClient = getProviderClient(whatsappConfig);

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

      let responseMessage: string | undefined;
      let shouldCompleteConversation = false;
      let nextStep: string | undefined;

      // Check if this is a review collection conversation
      const { data: reviewSession } = await this.supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('phone_number', message.from_number)
        .eq('session_type', 'review_collection')
        .eq('tenant_id', message.tenant_id)
        .single();

      if (reviewSession) {
        // Process as review collection
        const reviewResponse = await reviewCollectionAgent.processReviewResponse(
          message.tenant_id,
          message.from_number,
          message.content
        );

        responseMessage = reviewResponse.reply;
        shouldCompleteConversation = reviewResponse.completed;

        // If review completed, clean up session
        if (reviewResponse.completed) {
          await this.supabase
            .from('whatsapp_sessions')
            .delete()
            .eq('phone_number', message.from_number)
            .eq('session_type', 'review_collection');
        }
      } else {
        // Process message through dialog booking bridge
        const dialogResponse = await dialogBookingBridge.processMessage(
          message.tenant_id,
          conversationState.session_id,
          message.content,
          message.from_number
        );

        responseMessage = dialogResponse.response;
        shouldCompleteConversation = dialogResponse.completed;
        nextStep = dialogResponse.nextStep;

        // Handle different response scenarios
        if (dialogResponse.error) {
          defaultLogger.warn('Dialog booking bridge error:', dialogResponse.error);
          responseMessage = this.getErrorResponse(intentResult.intent);
        } else if (!responseMessage && intentResult.intent !== 'unknown') {
          // Generate contextual response based on intent
          responseMessage = await this.generateContextualResponse(
            intentResult,
            conversationState
          );
        }
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

          // Store outbound reply in messages table so dashboard thread shows it
          const { data: chat } = await this.supabase
            .from('chats')
            .select('id')
            .eq('tenant_id', message.tenant_id)
            .eq('customer_phone', message.from_number)
            .maybeSingle();

          await this.supabase.from('messages').insert({
            tenant_id: message.tenant_id,
            chat_id: chat?.id ?? null,
            from_number: whatsappConfig.instanceName,
            to_number: message.from_number,
            content: responseMessage,
            direction: 'outbound',
            message_type: 'text',
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Update conversation state
      conversationState.last_activity = new Date().toISOString();
      conversationState.current_step = nextStep || conversationState.current_step;

      if (shouldCompleteConversation) {
        conversationState.current_step = 'completed';
      }

      await this.saveConversationState(conversationState);

      // Mark message as completed
      await this.updateMessageStatus(message.id, 'completed');

      defaultLogger.info(`Successfully processed message ${message.id}`);

    } catch (error) {
      defaultLogger.error(`Error processing message ${message.id}:`, error);
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
        defaultLogger.error('Failed to get conversation state:', error);
        return null;
      }

      return data as ConversationState;
    } catch (error) {
      defaultLogger.error('Error getting conversation state:', error);
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

      // Look up the tenant's industry so the AI can apply vertical-specific logic
      const adminClient = createSupabaseAdminClient();
      const { data: tenantData, error: tenantLookupError } = await adminClient
        .from('tenants')
        .select('industry')
        .eq('id', tenantId)
        .maybeSingle();
      if (tenantLookupError) {
        defaultLogger.error(`[MessageProcessor] Failed to fetch tenant industry for ${tenantId}:`, tenantLookupError.message, tenantLookupError);
      }

      const conversationState: ConversationState = {
        tenant_id: tenantId,
        phone_number: phoneNumber,
        session_id: session.id,
        current_step: 'greeting',
        context: {
          created_at: new Date().toISOString(),
          tenant_vertical: (tenantData?.industry as string) ?? 'general',
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
        defaultLogger.error('Failed to create conversation state:', error);
        throw error;
      }

      return data as ConversationState;

    } catch (error) {
      defaultLogger.error('Error creating conversation state:', error);
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
        defaultLogger.error('Failed to save conversation state:', error);
        throw error;
      }
    } catch (error) {
      defaultLogger.error('Error saving conversation state:', error);
      throw error;
    }
  }

  /**
   * Generate contextual response based on intent and conversation state
   */
  private async generateContextualResponse(
    intentResult: { intent: string; confidence: number },
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
        defaultLogger.error('Failed to update message status:', error);
      }
    } catch (error) {
      defaultLogger.error('Error updating message status:', error);
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
      
      defaultLogger.info(`Scheduled retry for message ${message.id} in ${retryDelay}ms`);
    } else {
      await this.markMessageFailed(message.id, error.message);
    }
  }

  /**
   * Mark message as failed
   */
  private async markMessageFailed(messageId: string, errorMessage: string): Promise<void> {
    await this.updateMessageStatus(messageId, 'failed', errorMessage);
    defaultLogger.error(`Message ${messageId} failed permanently: ${errorMessage}`);
  }
}

// Export singleton instance
export const whatsappMessageProcessor = new WhatsAppMessageProcessor();

// Convenience functions
export async function startWhatsAppProcessor(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    defaultLogger.warn('[messageProcessor] Supabase env vars not configured — WhatsApp processor will not start');
    return;
  }
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
  metadata: Record<string, unknown> = {}
): Promise<string | null> {
  try {
    const supabase = createSupabaseAdminClient();

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
      defaultLogger.error('Failed to queue WhatsApp message:', error);
      return null;
    }

    return data.id;
  } catch (error) {
    defaultLogger.error('Error queuing WhatsApp message:', error);
    return null;
  }
}
