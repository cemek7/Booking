#!/usr/bin/env node

/**
 * Enhanced Job Worker
 * 
 * Processes jobs with advanced retry policies, dead letter queue handling,
 * and comprehensive observability.
 * 
 * Usage:
 * node scripts/enhanced-job-worker.mjs [--batch-size=10] [--worker-id=worker-1] [--max-runtime=300000]
 * 
 * Environment Variables:
 * - SUPABASE_URL: Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 * - WORKER_ID: Unique worker identifier
 * - BATCH_SIZE: Number of jobs to process per batch
 * - MAX_RUNTIME_MS: Maximum worker runtime in milliseconds
 * - PROCESS_INTERVAL_MS: Interval between processing cycles
 */

import { createServerSupabaseClient } from '../src/lib/supabase/server';
import EnhancedJobManager from '../src/lib/enhancedJobManager.js';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('job-worker');

// Configuration from environment and arguments
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  workerId: process.env.WORKER_ID || 'enhanced-worker-1',
  batchSize: parseInt(process.env.BATCH_SIZE || '10'),
  maxRuntimeMs: parseInt(process.env.MAX_RUNTIME_MS || '300000'), // 5 minutes
  processIntervalMs: parseInt(process.env.PROCESS_INTERVAL_MS || '5000'), // 5 seconds
};

// Parse command line arguments
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--batch-size=')) {
    config.batchSize = parseInt(arg.split('=')[1]);
  } else if (arg.startsWith('--worker-id=')) {
    config.workerId = arg.split('=')[1];
  } else if (arg.startsWith('--max-runtime=')) {
    config.maxRuntimeMs = parseInt(arg.split('=')[1]);
  }
}

console.log('Enhanced Job Worker Configuration:', {
  workerId: config.workerId,
  batchSize: config.batchSize,
  maxRuntimeMs: config.maxRuntimeMs,
  processIntervalMs: config.processIntervalMs,
});

async function main() {
  const span = tracer.startSpan('job_worker.main');
  
  try {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    // Initialize Supabase client
    const supabase = createServerSupabaseClient(config.supabaseUrl, config.supabaseServiceKey);
    
    // Initialize job manager
    const jobManager = new EnhancedJobManager(supabase);

    // Register custom job handlers
    registerCustomHandlers(jobManager);

    console.log(`🚀 Enhanced Job Worker ${config.workerId} starting...`);

    let totalProcessed = 0;
    let totalErrors = 0;
    let totalDeadLetter = 0;
    let cycles = 0;

    // Main processing loop
    const startTime = Date.now();
    while (Date.now() - startTime < config.maxRuntimeMs) {
      const cycleSpan = tracer.startSpan('job_worker.cycle', {
        attributes: {
          'worker.id': config.workerId,
          'cycle.number': cycles,
        },
      });

      try {
        console.log(`📋 Processing cycle ${cycles + 1}...`);

        // Process jobs
        const result = await jobManager.processJobs({
          batch_size: config.batchSize,
          worker_id: config.workerId,
          max_runtime_ms: config.processIntervalMs * 2, // Allow extra time per cycle
        });

        totalProcessed += result.processed;
        totalErrors += result.errors;
        totalDeadLetter += result.dead_letter;

        console.log(`✅ Cycle ${cycles + 1} completed:`, {
          processed: result.processed,
          errors: result.errors,
          dead_letter: result.dead_letter,
        });

        cycleSpan.setAttribute('jobs.processed', result.processed);
        cycleSpan.setAttribute('jobs.errors', result.errors);
        cycleSpan.setAttribute('jobs.dead_letter', result.dead_letter);

        // Get job statistics
        if (cycles % 10 === 0) { // Every 10th cycle
          const stats = await jobManager.getJobStats();
          console.log('📊 Job Statistics:', stats);
        }

        // Process dead letter queue occasionally
        if (cycles % 50 === 0 && cycles > 0) { // Every 50th cycle
          console.log('🔄 Processing dead letter queue...');
          const deadLetterResult = await jobManager.processDeadLetterQueue({
            manual_retry: false, // Delete old entries
            batch_size: 25,
          });
          console.log(`🗑️ Dead letter cleanup: deleted ${deadLetterResult.deleted} jobs`);
        }

        cycles++;

        // Sleep before next cycle
        if (result.processed === 0 && result.errors === 0) {
          // No jobs processed, sleep longer
          await sleep(config.processIntervalMs * 2);
        } else {
          await sleep(config.processIntervalMs);
        }

      } catch (error) {
        cycleSpan.recordException(error);
        console.error(`❌ Error in processing cycle ${cycles + 1}:`, error);
        totalErrors++;
        
        // Exponential backoff on errors
        await sleep(Math.min(config.processIntervalMs * Math.pow(2, Math.min(cycles, 5)), 30000));
      } finally {
        cycleSpan.end();
      }
    }

    console.log('🏁 Enhanced Job Worker completed:', {
      workerId: config.workerId,
      totalCycles: cycles,
      totalProcessed,
      totalErrors,
      totalDeadLetter,
      runtimeMs: Date.now() - startTime,
    });

    span.setAttribute('worker.total_processed', totalProcessed);
    span.setAttribute('worker.total_errors', totalErrors);
    span.setAttribute('worker.total_cycles', cycles);

  } catch (error) {
    span.recordException(error);
    console.error('❌ Enhanced Job Worker fatal error:', error);
    process.exit(1);
  } finally {
    span.end();
  }
}

function registerCustomHandlers(jobManager) {
  // Security automation handler
  jobManager.registerHandler('security_scan', async (payload) => {
    try {
      const { scanType = 'pii' } = payload;
      console.log(`🔍 Running security scan: ${scanType}`);
      
      // Mock security scan implementation
      await sleep(2000); // Simulate scan time
      
      return { success: true, result: { scanType, itemsScanned: 100 } };
    } catch (error) {
      return { success: false, error: error.message, retry: true };
    }
  });

  // Availability precomputation handler
  jobManager.registerHandler('precompute_availability', async (payload) => {
    try {
      const { staffId, startDate, endDate } = payload;
      console.log(`📅 Precomputing availability for staff ${staffId} from ${startDate} to ${endDate}`);
      
      // Mock availability precomputation
      await sleep(3000); // Simulate computation time
      
      return { success: true, result: { slotsGenerated: 168 } };
    } catch (error) {
      return { success: false, error: error.message, retry: true };
    }
  });

  // Payment reconciliation handler
  jobManager.registerHandler('payment_reconciliation', async (payload) => {
    try {
      const { dateRange } = payload;
      console.log(`💰 Running payment reconciliation for ${dateRange}`);
      
      // Mock reconciliation
      await sleep(5000); // Simulate reconciliation time
      
      return { success: true, result: { transactionsReconciled: 50, discrepancies: 0 } };
    } catch (error) {
      return { success: false, error: error.message, retry: true };
    }
  });

  // Analytics aggregation handler
  jobManager.registerHandler('analytics_aggregation', async (payload) => {
    try {
      const { period = 'daily' } = payload;
      console.log(`📈 Running analytics aggregation for ${period} period`);
      
      // Mock analytics aggregation
      await sleep(4000); // Simulate aggregation time
      
      return { success: true, result: { metricsAggregated: 25 } };
    } catch (error) {
      return { success: false, error: error.message, retry: true };
    }
  });

  // Data cleanup handler
  jobManager.registerHandler('data_cleanup', async (payload) => {
    try {
      const { table, retentionDays } = payload;
      console.log(`🧹 Cleaning up ${table} data older than ${retentionDays} days`);
      
      // Mock data cleanup
      await sleep(2500); // Simulate cleanup time
      
      return { success: true, result: { recordsDeleted: 200 } };
    } catch (error) {
      return { success: false, error: error.message, retry: false }; // Don't retry cleanup failures
    }
  });

  console.log('✅ Custom job handlers registered');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📤 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('📤 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Start the worker
main().catch(error => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});