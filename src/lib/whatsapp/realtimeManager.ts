import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface RealtimeMessageUpdate {
  id: string;
  tenant_id: string;
  phone_number: string;
  message_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'pending';
  timestamp: string;
  error_message?: string;
  delivery_timestamp?: string;
  read_timestamp?: string;
  metadata: Record<string, any>;
}

export interface ConversationUpdate {
  tenant_id: string;
  phone_number: string;
  conversation_id: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  typing_indicator?: {
    is_typing: boolean;
    timestamp: string;
  };
  online_status?: {
    is_online: boolean;
    last_seen: string;
  };
}

class WhatsAppRealtimeManager {
  private supabase = createServerSupabaseClient();
  private channels = new Map<string, any>();
  private subscriptions = new Map<string, Set<(data: any) => void>>();

  /**
   * Initialize real-time subscriptions for a tenant
   */
  async initializeTenantRealtime(tenantId: string): Promise<void> {
    console.log(`🔄 Initializing real-time subscriptions for tenant: ${tenantId}`);

    try {
      // Message status updates channel
      const messageChannel = this.supabase
        .channel(`whatsapp_messages:${tenantId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'whatsapp_messages',
          filter: `tenant_id=eq.${tenantId}`
        }, (payload) => {
          this.handleMessageUpdate(tenantId, payload);
        })
        .on('postgres_changes', {
          event: '*',
          schema: 'public', 
          table: 'whatsapp_message_status',
          filter: `tenant_id=eq.${tenantId}`
        }, (payload) => {
          this.handleMessageStatusUpdate(tenantId, payload);
        });

      // Conversation updates channel
      const conversationChannel = this.supabase
        .channel(`whatsapp_conversations:${tenantId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'whatsapp_conversations',
          filter: `tenant_id=eq.${tenantId}`
        }, (payload) => {
          this.handleConversationUpdate(tenantId, payload);
        });

      // Connection status channel  
      const connectionChannel = this.supabase
        .channel(`whatsapp_connections:${tenantId}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'whatsapp_connections',
          filter: `tenant_id=eq.${tenantId}`
        }, (payload) => {
          this.handleConnectionUpdate(tenantId, payload);
        })
        .on('broadcast', { event: 'connection_update' }, (payload) => {
          this.handleConnectionBroadcast(tenantId, payload);
        });

      // Typing indicators channel
      const typingChannel = this.supabase
        .channel(`whatsapp_typing:${tenantId}`)
        .on('broadcast', { event: 'typing_start' }, (payload) => {
          this.handleTypingUpdate(tenantId, { ...payload.payload, typing: true });
        })
        .on('broadcast', { event: 'typing_stop' }, (payload) => {
          this.handleTypingUpdate(tenantId, { ...payload.payload, typing: false });
        });

      // Subscribe to all channels
      await Promise.all([
        messageChannel.subscribe(),
        conversationChannel.subscribe(),
        connectionChannel.subscribe(),
        typingChannel.subscribe()
      ]);

      // Store channels for cleanup
      this.channels.set(`messages:${tenantId}`, messageChannel);
      this.channels.set(`conversations:${tenantId}`, conversationChannel);
      this.channels.set(`connections:${tenantId}`, connectionChannel);
      this.channels.set(`typing:${tenantId}`, typingChannel);

      console.log(`✅ Real-time subscriptions initialized for tenant: ${tenantId}`);

    } catch (error) {
      console.error('Error initializing real-time subscriptions:', error);
      throw error;
    }
  }

  /**
   * Subscribe to specific events for a tenant
   */
  subscribeToEvents(
    tenantId: string,
    eventType: 'messages' | 'conversations' | 'connections' | 'typing',
    callback: (data: any) => void
  ): () => void {
    const subscriptionKey = `${eventType}:${tenantId}`;
    
    if (!this.subscriptions.has(subscriptionKey)) {
      this.subscriptions.set(subscriptionKey, new Set());
    }
    
    this.subscriptions.get(subscriptionKey)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.subscriptions.get(subscriptionKey);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.subscriptions.delete(subscriptionKey);
        }
      }
    };
  }

  /**
   * Handle message updates
   */
  private handleMessageUpdate(tenantId: string, payload: any): void {
    try {
      console.log(`📨 Message update for tenant ${tenantId}:`, payload.eventType);

      const messageData = {
        tenant_id: tenantId,
        event: payload.eventType,
        message: payload.new || payload.old,
        timestamp: new Date().toISOString()
      };

      this.broadcastToSubscribers(`messages:${tenantId}`, messageData);

      // Update conversation last message if this is a new message
      if (payload.eventType === 'INSERT' && payload.new) {
        this.updateConversationLastMessage(tenantId, payload.new);
      }

    } catch (error) {
      console.error('Error handling message update:', error);
    }
  }

  /**
   * Handle message status updates (delivered, read, etc.)
   */
  private handleMessageStatusUpdate(tenantId: string, payload: any): void {
    try {
      console.log(`📊 Message status update for tenant ${tenantId}:`, payload.eventType);

      const statusData = {
        tenant_id: tenantId,
        event: payload.eventType,
        status: payload.new || payload.old,
        timestamp: new Date().toISOString()
      };

      this.broadcastToSubscribers(`messages:${tenantId}`, statusData);

      // Broadcast specific status update
      this.broadcastMessageStatusUpdate(tenantId, statusData);

    } catch (error) {
      console.error('Error handling message status update:', error);
    }
  }

  /**
   * Handle conversation updates
   */
  private handleConversationUpdate(tenantId: string, payload: any): void {
    try {
      console.log(`💬 Conversation update for tenant ${tenantId}:`, payload.eventType);

      const conversationData = {
        tenant_id: tenantId,
        event: payload.eventType,
        conversation: payload.new || payload.old,
        timestamp: new Date().toISOString()
      };

      this.broadcastToSubscribers(`conversations:${tenantId}`, conversationData);

      // Update unread counts if message was added
      if (payload.eventType === 'UPDATE' && payload.new) {
        this.updateUnreadCounts(tenantId, payload.new);
      }

    } catch (error) {
      console.error('Error handling conversation update:', error);
    }
  }

  /**
   * Handle connection updates
   */
  private handleConnectionUpdate(tenantId: string, payload: any): void {
    try {
      console.log(`🔌 Connection update for tenant ${tenantId}:`, payload.eventType);

      const connectionData = {
        tenant_id: tenantId,
        event: payload.eventType,
        connection: payload.new || payload.old,
        timestamp: new Date().toISOString()
      };

      this.broadcastToSubscribers(`connections:${tenantId}`, connectionData);

    } catch (error) {
      console.error('Error handling connection update:', error);
    }
  }

  /**
   * Handle connection broadcast updates
   */
  private handleConnectionBroadcast(tenantId: string, payload: any): void {
    try {
      console.log(`📡 Connection broadcast for tenant ${tenantId}:`, payload);

      this.broadcastToSubscribers(`connections:${tenantId}`, {
        tenant_id: tenantId,
        event: 'broadcast',
        data: payload.payload,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error handling connection broadcast:', error);
    }
  }

  /**
   * Handle typing indicators
   */
  private handleTypingUpdate(tenantId: string, data: any): void {
    try {
      console.log(`⌨️ Typing update for tenant ${tenantId}:`, data.phone_number);

      const typingData = {
        tenant_id: tenantId,
        phone_number: data.phone_number,
        is_typing: data.typing,
        timestamp: data.timestamp || new Date().toISOString()
      };

      this.broadcastToSubscribers(`typing:${tenantId}`, typingData);

    } catch (error) {
      console.error('Error handling typing update:', error);
    }
  }

  /**
   * Broadcast to all subscribers of an event type
   */
  private broadcastToSubscribers(subscriptionKey: string, data: any): void {
    const callbacks = this.subscriptions.get(subscriptionKey);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('Error in subscriber callback:', error);
        }
      });
    }
  }

  /**
   * Update conversation last message
   */
  private async updateConversationLastMessage(tenantId: string, message: any): Promise<void> {
    try {
      if (!message.phone_number || !message.content) return;

      const updates = {
        last_message: message.content,
        last_message_time: message.created_at || new Date().toISOString(),
        last_activity: new Date().toISOString()
      };

      // Increment unread count if message is from customer
      if (!message.from_me) {
        const { data: conversation } = await this.supabase
          .from('whatsapp_conversations')
          .select('unread_count')
          .eq('tenant_id', tenantId)
          .eq('phone_number', message.phone_number)
          .single();

        updates.unread_count = (conversation?.unread_count || 0) + 1;
      }

      await this.supabase
        .from('whatsapp_conversations')
        .update(updates)
        .eq('tenant_id', tenantId)
        .eq('phone_number', message.phone_number);

    } catch (error) {
      console.error('Error updating conversation last message:', error);
    }
  }

  /**
   * Broadcast message status update
   */
  private broadcastMessageStatusUpdate(tenantId: string, statusData: any): void {
    const status = statusData.status;
    if (!status || !status.message_id) return;

    const update: RealtimeMessageUpdate = {
      id: status.id,
      tenant_id: tenantId,
      phone_number: status.phone_number,
      message_id: status.message_id,
      status: status.status,
      timestamp: status.updated_at || new Date().toISOString(),
      error_message: status.error_message,
      delivery_timestamp: status.delivery_timestamp,
      read_timestamp: status.read_timestamp,
      metadata: status.metadata || {}
    };

    // Send to dedicated message status channel
    this.supabase
      .channel(`message_status:${tenantId}`)
      .send({
        type: 'broadcast',
        event: 'status_update',
        payload: update
      });
  }

  /**
   * Update unread counts for conversation
   */
  private async updateUnreadCounts(tenantId: string, conversation: any): Promise<void> {
    try {
      // Broadcast unread count update
      const update: ConversationUpdate = {
        tenant_id: tenantId,
        phone_number: conversation.phone_number,
        conversation_id: conversation.session_id || conversation.id,
        last_message: conversation.last_message || '',
        last_message_time: conversation.last_message_time || conversation.last_activity,
        unread_count: conversation.unread_count || 0
      };

      // Send to conversation updates channel
      this.supabase
        .channel(`conversation_updates:${tenantId}`)
        .send({
          type: 'broadcast',
          event: 'unread_update',
          payload: update
        });

    } catch (error) {
      console.error('Error updating unread counts:', error);
    }
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(
    tenantId: string,
    phoneNumber: string,
    isTyping: boolean
  ): Promise<void> {
    try {
      const payload = {
        phone_number: phoneNumber,
        typing: isTyping,
        timestamp: new Date().toISOString()
      };

      const event = isTyping ? 'typing_start' : 'typing_stop';

      await this.supabase
        .channel(`whatsapp_typing:${tenantId}`)
        .send({
          type: 'broadcast',
          event,
          payload
        });

    } catch (error) {
      console.error('Error sending typing indicator:', error);
    }
  }

  /**
   * Update online status
   */
  async updateOnlineStatus(
    tenantId: string,
    phoneNumber: string,
    isOnline: boolean
  ): Promise<void> {
    try {
      const update = {
        is_online: isOnline,
        last_seen: new Date().toISOString()
      };

      await this.supabase
        .from('whatsapp_contacts')
        .update(update)
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber);

      // Broadcast online status update
      await this.supabase
        .channel(`whatsapp_presence:${tenantId}`)
        .send({
          type: 'broadcast',
          event: 'presence_update',
          payload: {
            phone_number: phoneNumber,
            ...update
          }
        });

    } catch (error) {
      console.error('Error updating online status:', error);
    }
  }

  /**
   * Mark conversation as read
   */
  async markConversationRead(
    tenantId: string,
    phoneNumber: string
  ): Promise<void> {
    try {
      // Update conversation unread count
      await this.supabase
        .from('whatsapp_conversations')
        .update({
          unread_count: 0,
          last_read: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber);

      // Mark recent messages as read
      await this.supabase
        .from('whatsapp_message_status')
        .update({
          status: 'read',
          read_timestamp: new Date().toISOString()
        })
        .eq('tenant_id', tenantId)
        .eq('phone_number', phoneNumber)
        .in('status', ['sent', 'delivered']);

      // Broadcast read update
      await this.supabase
        .channel(`conversation_updates:${tenantId}`)
        .send({
          type: 'broadcast',
          event: 'read_update',
          payload: {
            phone_number: phoneNumber,
            read_timestamp: new Date().toISOString()
          }
        });

    } catch (error) {
      console.error('Error marking conversation as read:', error);
    }
  }

  /**
   * Get real-time conversation list for dashboard
   */
  async getRealtimeConversations(tenantId: string): Promise<ConversationUpdate[]> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_conversations')
        .select(`
          *,
          whatsapp_contacts!inner(name, profile_picture)
        `)
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('last_activity', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Error getting real-time conversations:', error);
        return [];
      }

      return data.map(conv => ({
        tenant_id: tenantId,
        phone_number: conv.phone_number,
        conversation_id: conv.session_id || conv.id,
        last_message: conv.last_message || '',
        last_message_time: conv.last_activity,
        unread_count: conv.unread_count || 0,
        contact_name: conv.whatsapp_contacts?.name,
        profile_picture: conv.whatsapp_contacts?.profile_picture
      })) as ConversationUpdate[];

    } catch (error) {
      console.error('Error getting real-time conversations:', error);
      return [];
    }
  }

  /**
   * Cleanup tenant subscriptions
   */
  async cleanupTenantRealtime(tenantId: string): Promise<void> {
    console.log(`🧹 Cleaning up real-time subscriptions for tenant: ${tenantId}`);

    try {
      // Unsubscribe from all channels for this tenant
      const channelKeys = [
        `messages:${tenantId}`,
        `conversations:${tenantId}`,
        `connections:${tenantId}`,
        `typing:${tenantId}`
      ];

      for (const key of channelKeys) {
        const channel = this.channels.get(key);
        if (channel) {
          await channel.unsubscribe();
          this.channels.delete(key);
        }
      }

      // Clear subscriptions
      const subscriptionKeys = [
        `messages:${tenantId}`,
        `conversations:${tenantId}`,
        `connections:${tenantId}`,
        `typing:${tenantId}`
      ];

      for (const key of subscriptionKeys) {
        this.subscriptions.delete(key);
      }

      console.log(`✅ Cleaned up real-time subscriptions for tenant: ${tenantId}`);

    } catch (error) {
      console.error('Error cleaning up real-time subscriptions:', error);
    }
  }

  /**
   * Get connection for WebSocket health check
   */
  getConnectionHealth(): {
    totalChannels: number;
    totalSubscriptions: number;
    connectedChannels: number;
  } {
    const connectedChannels = Array.from(this.channels.values())
      .filter(channel => channel.state === 'joined').length;

    return {
      totalChannels: this.channels.size,
      totalSubscriptions: this.subscriptions.size,
      connectedChannels
    };
  }
}

// Export singleton instance
export const whatsappRealtimeManager = new WhatsAppRealtimeManager();