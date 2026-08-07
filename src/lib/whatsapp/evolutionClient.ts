import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';
import { getStoredProviderApiKey } from '@/lib/whatsapp/providerSecrets';

export interface EvolutionAPIConfig {
  provider?: 'evolution' | 'waha' | 'meta';
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

interface EvolutionIncomingMessage {
  key?: {
    id?: string;
    participant?: string;
    remoteJid?: string;
    fromMe?: boolean;
  };
  messageTimestamp?: number;
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
      contextInfo?: {
        stanzaId?: string;
        quotedMessage?: { conversation?: string };
        participant?: string;
      };
    };
    imageMessage?: { caption?: string; mimetype?: string; fileName?: string; url?: string };
    videoMessage?: { caption?: string; mimetype?: string; fileName?: string; url?: string };
    audioMessage?: { mimetype?: string; fileName?: string; url?: string };
    documentMessage?: { mimetype?: string; fileName?: string; url?: string };
    locationMessage?: unknown;
  };
}

function normalizeUrl(url?: string | null): string {
  return (url ?? '').trim().toLowerCase().replace(/\/+$/, '');
}

function inferProviderFromConfigRow(data: Record<string, unknown>): 'evolution' | 'waha' | 'meta' {
  const explicitProvider = data.provider;
  if (explicitProvider === 'waha' || explicitProvider === 'evolution' || explicitProvider === 'meta') {
    return explicitProvider;
  }

  const primaryBase = normalizeUrl((data.provider_base_url as string | undefined) ?? (data.evolution_base_url as string | undefined));
  const wahaBase = normalizeUrl(process.env.WAHA_API_BASE);

  if (primaryBase && wahaBase && primaryBase === wahaBase) {
    return 'waha';
  }

  if (primaryBase.includes(':3100')) {
    return 'waha';
  }

  return 'evolution';
}

class EvolutionAPIClient {
  private config: EvolutionAPIConfig;
  private get supabase() { return createSupabaseAdminClient(); }

  constructor(config: EvolutionAPIConfig) {
    this.config = config;
  }

  /** Public accessors used by connectionManager when it builds raw fetch URLs. */
  get baseUrl(): string { return this.config.baseUrl; }
  get apiKey(): string  { return this.config.apiKey; }

  /**
   * Initialize WhatsApp instance
   */
  async initializeInstance(): Promise<{ success: boolean; qrCode?: string; status?: string }> {
    try {
      const response = await fetchWithTimeout(`${this.config.baseUrl}/instance/create`, {
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
          webhook: {
            enabled: true,
            url: this.config.webhookUrl,
            webhookByEvents: true,
            webhookBase64: true,
            events: ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'],
            webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET,
          },
        }),
        timeoutMs: 10_000,
      });

      if (!response.ok) {
        throw new Error(`Evolution API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        qrCode: data.qrcode?.base64 || data.qrcode?.code,
        status: data.instance?.status
      };

    } catch (error) {
      defaultLogger.error('Failed to initialize WhatsApp instance:', error);
      return { success: false };
    }
  }

  /**
   * Get instance connection status
   */
  async getConnectionStatus(): Promise<{ connected: boolean; status?: string; phone?: string }> {
    try {
      const response = await fetchWithTimeout(`${this.config.baseUrl}/instance/connectionState/${this.config.instanceName}`, {
        headers: { 'apikey': this.config.apiKey },
        timeoutMs: 10_000,
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
      defaultLogger.error('Failed to get connection status:', error);
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
      
      const payload: Record<string, unknown> = {
        number: cleanNumber,
        textMessage: {
          text: text
        }
      };

      if (quotedMessageId) {
        payload.quoted = { id: quotedMessageId };
      }

      const response = await fetchWithTimeout(`${this.config.baseUrl}/message/sendText/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
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
      defaultLogger.error('Failed to send text message:', error);
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
      
      const payload: Record<string, unknown> = {
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

      const response = await fetchWithTimeout(`${this.config.baseUrl}/message/sendMedia/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
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
      defaultLogger.error('Failed to send media message:', error);
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

      const response = await fetchWithTimeout(`${this.config.baseUrl}/message/sendTemplate/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
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
      defaultLogger.error('Failed to send template message:', error);
      return { success: false };
    }
  }

  /**
   * Get chat messages
   */
  async getChatMessages(chatId: string, limit: number = 50): Promise<WhatsAppMessage[]> {
    try {
      const response = await fetchWithTimeout(
        `${this.config.baseUrl}/chat/fetchMessages/${this.config.instanceName}/${chatId}?limit=${limit}`,
        {
          headers: { 'apikey': this.config.apiKey },
          timeoutMs: 10_000,
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch messages: ${response.status}`);
      }

      const data = await response.json();
      return this.normalizeMessages(data.messages || []);

    } catch (error) {
      defaultLogger.error('Failed to get chat messages:', error);
      return [];
    }
  }

  /**
   * Get contact info
   */
  async getContactInfo(number: string): Promise<WhatsAppContact | null> {
    try {
      const cleanNumber = this.cleanPhoneNumber(number);
      
      const response = await fetchWithTimeout(
        `${this.config.baseUrl}/chat/whatsappNumbers/${this.config.instanceName}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.config.apiKey
          },
          body: JSON.stringify({
            numbers: [cleanNumber]
          }),
          timeoutMs: 10_000,
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
      defaultLogger.error('Failed to get contact info:', error);
      return null;
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.config.baseUrl}/chat/markMessageAsRead/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify({
          readMessages: [{ id: messageId }]
        }),
        timeoutMs: 10_000,
      });

      return response.ok;

    } catch (error) {
      defaultLogger.error('Failed to mark message as read:', error);
      return false;
    }
  }

  /**
   * Set typing indicator
   */
  async setTyping(to: string, typing: boolean = true): Promise<boolean> {
    try {
      const cleanNumber = this.cleanPhoneNumber(to);
      
      const response = await fetchWithTimeout(`${this.config.baseUrl}/chat/presence/${this.config.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.apiKey
        },
        body: JSON.stringify({
          number: cleanNumber,
          presence: typing ? 'composing' : 'available'
        }),
        timeoutMs: 10_000,
      });

      return response.ok;

    } catch (error) {
      defaultLogger.error('Failed to set typing indicator:', error);
      return false;
    }
  }

  /** Convenience wrapper — sends an image. Used by mediaHandler. */
  async sendImageMessage(to: string, url: string, caption?: string) {
    return this.sendMediaMessage(to, { url, mimetype: 'image/jpeg' }, caption, 'image');
  }

  /** Convenience wrapper — sends a document. Used by mediaHandler. */
  async sendDocumentMessage(to: string, url: string, filename?: string, caption?: string) {
    return this.sendMediaMessage(to, { url, mimetype: 'application/octet-stream', filename }, caption, 'document');
  }

  /** Convenience wrapper — sends an audio file. Used by mediaHandler. */
  async sendAudioMessage(to: string, url: string) {
    return this.sendMediaMessage(to, { url, mimetype: 'audio/mpeg' }, undefined, 'audio');
  }

  /** Convenience wrapper — sends a video. Used by mediaHandler. */
  async sendVideoMessage(to: string, url: string, caption?: string) {
    return this.sendMediaMessage(to, { url, mimetype: 'video/mp4' }, caption, 'video');
  }

  /**
   * Clean and format phone number
   */
  private cleanPhoneNumber(number: string): string {
    // Remove all non-digits
    let cleaned = number.replace(/\D/g, '');
    
    // Add country code if missing; uses DEFAULT_COUNTRY_CODE env var or '1' as fallback
    if (cleaned.length === 10) {
      cleaned = (process.env.DEFAULT_COUNTRY_CODE || '1') + cleaned;
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
  private normalizeMessages(rawMessages: EvolutionIncomingMessage[]): WhatsAppMessage[] {
    return rawMessages.map(msg => {
      const timestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : Date.now();
      const messageId = msg.key?.id || String(timestamp);

      return {
      id: messageId,
      from: msg.key?.participant || msg.key?.remoteJid || '',
      to: msg.key?.remoteJid || '',
      body: msg.message?.conversation || 
            msg.message?.extendedTextMessage?.text || 
            msg.message?.imageMessage?.caption || 
            msg.message?.videoMessage?.caption || 
            '',
      type: this.getMessageType(msg.message),
      timestamp, // Convert to milliseconds
      messageId,
      fromMe: msg.key?.fromMe || false,
      quotedMessage: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? {
        id: msg.message.extendedTextMessage.contextInfo.stanzaId || messageId,
        body: msg.message.extendedTextMessage.contextInfo.quotedMessage.conversation || '',
        from: msg.message.extendedTextMessage.contextInfo.participant || ''
      } : undefined,
      mediaData: this.extractMediaData(msg.message)
      };
    });
  }

  /**
   * Determine message type from Evolution API message object
   */
  private getMessageType(message: EvolutionIncomingMessage['message']): WhatsAppMessage['type'] {
    if (!message) return 'text';
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
  private extractMediaData(message: EvolutionIncomingMessage['message']): WhatsAppMessage['mediaData'] | undefined {
    if (!message) return undefined;

    const mediaMessage = message.imageMessage ||
                        message.videoMessage ||
                        message.audioMessage ||
                        message.documentMessage;
    
    if (!mediaMessage) return undefined;

    return {
      mimetype: mediaMessage.mimetype,
      filename: mediaMessage.fileName,
      url: mediaMessage.url
    } as WhatsAppMessage['mediaData'];
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
        defaultLogger.error('Failed to store WhatsApp message:', error);
      }
    } catch (error) {
      defaultLogger.error('Database error storing message:', error);
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
    const supabase = createSupabaseAdminClient();
    
    const { data, error } = await supabase
      .from('whatsapp_configurations')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .single();

    if (error || !data) {
      const sharedGatewayId = process.env.META_SHARED_GATEWAY_PHONE_NUMBER_ID || '';
      const sharedGatewayToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
      if (sharedGatewayId && sharedGatewayToken) {
        const baseUrl = (process.env.WHATSAPP_BASE_URL || 'https://graph.facebook.com').replace(/\/+$/, '');
        const apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
        return {
          provider: 'meta',
          baseUrl: `${baseUrl}/${apiVersion}`,
          apiKey: sharedGatewayToken,
          instanceName: sharedGatewayId,
        };
      }
      return null;
    }

    const provider = inferProviderFromConfigRow(data as Record<string, unknown>);
    const dbApiKey = await getStoredProviderApiKey(
      supabase,
      tenantId,
      provider,
      (data.provider_api_key ?? data.evolution_api_key) as string | null
    );
    // Tenant-scoped credentials (including Embedded Signup credentials) take
    // precedence. The deployment-wide token is retained only as a backwards-
    // compatible fallback for a single legacy Meta connection.
    const resolvedApiKey =
      dbApiKey ||
      (provider === 'meta' ? (process.env.WHATSAPP_ACCESS_TOKEN || '') : '');

    return {
      provider,
      baseUrl:  data.provider_base_url ?? data.evolution_base_url,
      apiKey:   resolvedApiKey,
      instanceName: data.instance_name,
      webhookUrl: data.webhook_url,
    };

  } catch (error) {
    defaultLogger.error('Failed to get WhatsApp config:', error);
    return null;
  }
}

/**
 * Get tenant ID by Evolution instance name
 */
export async function getTenantIdByInstanceName(instanceName: string): Promise<string | null> {
  try {
    // Must use admin client — this is called from the public webhook handler
    // where there is no authenticated user and RLS would block the query.
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from('whatsapp_configurations')
      .select('tenant_id')
      .eq('provider', 'evolution')
      .eq('instance_name', instanceName)
      .eq('active', true)
      .single();

    if (error) {
      defaultLogger.error(`[EVOLUTION-CLIENT] Error looking up tenant for instance ${instanceName}:`, error.message);
      return null;
    }

    return data?.tenant_id || null;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unknown error occurred.';
    defaultLogger.error(`[EVOLUTION-CLIENT] Exception during tenant lookup for instance ${instanceName}:`, message);
    return null;
  }
}
export { EvolutionAPIClient as EvolutionClient };
