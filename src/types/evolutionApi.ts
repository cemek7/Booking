/**
 * Evolution API Type Definitions
 * 
 * Complete type definitions for Evolution API responses, webhook payloads,
 * and WhatsApp integration interfaces.
 */

// Base Evolution API response structure
export interface EvolutionApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  statusCode?: number;
}

// Evolution API instance information
export interface EvolutionInstance {
  instanceName: string;
  status: 'open' | 'close' | 'connecting' | 'qrcode';
  qrcode?: string;
  webhookUrl?: string;
  webhookEvents?: string[];
  token?: string;
  profilePictureUrl?: string;
  displayName?: string;
  phoneNumber?: string;
}

// WhatsApp message types
export type WhatsAppMessageType = 
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'template';

// Base message interface
export interface WhatsAppMessage {
  id?: string;
  type: WhatsAppMessageType;
  timestamp?: number;
  from: string;
  to: string;
  body?: string;
  caption?: string;
  quoted?: QuotedMessage;
  contextInfo?: ContextInfo;
}

// Text message
export interface TextMessage extends WhatsAppMessage {
  type: 'text';
  body: string;
}

// Media message base
export interface MediaMessage extends WhatsAppMessage {
  mediaType: string;
  fileName?: string;
  fileSize?: number;
  mediaUrl?: string;
  mediaBase64?: string;
  caption?: string;
}

// Image message
export interface ImageMessage extends MediaMessage {
  type: 'image';
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

// Interactive message (buttons, lists)
export interface InteractiveMessage extends WhatsAppMessage {
  type: 'interactive';
  interactive: {
    type: 'button' | 'list';
    header?: InteractiveHeader;
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: ButtonAction | ListAction;
  };
}

export interface InteractiveHeader {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  image?: MediaObject;
  document?: MediaObject;
  video?: MediaObject;
}

export interface ButtonAction {
  buttons: Array<{
    type: 'reply';
    reply: {
      id: string;
      title: string;
    };
  }>;
}

export interface ListAction {
  button: string;
  sections: Array<{
    title?: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}

export interface MediaObject {
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

// Template message
export interface TemplateMessage extends WhatsAppMessage {
  type: 'template';
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: TemplateComponent[];
  };
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'footer' | 'button';
  parameters?: TemplateParameter[];
  sub_type?: 'quick_reply' | 'url';
  index?: number;
}

export interface TemplateParameter {
  type: 'text' | 'image' | 'document' | 'video';
  text?: string;
  image?: MediaObject;
  document?: MediaObject;
  video?: MediaObject;
}

// Quoted message
export interface QuotedMessage {
  id: string;
  type: WhatsAppMessageType;
  body?: string;
  participant?: string;
}

// Context information
export interface ContextInfo {
  stanzaId?: string;
  participant?: string;
  quotedMessage?: QuotedMessage;
}

// Webhook event types
export type EvolutionWebhookEvent = 
  | 'messages.upsert'
  | 'messages.update'
  | 'messages.delete'
  | 'send.message'
  | 'connection.update'
  | 'presence.update'
  | 'chats.upsert'
  | 'chats.update'
  | 'chats.delete'
  | 'contacts.upsert'
  | 'contacts.update'
  | 'groups.upsert'
  | 'groups.update'
  | 'call'
  | 'typebot.start'
  | 'typebot.change-status';

// Webhook payload structure
export interface EvolutionWebhookPayload {
  event: EvolutionWebhookEvent;
  instance: string;
  data: WebhookEventData;
  destination?: string;
  date_time: string;
  sender?: string;
  server_url?: string;
}

// Webhook event data union type
export type WebhookEventData = 
  | MessageEventData
  | ConnectionEventData
  | PresenceEventData
  | ChatEventData
  | ContactEventData
  | GroupEventData
  | CallEventData;

// Message event data
export interface MessageEventData {
  key: MessageKey;
  pushName?: string;
  message?: WhatsAppMessage;
  messageType: WhatsAppMessageType;
  instanceId?: string;
  source?: string;
}

export interface MessageKey {
  id: string;
  fromMe: boolean;
  remoteJid: string;
  participant?: string;
}

// Connection event data
export interface ConnectionEventData {
  state: 'open' | 'close' | 'connecting';
  statusReason?: number;
  qrcode?: {
    pairingCode?: string;
    code?: string;
    base64?: string;
  };
}

// Presence event data
export interface PresenceEventData {
  id: string;
  presences: Record<string, {
    lastKnownPresence: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';
    lastSeen?: number;
  }>;
}

// Chat event data
export interface ChatEventData {
  id: string;
  name?: string;
  unreadCount?: number;
  conversationTimestamp?: number;
  archived?: boolean;
  pinned?: boolean;
}

// Contact event data
export interface ContactEventData {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  imgUrl?: string;
  status?: string;
}

// Group event data
export interface GroupEventData {
  id: string;
  subject?: string;
  subjectOwner?: string;
  subjectTime?: number;
  creation?: number;
  owner?: string;
  desc?: string;
  descOwner?: string;
  descId?: string;
  restrict?: boolean;
  announce?: boolean;
  size?: number;
  participants?: GroupParticipant[];
}

export interface GroupParticipant {
  id: string;
  admin?: 'admin' | 'superadmin';
}

// Call event data
export interface CallEventData {
  id: string;
  from: string;
  timestamp: number;
  status: 'ringing' | 'offer';
}

// Evolution API client configuration
export interface EvolutionClientConfig {
  baseURL: string;
  apiKey: string;
  instanceName: string;
  webhookUrl?: string;
  webhookSecret?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
}

// Message sending options
export interface SendMessageOptions {
  delay?: number;
  presence?: 'composing' | 'recording' | 'paused';
  quoted?: string; // Message ID to quote
  mentions?: string[]; // User IDs to mention
  linkPreview?: boolean;
}

// Instance management operations
export interface CreateInstanceRequest {
  instanceName: string;
  token?: string;
  qrcode?: boolean;
  integration?: 'WHATSAPP-BAILEYS' | 'WHATSAPP-BUSINESS';
  webhookUrl?: string;
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  webhookEvents?: EvolutionWebhookEvent[];
}

export interface InstanceInfo {
  instance: EvolutionInstance;
  hash?: {
    apikey: string;
  };
  webhook?: {
    webhook: string;
    events: string[];
  };
  websocket?: {
    enabled: boolean;
    events: string[];
  };
  rabbitmq?: {
    enabled: boolean;
    events: string[];
  };
  sqs?: {
    enabled: boolean;
    events: string[];
  };
  typebot?: {
    enabled: boolean;
    url: string;
    typebot: string;
    expire: number;
    keyword_finish: string;
    delay_message: number;
    unknown_message: string;
    listening_from_me: boolean;
  };
}

// Message status and delivery
export interface MessageStatus {
  id: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  error?: string;
}

// Chat/Contact information
export interface ChatInfo {
  id: string;
  name?: string;
  profilePictureUrl?: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessage?: {
    id: string;
    body: string;
    timestamp: number;
    fromMe: boolean;
  };
}

// Group management
export interface GroupInfo extends ChatInfo {
  isGroup: true;
  subject: string;
  description?: string;
  owner: string;
  participants: GroupParticipant[];
  creation: number;
  isAnnounce: boolean;
  isRestrict: boolean;
}

// Booking context for Evolution integration
export interface BookingContext {
  bookingId?: string;
  tenantId: string;
  customerId?: string;
  serviceId?: string;
  staffId?: string;
  scheduledDateTime?: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  notifications: {
    confirmation: boolean;
    reminder24h: boolean;
    reminder1h: boolean;
    reminder15m: boolean;
  };
}

// Evolution API error types
export interface EvolutionApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  statusCode: number;
}

// Utility types for type guards
export function isTextMessage(message: WhatsAppMessage): message is TextMessage {
  return message.type === 'text';
}

export function isInteractiveMessage(message: WhatsAppMessage): message is InteractiveMessage {
  return message.type === 'interactive';
}

export function isMediaMessage(message: WhatsAppMessage): message is MediaMessage {
  return ['image', 'video', 'audio', 'document'].includes(message.type);
}

export function isTemplateMessage(message: WhatsAppMessage): message is TemplateMessage {
  return message.type === 'template';
}