// Transaction retry worker - processes failed transactions with exponential backoff
// Usage (PowerShell):
// $env:SUPABASE_URL="https://your.project"; $env:SUPABASE_SERVICE_ROLE_KEY="key"; node scripts/retry-transactions.mjs
import { createServerSupabaseClient } from '../src/lib/supabase/server';
import { existsSync } from 'fs';
import { join } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { trace } from '@opentelemetry/api';
import PaymentService from '../src/lib/paymentService.js';

// Initialize OpenTelemetry if configured
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations()]
  });
  sdk.start();
}

// Load env from .env.local if present, else .env
const envLocal = join(process.cwd(), '.env.local');
if (existsSync(envLocal)) dotenvConfig({ path: envLocal });
else dotenvConfig();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createServerSupabaseClient();
const tracer = trace.getTracer('boka-retry-worker');

async function main() {
  const span = tracer.startSpan('retry.worker_batch');
  const start = Date.now();
  
  try {
    console.log(`[${new Date().toISOString()}] Starting transaction retry worker`);
    
    // Get transactions eligible for retry
    const { data: retryableTransactions, error } = await supabase
      .from('transactions')
      .select('id, tenant_id, provider_reference, retry_count, last_retry_at')
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', new Date().toISOString())
      .lt('retry_count', 3) // Max 3 retries
      .in('status', ['failed', 'pending'])
      .order('next_retry_at', { ascending: true })
      .limit(50);

    if (error) {
      span.recordException(error);
      span.setAttribute('retry.status', 'fetch_error');
      console.error('Failed to fetch retryable transactions', error);
      process.exit(1);
    }

    if (!retryableTransactions || retryableTransactions.length === 0) {
      span.setAttribute('retry.status', 'no_pending');
      console.log('No transactions eligible for retry');
      return;
    }

    span.setAttribute('retry.pending_count', retryableTransactions.length);
    console.log(`Found ${retryableTransactions.length} transactions to retry`);

    let successful = 0;
    let failed = 0;
    
    // Process each transaction
    for (const transaction of retryableTransactions) {
      const itemSpan = tracer.startSpan('retry.process_transaction', {
        attributes: {
          'transaction.id': transaction.id,
          'transaction.tenant_id': transaction.tenant_id,
          'transaction.retry_count': transaction.retry_count
        }
      });

      try {
        const paymentService = new PaymentService(supabase);
        const result = await paymentService.retryFailedTransaction(transaction.id);
        
        if (result.success) {
          successful++;
          itemSpan.setAttribute('retry.result', 'success');
          console.log(`✓ Successfully retried transaction ${transaction.id}`);
        } else {
          failed++;
          itemSpan.setAttribute('retry.result', 'failed');
          itemSpan.setAttribute('retry.error', result.error || 'Unknown error');
          console.log(`✗ Failed to retry transaction ${transaction.id}: ${result.error}`);
        }
      } catch (error) {
        failed++;
        itemSpan.recordException(error);
        itemSpan.setAttribute('retry.result', 'error');
        console.error(`✗ Error retrying transaction ${transaction.id}:`, error);
      } finally {
        itemSpan.end();
      }

      // Add delay between retries to avoid overwhelming payment providers
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    span.setAttribute('retry.status', 'completed');
    span.setAttribute('retry.successful', successful);
    span.setAttribute('retry.failed', failed);

    console.log(`Retry worker completed: ${successful} successful, ${failed} failed`);
    
    // Emit metrics for monitoring
    console.log(`transaction_retries_processed_total ${successful + failed}`);
    console.log(`transaction_retries_successful_total ${successful}`);
    console.log(`transaction_retries_failed_total ${failed}`);

  } catch (error) {
    span.recordException(error);
    span.setAttribute('retry.status', 'error');
    console.error('Retry worker error:', error);
    throw error;
  } finally {
    const duration = (Date.now() - start) / 1000;
    span.setAttribute('retry.duration_seconds', duration);
    span.end();
    console.log(`[${new Date().toISOString()}] Retry worker completed in ${duration.toFixed(2)}s`);
  }
}

// Graceful shutdown handling
// Global state management
// Global state management

process.on('SIGTERM', () => {
  console.log('SIGTERM received, graceful shutdown...');
  isShuttingDown = true;
});

process.on('SIGINT', () => {
  console.log('SIGINT received, graceful shutdown...');
  isShuttingDown = true;
});

// Run main function and handle errors
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});