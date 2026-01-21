import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface EvolutionAPIConfig {
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location';
  timestamp: number;
  messageId: string;
  fromMe: boolean;
  quotedMessage?: {
    id: string;
    body: string;
    from: string;
  };
  mediaData?: {
    mimetype: string;
    filename?: string;
    url?: string;
    data?: string; // base64 encoded
  };
}

export interface WhatsAppContact {
  id: string;
  name?: string;
  number: string;
  profilePicture?: string;
  isGroup: boolean;
  lastSeen?: number;
}

export interface MessageTemplate {
  name: string;
  language: string;
  category: 'ACCOUNT_UPDATE' | 'PAYMENT_UPDATE' | 'PERSONAL_FINANCE_UPDATE' | 'SHIPPING_UPDATE' | 'RESERVATION_UPDATE' | 'ISSUE_RESOLUTION' | 'APPOINTMENT_UPDATE';
  components: Array<{
    type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
    parameters?: Array<{ type: 'text'; text: string }>;
  }>;
}

class EvolutionAPIClient {
  private config: EvolutionAPIConfig;
  private supabase = createClient();

  constructor(config: EvolutionAPIConfig) {
    this.config = config;
  }

  /**
   * Initialize WhatsApp instance
   */
  async initializeInstance(): Promise<{ success: boolean; qrCode?: string; status?: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/instance/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify({
          instanceName: this.config.instanceName,
          token: this.config.apiKey,
          qrcode: true,
          markMessagesRead: true,
          delayMessage: 1000,
          alwaysOnline: true,
          readMessages: true,
          readStatus: true,
          syncFullHistory: false,
          webhookUrl: this.config.webhookUrl
        })
      });

      if (!response.ok) {
        throw new Error(`Evolution API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        qrCode: data.qrcode?.code,
        status: data.instance?.status
      };

    } catch (error) {
      console.error('Failed to initialize WhatsApp instance:', error);
      return { success: false };
    }
  }

  /**
   * Get instance connection status
   */
  async getConnectionStatus(): Promise<{ connected: boolean; status?: string; phone?: string }> {
    try {
      const response = await fetch(`${this.config.baseUrl}/instance/connectionState/${this.config.instanceName}`, {
        headers: { 'apikey': this.config.apiKey }
      });

      if (!response.ok) {
        return { connected: false };
      }

      const data = await response.json();
      return {
        connected: data.instance?.state === 'open',
        status: data.instance?.state,
        phone: data.instance?.owner
      };

    } catch (error) {
      console.error('Failed to get connection status:', error);
      return { connected: false };
    }
  }

  /**
   * Send text message
   */
  async sendTextMessage(to: string, text: string, quotedMessageId?: string): Promise<{ success: boolean; messageId?: string }> {
    try {
      // Clean phone number (remove non-digits, ensure country code)
      const cleanNumber = this.cleanPhoneNumber(to);
      
      const payload: any = {
        number: cleanNumber,
        textMessage: {
          text: text
        }
      };

      if (quotedMessageId) {
        payload.quoted = { id: quotedMessageId };
      }

      const response = await fetch(`${this.config.baseUrl}/message/sendText/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.key?.id
      };

    } catch (error) {
      console.error('Failed to send text message:', error);
      return { success: false };
    }
  }

  /**
   * Send media message (image, video, document, audio)
   */
  async sendMediaMessage(
    to: string, 
    media: { url?: string; data?: string; mimetype: string; filename?: string },
    caption?: string,
    type: 'image' | 'video' | 'document' | 'audio' = 'image'
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const cleanNumber = this.cleanPhoneNumber(to);
      
      const payload: any = {
        number: cleanNumber
      };

      // Set media payload based on type
      switch (type) {
        case 'image':
          payload.mediaMessage = {
            mediatype: 'image',
            media: media.url || media.data,
            caption: caption || ''
          };
          break;
        case 'video':
          payload.mediaMessage = {
            mediatype: 'video',
            media: media.url || media.data,
            caption: caption || ''
          };
          break;
        case 'document':
          payload.mediaMessage = {
            mediatype: 'document',
            media: media.url || media.data,
            filename: media.filename || 'document'
          };
          break;
        case 'audio':
          payload.mediaMessage = {
            mediatype: 'audio',
            media: media.url || media.data
          };
          break;
      }

      const response = await fetch(`${this.config.baseUrl}/message/sendMedia/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to send media: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.key?.id
      };

    } catch (error) {
      console.error('Failed to send media message:', error);
      return { success: false };
    }
  }

  /**
   * Send template message (WhatsApp Business API)
   */
  async sendTemplateMessage(
    to: string,
    template: MessageTemplate
  ): Promise<{ success: boolean; messageId?: string }> {
    try {
      const cleanNumber = this.cleanPhoneNumber(to);
      
      const payload = {
        number: cleanNumber,
        templateMessage: {
          name: template.name,
          language: template.language,
          components: template.components
        }
      };

      const response = await fetch(`${this.config.baseUrl}/message/sendTemplate/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to send template: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        messageId: data.key?.id
      };

    } catch (error) {
      console.error('Failed to send template message:', error);
      return { success: false };
    }
  }

  /**
   * Get chat messages
   */
  async getChatMessages(chatId: string, limit: number = 50): Promise<WhatsAppMessage[]> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/chat/fetchMessages/${this.config.instanceName}/${chatId}?limit=${limit}`,
        {
          headers: { 'apikey': this.config.apiKey }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const data = await response.json();
      return this.normalizeMessages(data.messages || []);

    } catch (error) {
      console.error('Failed to get chat messages:', error);
      return [];
    }
  }

  /**
   * Get contact info
   */
  async getContactInfo(number: string): Promise<WhatsAppContact | null> {
    try {
      const cleanNumber = this.cleanPhoneNumber(number);
      
      const response = await fetch(
        `${this.config.baseUrl}/chat/whatsappNumbers/${this.config.instanceName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.config.apiKey
          },
          body: JSON.stringify({
            numbers: [cleanNumber]
          })
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      const contactData = data?.[0];

      if (contactData) {
        return {
          id: contactData.jid,
          name: contactData.name,
          number: contactData.number,
          profilePicture: contactData.picture,
          isGroup: contactData.jid.includes('@g.us'),
          lastSeen: contactData.lastSeen
        };
      }

      return null;

    } catch (error) {
      console.error('Failed to get contact info:', error);
      return null;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/markMessageAsRead/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify({
          readMessages: [{ id: messageId }]
        })
      });

      return response.ok;

    } catch (error) {
      console.error('Failed to mark message as read:', error);
      return false;
    }
  }

  /**
   * Set typing indicator
   */
  async setTyping(to: string, typing: boolean = true): Promise<boolean> {
    try {
      const cleanNumber = this.cleanPhoneNumber(to);
      
      const response = await fetch(`${this.config.baseUrl}/chat/presence/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify({
          number: cleanNumber,
          presence: typing ? 'composing' : 'available'
        })
      });

      return response.ok;

    } catch (error) {
      console.error('Failed to set typing indicator:', error);
      return false;
    }
  }

  /**
   * Clean and format phone number
   */
  private cleanPhoneNumber(number: string): string {
    // Remove all non-digits
    let cleaned = number.replace(/\D/g, '');
    
    // Add country code if missing (assuming US +1 for now)
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }
    
    // Remove leading + if present
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      return cleaned;
    }
    
    return cleaned;
  }

  /**
   * Normalize message format from Evolution API
   */
  private normalizeMessages(rawMessages: any[]): WhatsAppMessage[] {
    return rawMessages.map(msg => ({
      id: msg.key?.id || msg.messageTimestamp?.toString(),
      from: msg.key?.participant || msg.key?.remoteJid,
      to: msg.key?.remoteJid,
      body: msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text || 
            msg.message?.imageMessage?.caption || 
            msg.message?.videoMessage?.caption || 
            '',
      type: this.getMessageType(msg.message),
      timestamp: msg.messageTimestamp * 1000, // Convert to milliseconds
      messageId: msg.key?.id,
      fromMe: msg.key?.fromMe || false,
      quotedMessage: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? {
        id: msg.message.extendedTextMessage.contextInfo.stanzaId,
        body: msg.message.extendedTextMessage.contextInfo.quotedMessage.conversation || '',
        from: msg.message.extendedTextMessage.contextInfo.participant
      } : undefined,
      mediaData: this.extractMediaData(msg.message)
    }));
  }

  /**
   * Determine message type from Evolution API message object
   */
  private getMessageType(message: any): WhatsAppMessage['type'] {
    if (message.conversation || message.extendedTextMessage) return 'text';
    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.locationMessage) return 'location';
    return 'text';
  }

  /**
   * Extract media data from message
   */
  private extractMediaData(message: any): WhatsAppMessage['mediaData'] | undefined {
    const mediaMessage = message.imageMessage || 
                        message.videoMessage || 
                        message.audioMessage || 
                        message.documentMessage;
    
    if (!mediaMessage) return undefined;

    return {
      mimetype: mediaMessage.mimetype,
      filename: mediaMessage.fileName,
      url: mediaMessage.url
    };
  }

  /**
   * Store message in database
   */
  async storeMessage(tenantId: string, message: WhatsAppMessage): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_messages')
        .insert({
          tenant_id: tenantId,
          message_id: message.id,
          from_number: message.from,
          to_number: message.to,
          body: message.body,
          message_type: message.type,
          timestamp: new Date(message.timestamp).toISOString(),
          from_me: message.fromMe,
          quoted_message: message.quotedMessage,
          media_data: message.mediaData,
          raw_data: message
        });

      if (error) {
        console.error('Failed to store WhatsApp message:', error);
      }
    } catch (error) {
      console.error('Database error storing message:', error);
    }
  }
}

/**
 * Factory function to create Evolution API client
 */
export function createEvolutionClient(config: EvolutionAPIConfig): EvolutionAPIClient {
  return new EvolutionAPIClient(config);
}

/**
 * Get tenant's WhatsApp configuration
 */
export async function getTenantWhatsAppConfig(tenantId: string): Promise<EvolutionAPIConfig | null> {
  try {
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      baseUrl: data.evolution_base_url,
      apiKey: data.evolution_api_key,
      instanceName: data.instance_name,
      webhookUrl: data.webhook_url
    };

  } catch (error) {
    console.error('Failed to get WhatsApp config:', error);
    return null;
  }
}

/**
 * Get tenant ID by Evolution instance name
 */
export async function getTenantIdByInstanceName(instanceName: string): Promise<string | null> {
  try {
    const supabase = createServerSupabaseClient();
    
    const { data, error } = await supabase
      .from('whatsapp_configurations')
      .select('tenant_id')
      .eq('instance_name', instanceName)
      .eq('active', true)
      .single();

    if (error) {
      console.error(`[EVOLUTION-CLIENT] Error looking up tenant for instance ${instanceName}:`, error.message);
      return null;
    }

    return data?.tenant_id || null;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    console.error(`[EVOLUTION-CLIENT] Exception during tenant lookup for instance ${instanceName}:`, message);
    return null;
  }
}