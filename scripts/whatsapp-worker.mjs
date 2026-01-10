#!/usr/bin/env node

/**
 * WhatsApp Message Processor Worker
 * 
 * This worker processes queued WhatsApp messages asynchronously to maintain
 * fast webhook response times while providing comprehensive message handling.
 * 
 * Features:
 * - High-volume message processing with queue management
 * - Media handling (images, documents, audio, video)
 * - Template message support with Business API integration
 * - Conversation state management and persistence
 * - Integration with dialog-booking bridge for intelligent responses
 * - Automatic retry logic with exponential backoff
 * - Real-time monitoring and health checks
 */

import { startWhatsAppProcessor, stopWhatsAppProcessor } from '../src/lib/whatsapp/messageProcessor.js';
import { whatsappTemplateManager } from '../src/lib/whatsapp/templateManager.js';

let isShuttingDown = false;

async function startWorker() {
  console.log('🚀 Starting WhatsApp Message Processor Worker...');
  
  try {
    // Start the message processor
    await startWhatsAppProcessor();
    
    console.log('✅ WhatsApp Message Processor Worker started successfully');
    console.log('📱 Ready to process WhatsApp messages...');
    
    // Health check endpoint (if running as service)
    if (process.env.WORKER_HEALTH_PORT) {
      const port = parseInt(process.env.WORKER_HEALTH_PORT);
      const { createServer } = require('http');
      
      const server = createServer((req, res) => {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date().toISOString()
          }));
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });
      
      server.listen(port, () => {
        console.log(`🏥 Health check server listening on port ${port}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Failed to start WhatsApp Message Processor Worker:', error);
    process.exit(1);
  }
}

async function gracefulShutdown() {
  if (isShuttingDown) {
    console.log('⚠️ Force shutdown requested');
    process.exit(1);
  }
  
  isShuttingDown = true;
  console.log('🛑 Graceful shutdown initiated...');
  
  try {
    // Stop the message processor
    stopWhatsAppProcessor();
    
    console.log('✅ WhatsApp Message Processor Worker stopped gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('SIGQUIT', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚫 Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Start the worker
startWorker().catch((error) => {
  console.error('💥 Fatal error starting worker:', error);
  process.exit(1);
});

// Export for testing
export { startWorker, gracefulShutdown };