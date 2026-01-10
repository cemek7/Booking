/**
 * Booking Flow Type Definitions
 * 
 * Complete type definitions for WhatsApp booking conversations,
 * state management, and notification flows.
 */

import { WhatsAppMessage, BookingContext } from './evolutionApi';

// Conversation state types
export type ConversationState = 
  | 'greeting'
  | 'service_selection'
  | 'date_time'
  | 'confirmation'
  | 'completed'
  | 'cancelled'
  | 'error';

// Booking flow context
export interface BookingFlowContext {
  // User identification
  phone: string;
  customerId?: string;
  customerName?: string;
  
  // Conversation metadata
  conversationId: string;
  sessionId?: string;
  state: ConversationState;
  startedAt: string;
  lastMessageAt: string;
  
  // Booking details
  tenantId?: string;
  selectedService?: ServiceSelection;
  selectedDateTime?: DateTimeSelection;
  selectedStaff?: StaffSelection;
  bookingId?: string;
  
  // Flow control
  retryCount: number;
  maxRetries: number;
  errorMessage?: string;
  metadata: Record<string, any>;
}

// Service selection
export interface ServiceSelection {
  serviceId: string;
  serviceName: string;
  duration: number; // minutes
  price: number;
  description?: string;
  category?: string;
}

// Date/time selection
export interface DateTimeSelection {
  date: string; // YYYY-MM-DD format
  time: string; // HH:mm format
  timezone?: string;
  originalInput: string; // User's original text input
  parsedAt: string;
  isValidated: boolean;
}

// Staff selection
export interface StaffSelection {
  staffId: string;
  staffName: string;
  specialties?: string[];
  availability?: TimeSlot[];
  preferredBy?: 'customer' | 'system' | 'auto';
}

// Time slot availability
export interface TimeSlot {
  start: string; // ISO datetime
  end: string; // ISO datetime
  available: boolean;
  staffId?: string;
  reason?: string; // if not available
}

// Conversation message with booking context
export interface BookingMessage extends WhatsAppMessage {
  conversationId: string;
  state: ConversationState;
  intent?: MessageIntent;
  entities?: ExtractedEntity[];
  context?: Partial<BookingFlowContext>;
  processedAt: string;
}

// Message intent classification
export type MessageIntent = 
  | 'book_appointment'
  | 'select_service'
  | 'select_date_time'
  | 'confirm_booking'
  | 'cancel_booking'
  | 'reschedule_booking'
  | 'inquiry'
  | 'greeting'
  | 'goodbye'
  | 'help'
  | 'unknown';

// Extracted entities from messages
export interface ExtractedEntity {
  type: EntityType;
  value: string;
  confidence: number;
  startIndex: number;
  endIndex: number;
  metadata?: Record<string, any>;
}

export type EntityType = 
  | 'service_name'
  | 'date'
  | 'time'
  | 'staff_name'
  | 'phone_number'
  | 'email'
  | 'name'
  | 'duration'
  | 'price';

// Conversation flow configuration
export interface ConversationFlowConfig {
  tenantId: string;
  flowId: string;
  name: string;
  description: string;
  isActive: boolean;
  
  // Flow steps configuration
  steps: FlowStep[];
  
  // Behavior settings
  timeoutMinutes: number;
  maxRetries: number;
  fallbackMessage: string;
  
  // Integration settings
  webhookUrl?: string;
  notificationSettings: NotificationSettings;
  
  // AI/NLP settings
  aiProvider?: 'openrouter' | 'openai' | 'anthropic';
  aiModel?: string;
  intentThreshold: number;
  entityThreshold: number;
}

// Individual flow step
export interface FlowStep {
  id: string;
  state: ConversationState;
  name: string;
  description: string;
  
  // Step behavior
  prompt: string;
  expectedInputs: string[];
  validationRules: ValidationRule[];
  
  // Navigation
  nextStep?: string;
  errorStep?: string;
  conditions?: StepCondition[];
  
  // Actions
  actions: StepAction[];
}

// Validation rules for user inputs
export interface ValidationRule {
  type: 'required' | 'format' | 'range' | 'custom';
  message: string;
  config: Record<string, any>;
}

// Conditions for step navigation
export interface StepCondition {
  field: string;
  operator: 'equals' | 'contains' | 'greater' | 'less' | 'exists';
  value: any;
  nextStep: string;
}

// Actions to execute during steps
export interface StepAction {
  type: 'send_message' | 'create_booking' | 'send_notification' | 'update_context' | 'call_webhook';
  config: Record<string, any>;
  condition?: StepCondition;
}

// Notification settings for booking flow
export interface NotificationSettings {
  confirmationEnabled: boolean;
  reminderEnabled: boolean;
  reminderTimes: number[]; // minutes before appointment
  cancellationEnabled: boolean;
  updateEnabled: boolean;
  
  // Templates
  templates: {
    confirmation: string;
    reminder: string;
    cancellation: string;
    update: string;
  };
}

// Booking flow response
export interface BookingFlowResponse {
  success: boolean;
  state: ConversationState;
  reply?: string;
  context?: Partial<BookingFlowContext>;
  actions?: FlowAction[];
  error?: string;
  nextStep?: string;
}

// Flow actions to be executed
export interface FlowAction {
  type: 'send_message' | 'create_booking' | 'schedule_notification' | 'update_database';
  payload: Record<string, any>;
  delay?: number; // seconds
  retryConfig?: {
    maxRetries: number;
    backoffSeconds: number;
  };
}

// Message processing result
export interface MessageProcessingResult {
  conversationId: string;
  messageId: string;
  intent: MessageIntent;
  entities: ExtractedEntity[];
  confidence: number;
  response: BookingFlowResponse;
  processingTime: number;
  error?: string;
}

// Conversation analytics
export interface ConversationAnalytics {
  conversationId: string;
  tenantId: string;
  
  // Timing metrics
  startTime: string;
  endTime?: string;
  duration?: number; // seconds
  
  // Message metrics
  totalMessages: number;
  customerMessages: number;
  botMessages: number;
  
  // Flow metrics
  completionRate: number;
  dropoffStep?: ConversationState;
  successfulBooking: boolean;
  
  // Quality metrics
  intentRecognitionAccuracy: number;
  customerSatisfaction?: number;
  escalatedToHuman: boolean;
}

// Booking notification types
export type BookingNotificationType = 
  | 'confirmation'
  | 'reminder'
  | 'cancellation'
  | 'reschedule'
  | 'update'
  | 'custom';

// Booking notification
export interface BookingNotification {
  id: string;
  bookingId: string;
  tenantId: string;
  
  // Notification details
  type: BookingNotificationType;
  channel: 'whatsapp' | 'sms' | 'email';
  recipient: string;
  
  // Content
  message: string;
  templateName?: string;
  templateVariables?: Record<string, any>;
  
  // Scheduling
  scheduledFor: string;
  sentAt?: string;
  
  // Status
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  error?: string;
  retryCount: number;
  
  // Metadata
  createdAt: string;
  metadata: Record<string, any>;
}

// Scheduled notification
export interface ScheduledNotification {
  id: string;
  bookingId: string;
  tenantId: string;
  notificationId: string;
  
  // Trigger configuration
  triggerType: 'booking_created' | 'reminder_24h' | 'reminder_1h' | 'reminder_15m' | 'custom';
  scheduledFor: string;
  executedAt?: string;
  
  // Status
  status: 'pending' | 'executed' | 'cancelled';
  
  // Configuration
  config: Record<string, any>;
}

// Date/time parsing utilities
export interface DateTimeParser {
  parseNaturalLanguage(input: string, timezone?: string): ParsedDateTime | null;
  validateDateTime(dateTime: ParsedDateTime, businessHours?: BusinessHours): ValidationResult;
  suggestAlternatives(invalidDateTime: ParsedDateTime, businessHours?: BusinessHours): DateTimeSelection[];
}

export interface ParsedDateTime {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  timezone: string;
  confidence: number;
  originalInput: string;
  interpretations?: DateTimeInterpretation[];
}

export interface DateTimeInterpretation {
  date: string;
  time: string;
  confidence: number;
  reasoning: string;
}

export interface BusinessHours {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
  holidays: string[]; // YYYY-MM-DD dates
  timezone: string;
}

export interface DaySchedule {
  open: boolean;
  hours?: {
    open: string; // HH:mm
    close: string; // HH:mm
  }[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  suggestedTime?: string;
  availableSlots?: TimeSlot[];
}

// Service availability
export interface ServiceAvailability {
  serviceId: string;
  date: string; // YYYY-MM-DD
  slots: TimeSlot[];
  staffAvailability: StaffAvailabilitySlot[];
}

export interface StaffAvailabilitySlot {
  staffId: string;
  staffName: string;
  slots: TimeSlot[];
  workingHours: DaySchedule;
}

// Utility functions
export function createBookingContext(
  phone: string,
  tenantId?: string
): BookingFlowContext {
  return {
    phone,
    customerId: undefined,
    customerName: undefined,
    conversationId: `conv_${Date.now()}_${phone.replace(/\D/g, '')}`,
    sessionId: undefined,
    state: 'greeting',
    startedAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString(),
    tenantId,
    selectedService: undefined,
    selectedDateTime: undefined,
    selectedStaff: undefined,
    bookingId: undefined,
    retryCount: 0,
    maxRetries: 3,
    errorMessage: undefined,
    metadata: {}
  };
}

export function transitionState(
  context: BookingFlowContext,
  newState: ConversationState,
  metadata?: Record<string, any>
): BookingFlowContext {
  return {
    ...context,
    state: newState,
    lastMessageAt: new Date().toISOString(),
    metadata: {
      ...context.metadata,
      ...metadata,
      stateHistory: [
        ...(context.metadata.stateHistory || []),
        {
          from: context.state,
          to: newState,
          timestamp: new Date().toISOString()
        }
      ]
    }
  };
}

export function isValidTransition(
  from: ConversationState,
  to: ConversationState
): boolean {
  const validTransitions: Record<ConversationState, ConversationState[]> = {
    greeting: ['service_selection', 'cancelled'],
    service_selection: ['date_time', 'greeting', 'cancelled'],
    date_time: ['confirmation', 'service_selection', 'cancelled'],
    confirmation: ['completed', 'date_time', 'cancelled'],
    completed: ['greeting'], // Allow restart
    cancelled: ['greeting'], // Allow restart
    error: ['greeting', 'service_selection', 'date_time', 'confirmation'] // Recovery
  };
  
  return validTransitions[from]?.includes(to) || false;
}

// Export all types
export type {
  ConversationState,
  BookingFlowContext,
  ServiceSelection,
  DateTimeSelection,
  StaffSelection,
  TimeSlot,
  BookingMessage,
  MessageIntent,
  ExtractedEntity,
  EntityType,
  ConversationFlowConfig,
  FlowStep,
  ValidationRule,
  StepCondition,
  StepAction,
  NotificationSettings,
  BookingFlowResponse,
  FlowAction,
  MessageProcessingResult,
  ConversationAnalytics,
  BookingNotificationType,
  BookingNotification,
  ScheduledNotification,
  DateTimeParser,
  ParsedDateTime,
  BusinessHours,
  ValidationResult,
  ServiceAvailability,
  StaffAvailabilitySlot
};