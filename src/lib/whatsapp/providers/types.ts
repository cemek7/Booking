export interface WhatsAppProviderClient {
  // Session management
  createInstance(webhookUrl: string, webhookSecret: string): Promise<{
    qrCode?: string;
    pairingCode?: string;
    status: string;
  }>;
  getConnectionStatus(): Promise<{ connected: boolean; phone?: string }>;
  getQrCode(): Promise<string | null>;
  requestPairingCode(phoneNumber: string): Promise<string | null>;
  deleteInstance(): Promise<void>;

  // Message sending
  sendTextMessage(
    to: string,
    text: string,
    quotedMessageId?: string
  ): Promise<{ success: boolean; messageId?: string }>;
  sendTemplateMessage?(
    to: string,
    templateName: string,
    parameters?: Array<{ default: string }>,
    language?: string
  ): Promise<{ success: boolean; messageId?: string }>;
  sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type?: 'image' | 'document' | 'audio' | 'video'
  ): Promise<{ success: boolean; messageId?: string }>;
}

export interface ProviderConfig {
  provider?: 'evolution' | 'waha' | 'meta' | 'instagram';
  baseUrl: string;
  apiKey: string;
  instanceName: string;
}
