export interface InteractiveHeader {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  image?: { link: string };
  document?: { link: string; filename?: string };
  video?: { link: string };
}

export interface InteractiveReplyButton {
  id: string;
  title: string;
}

export interface InteractiveButtonMessage {
  type: 'button';
  header?: InteractiveHeader;
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    buttons: Array<{
      type: 'reply';
      reply: InteractiveReplyButton;
    }>;
  };
}

export interface InteractiveListMessage {
  type: 'list';
  header?: InteractiveHeader;
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    button: string;
    sections: Array<{
      title?: string;
      rows: Array<{
        id: string;
        title: string;
        description?: string;
      }>;
    }>;
  };
}

export type InteractiveMessagePayload =
  | InteractiveButtonMessage
  | InteractiveListMessage;

export interface ProviderSendResult {
  success: boolean;
  messageId?: string;
  reason?: string;
}

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
  ): Promise<ProviderSendResult>;
  sendTemplateMessage?(
    to: string,
    templateName: string,
    parameters?: Array<{ default: string }>,
    language?: string
  ): Promise<ProviderSendResult>;
  sendMediaMessage(
    to: string,
    media: { url: string; mimetype: string; filename?: string },
    caption?: string,
    type?: 'image' | 'document' | 'audio' | 'video'
  ): Promise<ProviderSendResult>;
  sendInteractiveMessage(
    to: string,
    payload: InteractiveMessagePayload
  ): Promise<ProviderSendResult>;
}

export interface ProviderConfig {
  provider?: 'evolution' | 'waha' | 'meta' | 'instagram';
  baseUrl: string;
  apiKey: string;
  instanceName: string;
  /**
   * Whose wallet pays for sends made with this config. Set by the tenant config
   * loaders; absent on platform-level configs, which have nobody to bill.
   * getProviderClient meters a client if and only if this is present.
   */
  tenantId?: string;
}
