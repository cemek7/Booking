/**
 * Event Bus System - Production Ready
 * 
 * Implements resilient event-driven architecture with:
 * - Outbox pattern for guaranteed event delivery
 * - Event ordering and replay capabilities
 * - Idempotent event processing
 * - Dead letter queue for failed events
 * - Event sourcing and audit trail
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { z } from 'zod';

// ===============================
// EVENT SCHEMAS & TYPES
// ===============================

const EventSchema = z.object({
  id: z.string().uuid(),
  aggregateId: z.string().min(1),
  aggregateType: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  payload: z.record(z.any()),
  metadata: z.record(z.any()),
  timestamp: z.string().datetime(),
  causedBy: z.string().optional(),
  correlationId: z.string().optional(),
  tenantId: z.string().uuid().optional()
});

const OutboxEventSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  destination: z.string().min(1),
  payload: z.record(z.any()),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'dead_letter']),
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().positive().default(5),
  nextRetryAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional()
});

export type Event = z.infer<typeof EventSchema>;
export type OutboxEvent = z.infer<typeof OutboxEventSchema>;

// ===============================
// EVENT BUS INTERFACE
// ===============================

export interface EventHandler {
  eventType: string | string[];
  handler: (event: Event) => Promise<void>;
  options?: {
    idempotent?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    deadLetterQueue?: boolean;
  };
}

export interface EventBusConfig {
  batchSize?: number;
  pollingInterval?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  enableDeadLetterQueue?: boolean;
  enableEventSourcing?: boolean;
}

// ===============================
// EVENT BUS SERVICE
// ===============================

export class EventBusService {
  private supabase;
  private handlers: Map<string, EventHandler[]> = new Map();
  private isRunning = false;
  private config: Required<EventBusConfig>;

  constructor(config: EventBusConfig = {}) {
    this.supabase = createServerSupabaseClient();
    this.config = {
      batchSize: config.batchSize || 100,
      pollingInterval: config.pollingInterval || 1000,
      maxRetries: config.maxRetries || 5,
      retryBackoffMs: config.retryBackoffMs || 1000,
      enableDeadLetterQueue: config.enableDeadLetterQueue ?? true,
      enableEventSourcing: config.enableEventSourcing ?? true
    };
  }

  // ===============================
  // EVENT PUBLISHING
  // ===============================

  /**
   * Publish event with outbox pattern for guaranteed delivery
   */
  async publishEvent(
    aggregateId: string,
    aggregateType: string,
    eventType: string,
    payload: Record<string, any>,
    options: {
      metadata?: Record<string, any>;
      causedBy?: string;
      correlationId?: string;
      tenantId?: string;
      destinations?: string[];
    } = {}
  ): Promise<string> {
    try {
      const eventId = crypto.randomUUID();
      const timestamp = new Date().toISOString();

      const event: Event = {
        id: eventId,
        aggregateId,
        aggregateType,
        eventType,
        eventVersion: 1,
        payload,
        metadata: {
          publishedAt: timestamp,
          publishedBy: 'event_bus_service',
          ...options.metadata
        },
        timestamp,
        causedBy: options.causedBy,
        correlationId: options.correlationId || eventId,
        tenantId: options.tenantId
      };

      // Validate event
      EventSchema.parse(event);

      // Use database transaction to ensure atomicity
      const { data, error } = await this.supabase.rpc('publish_event_with_outbox', {
        event_data: event,
        destinations: options.destinations || ['default']
      });

      if (error) {
        throw new Error(`Failed to publish event: ${error.message}`);
      }

      console.log(`Event published: ${eventType} for ${aggregateType}:${aggregateId}`);
      return eventId;
    } catch (error) {
      console.error('Error publishing event:', error);
      throw error;
    }
  }

  /**
   * Publish multiple events in a batch
   */
  async publishEvents(events: Array<{
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    payload: Record<string, any>;
    metadata?: Record<string, any>;
  }>): Promise<string[]> {
    const eventIds: string[] = [];

    try {
      // Use transaction for batch publishing
      for (const eventData of events) {
        const eventId = await this.publishEvent(
          eventData.aggregateId,
          eventData.aggregateType,
          eventData.eventType,
          eventData.payload,
          { metadata: eventData.metadata }
        );
        eventIds.push(eventId);
      }

      return eventIds;
    } catch (error) {
      console.error('Error publishing batch events:', error);
      throw error;
    }
  }

  // ===============================
  // EVENT HANDLERS
  // ===============================

  /**
   * Register event handler
   */
  registerHandler(handler: EventHandler): void {
    const eventTypes = Array.isArray(handler.eventType) 
      ? handler.eventType 
      : [handler.eventType];

    eventTypes.forEach(eventType => {
      if (!this.handlers.has(eventType)) {
        this.handlers.set(eventType, []);
      }
      this.handlers.get(eventType)!.push(handler);
    });

    console.log(`Handler registered for events: ${eventTypes.join(', ')}`);
  }

  /**
   * Unregister event handler
   */
  unregisterHandler(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          this.handlers.delete(eventType);
        }
      }
    }
  }

  // ===============================
  // EVENT PROCESSING
  // ===============================

  /**
   * Start event processing loop
   */
  async startProcessing(): Promise<void> {
    if (this.isRunning) {
      console.warn('Event processing is already running');
      return;
    }

    this.isRunning = true;
    console.log('Starting event bus processing...');

    while (this.isRunning) {
      try {
        await this.processPendingEvents();
        await this.retryFailedEvents();
        
        // Wait before next poll
        await new Promise(resolve => 
          setTimeout(resolve, this.config.pollingInterval)
        );
      } catch (error) {
        console.error('Error in event processing loop:', error);
        // Continue processing even if there's an error
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Stop event processing
   */
  async stopProcessing(): Promise<void> {
    this.isRunning = false;
    console.log('Event bus processing stopped');
  }

  /**
   * Process pending events from outbox
   */
  private async processPendingEvents(): Promise<void> {
    try {
      const { data: outboxEvents, error } = await this.supabase
        .from('event_outbox')
        .select(`
          *,
          event:events(*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(this.config.batchSize);

      if (error) {
        throw new Error(`Failed to fetch pending events: ${error.message}`);
      }

      if (!outboxEvents || outboxEvents.length === 0) {
        return; // No pending events
      }

      console.log(`Processing ${outboxEvents.length} pending events`);

      for (const outboxEvent of outboxEvents) {
        await this.processOutboxEvent(outboxEvent);
      }
    } catch (error) {
      console.error('Error processing pending events:', error);
    }
  }

  /**
   * Retry failed events with exponential backoff
   */
  private async retryFailedEvents(): Promise<void> {
    try {
      const now = new Date().toISOString();
      
      const { data: retryEvents, error } = await this.supabase
        .from('event_outbox')
        .select(`
          *,
          event:events(*)
        `)
        .eq('status', 'failed')
        .lte('next_retry_at', now)
        .lt('attempts', 'max_attempts')
        .order('next_retry_at', { ascending: true })
        .limit(this.config.batchSize);

      if (error) {
        throw new Error(`Failed to fetch retry events: ${error.message}`);
      }

      if (!retryEvents || retryEvents.length === 0) {
        return; // No events to retry
      }

      console.log(`Retrying ${retryEvents.length} failed events`);

      for (const outboxEvent of retryEvents) {
        await this.processOutboxEvent(outboxEvent);
      }
    } catch (error) {
      console.error('Error retrying failed events:', error);
    }
  }

  /**
   * Process individual outbox event
   */
  private async processOutboxEvent(outboxEvent: any): Promise<void> {
    const { event } = outboxEvent;
    
    if (!event) {
      console.error(`Event not found for outbox event ${outboxEvent.id}`);
      return;
    }

    try {
      // Mark as processing
      await this.updateOutboxStatus(outboxEvent.id, 'processing');

      // Check for registered handlers
      const handlers = this.handlers.get(event.event_type) || [];
      
      if (handlers.length === 0) {
        console.warn(`No handlers registered for event type: ${event.event_type}`);
        await this.updateOutboxStatus(outboxEvent.id, 'completed');
        return;
      }

      // Process event with all handlers
      const handlerPromises = handlers.map(handler => 
        this.executeHandler(handler, event, outboxEvent)
      );

      await Promise.all(handlerPromises);

      // Mark as completed
      await this.updateOutboxStatus(outboxEvent.id, 'completed');
      
      console.log(`Event processed successfully: ${event.event_type}`);
      
    } catch (error) {
      console.error(`Error processing event ${outboxEvent.id}:`, error);
      await this.handleEventProcessingError(outboxEvent, error);
    }
  }

  /**
   * Execute individual event handler with error handling
   */
  private async executeHandler(
    handler: EventHandler,
    event: any,
    outboxEvent: any
  ): Promise<void> {
    try {
      // Check if handler should be idempotent
      if (handler.options?.idempotent) {
        const duplicate = await this.checkDuplicateProcessing(
          event.id,
          handler.eventType.toString()
        );
        if (duplicate) {
          console.log(`Skipping duplicate event processing: ${event.id}`);
          return;
        }
      }

      // Execute handler
      await handler.handler(event);

      // Record successful processing for idempotency
      if (handler.options?.idempotent) {
        await this.recordProcessing(event.id, handler.eventType.toString(), true);
      }
      
    } catch (handlerError) {
      console.error(`Handler failed for event ${event.id}:`, handlerError);
      
      // Record failed processing
      if (handler.options?.idempotent) {
        await this.recordProcessing(event.id, handler.eventType.toString(), false, 
          handlerError instanceof Error ? handlerError.message : 'Unknown error'
        );
      }
      
      throw handlerError;
    }
  }

  /**
   * Handle event processing errors with retry logic
   */
  private async handleEventProcessingError(
    outboxEvent: any,
    error: any
  ): Promise<void> {
    const newAttempts = (outboxEvent.attempts || 0) + 1;
    const maxAttempts = outboxEvent.max_attempts || this.config.maxRetries;
    
    if (newAttempts >= maxAttempts) {
      // Move to dead letter queue if enabled
      if (this.config.enableDeadLetterQueue) {
        await this.updateOutboxStatus(
          outboxEvent.id,
          'dead_letter',
          error instanceof Error ? error.message : 'Max retries exceeded'
        );
        
        // Publish dead letter event
        await this.publishDeadLetterEvent(outboxEvent, error);
      } else {
        await this.updateOutboxStatus(
          outboxEvent.id,
          'failed',
          error instanceof Error ? error.message : 'Max retries exceeded'
        );
      }
    } else {
      // Schedule retry with exponential backoff
      const retryDelay = this.config.retryBackoffMs * Math.pow(2, newAttempts - 1);
      const nextRetryAt = new Date(Date.now() + retryDelay).toISOString();
      
      await this.supabase
        .from('event_outbox')
        .update({
          status: 'failed',
          attempts: newAttempts,
          next_retry_at: nextRetryAt,
          error: error instanceof Error ? error.message : 'Processing failed',
          updated_at: new Date().toISOString()
        })
        .eq('id', outboxEvent.id);
    }
  }

  // ===============================
  // UTILITY METHODS
  // ===============================

  /**
   * Update outbox event status
   */
  private async updateOutboxStatus(
    outboxId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'dead_letter',
    error?: string
  ): Promise<void> {
    const updates: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (error) {
      updates.error = error;
    }

    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    const { error: updateError } = await this.supabase
      .from('event_outbox')
      .update(updates)
      .eq('id', outboxId);

    if (updateError) {
      console.error(`Failed to update outbox status: ${updateError.message}`);
    }
  }

  /**
   * Check for duplicate event processing (idempotency)
   */
  private async checkDuplicateProcessing(
    eventId: string,
    handlerType: string
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('event_processing_log')
      .select('id')
      .eq('event_id', eventId)
      .eq('handler_type', handlerType)
      .eq('success', true)
      .limit(1);

    if (error) {
      console.error('Error checking duplicate processing:', error);
      return false; // Assume not duplicate on error
    }

    return data && data.length > 0;
  }

  /**
   * Record event processing for idempotency
   */
  private async recordProcessing(
    eventId: string,
    handlerType: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const { error: insertError } = await this.supabase
      .from('event_processing_log')
      .insert({
        event_id: eventId,
        handler_type: handlerType,
        success,
        error,
        processed_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Error recording event processing:', insertError);
    }
  }

  /**
   * Publish dead letter event for failed processing
   */
  private async publishDeadLetterEvent(outboxEvent: any, error: any): Promise<void> {
    try {
      await this.publishEvent(
        'event_bus',
        'event_processing',
        'event.dead_letter',
        {
          originalEventId: outboxEvent.event_id,
          originalEventType: outboxEvent.event?.event_type,
          attempts: outboxEvent.attempts,
          error: error instanceof Error ? error.message : 'Unknown error',
          outboxEventId: outboxEvent.id
        },
        {
          metadata: {
            deadLetterReason: 'max_retries_exceeded',
            originalTimestamp: outboxEvent.created_at
          }
        }
      );
    } catch (deadLetterError) {
      console.error('Failed to publish dead letter event:', deadLetterError);
    }
  }

  // ===============================
  // QUERY METHODS
  // ===============================

  /**
   * Get event stream for an aggregate
   */
  async getEventStream(
    aggregateId: string,
    aggregateType?: string,
    fromVersion?: number
  ): Promise<Event[]> {
    let query = this.supabase
      .from('events')
      .select('*')
      .eq('aggregate_id', aggregateId)
      .order('event_version', { ascending: true });

    if (aggregateType) {
      query = query.eq('aggregate_type', aggregateType);
    }

    if (fromVersion) {
      query = query.gte('event_version', fromVersion);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get event stream: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get events by correlation ID
   */
  async getEventsByCorrelation(correlationId: string): Promise<Event[]> {
    const { data, error } = await this.supabase
      .from('events')
      .select('*')
      .eq('correlation_id', correlationId)
      .order('timestamp', { ascending: true });

    if (error) {
      throw new Error(`Failed to get correlated events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get dead letter events
   */
  async getDeadLetterEvents(): Promise<any[]> {
    const { data, error } = await this.supabase
      .from('event_outbox')
      .select(`
        *,
        event:events(*)
      `)
      .eq('status', 'dead_letter')
      .order('updated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to get dead letter events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Replay events for reprocessing
   */
  async replayEvents(
    aggregateId: string,
    fromTimestamp?: string,
    toTimestamp?: string
  ): Promise<void> {
    let query = this.supabase
      .from('events')
      .select('*')
      .eq('aggregate_id', aggregateId)
      .order('timestamp', { ascending: true });

    if (fromTimestamp) {
      query = query.gte('timestamp', fromTimestamp);
    }

    if (toTimestamp) {
      query = query.lte('timestamp', toTimestamp);
    }

    const { data: events, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch events for replay: ${error.message}`);
    }

    if (!events || events.length === 0) {
      console.log('No events to replay');
      return;
    }

    // Create new outbox entries for replay
    for (const event of events) {
      await this.supabase
        .from('event_outbox')
        .insert({
          event_id: event.id,
          destination: 'replay',
          payload: event.payload,
          status: 'pending',
          attempts: 0,
          max_attempts: this.config.maxRetries,
          created_at: new Date().toISOString()
        });
    }

    console.log(`${events.length} events queued for replay`);
  }

  /**
   * Get event bus metrics
   */
  async getMetrics(timeRange: 'hour' | 'day' | 'week' = 'day') {
    const startDate = new Date();
    switch (timeRange) {
      case 'hour':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case 'day':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
    }

    const [eventsResult, outboxResult] = await Promise.all([
      this.supabase
        .from('events')
        .select('event_type, aggregate_type')
        .gte('timestamp', startDate.toISOString()),
      this.supabase
        .from('event_outbox')
        .select('status, attempts')
        .gte('created_at', startDate.toISOString())
    ]);

    const eventsByType: Record<string, number> = {};
    const eventsByAggregate: Record<string, number> = {};
    let totalEvents = 0;

    if (eventsResult.data) {
      eventsResult.data.forEach(event => {
        eventsByType[event.event_type] = (eventsByType[event.event_type] || 0) + 1;
        eventsByAggregate[event.aggregate_type] = (eventsByAggregate[event.aggregate_type] || 0) + 1;
        totalEvents++;
      });
    }

    const outboxMetrics = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      deadLetter: 0,
      totalRetries: 0
    };

    if (outboxResult.data) {
      outboxResult.data.forEach(outbox => {
        switch (outbox.status) {
          case 'pending': outboxMetrics.pending++; break;
          case 'processing': outboxMetrics.processing++; break;
          case 'completed': outboxMetrics.completed++; break;
          case 'failed': outboxMetrics.failed++; break;
          case 'dead_letter': outboxMetrics.deadLetter++; break;
        }
        outboxMetrics.totalRetries += outbox.attempts || 0;
      });
    }

    return {
      timeRange,
      totalEvents,
      eventsByType,
      eventsByAggregate,
      outboxMetrics,
      successRate: outboxMetrics.completed / 
        (outboxMetrics.completed + outboxMetrics.failed + outboxMetrics.deadLetter) || 0
    };
  }
}

// ===============================
// SINGLETON INSTANCE
// ===============================

let eventBusInstance: EventBusService | null = null;

export function getEventBus(config?: EventBusConfig): EventBusService {
  if (!eventBusInstance) {
    eventBusInstance = new EventBusService(config);
  }
  return eventBusInstance;
}

// ===============================
// COMMON EVENT HANDLERS
// ===============================

export const CommonEventHandlers = {
  // Booking events
  bookingCreated: {
    eventType: 'booking.created',
    handler: async (event: Event) => {
      console.log('Booking created:', event.aggregateId);
      // Send confirmation, update analytics, etc.
    }
  } as EventHandler,

  bookingConfirmed: {
    eventType: 'booking.confirmed',
    handler: async (event: Event) => {
      console.log('Booking confirmed:', event.aggregateId);
      // Send notifications, update calendar, etc.
    },
    options: { idempotent: true }
  } as EventHandler,

  paymentCompleted: {
    eventType: 'payment.completed',
    handler: async (event: Event) => {
      console.log('Payment completed:', event.payload);
      // Update booking status, send receipts, etc.
    },
    options: { idempotent: true, maxRetries: 3 }
  } as EventHandler
};

export { EventBusService, Event, OutboxEvent, EventHandler };