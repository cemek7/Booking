/**
 * Event Bus Subscribers Index
 * 
 * Centralized registration of all event subscribers
 */

import { EventBusService } from '../eventBus';
import { bookingSubscribers } from './bookingSubscribers';

/**
 * Initialize all event subscribers
 * Call this on application startup
 */
export function initializeEventSubscribers(eventBus: EventBusService): void {
  console.log('[EventBus] Initializing event subscribers...');
  
  // Register booking subscribers
  bookingSubscribers.forEach(handler => {
    eventBus.registerHandler(handler);
  });

  console.log(`[EventBus] Registered ${bookingSubscribers.length} booking event handlers`);
  
  // Start event processing loop
  eventBus.startProcessing().catch(error => {
    console.error('[EventBus] Error starting event processing:', error);
  });
  
  console.log('[EventBus] Event subscribers initialized successfully');
}

/**
 * Get singleton event bus instance
 */
let eventBusInstance: EventBusService | null = null;

export function getEventBusInstance(): EventBusService {
  if (!eventBusInstance) {
    eventBusInstance = new EventBusService({
      batchSize: 50,
      pollingInterval: 2000,
      maxRetries: 5,
      retryBackoffMs: 1000,
      enableDeadLetterQueue: true,
      enableEventSourcing: true
    });
  }
  return eventBusInstance;
}

/**
 * Initialize event bus with subscribers
 * Should be called once on app startup
 */
export function initializeEventBus(): EventBusService {
  const eventBus = getEventBusInstance();
  initializeEventSubscribers(eventBus);
  return eventBus;
}
