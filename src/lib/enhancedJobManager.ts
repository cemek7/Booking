import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace, metrics } from '@opentelemetry/api';
import { dialogBookingBridge } from './dialogBookingBridge';
import * as dialogManager from './dialogManager';

// Matches actual database schema from 009_create_jobs_table.sql
export interface JobDefinition {
  id: string;
  type: string;  // Job type/handler name (e.g., 'process_whatsapp_message')
  payload: Record<string, unknown> | null;
  attempts: number;  // Number of processing attempts
  status: 'pending' | 'processing' | 'completed' | 'failed';
  scheduled_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// Default job processing config
const JOB_CONFIG = {
  maxRetries: 3,
  retryDelayMs: 5000,
  timeoutMs: 30000,
};

export interface RetryPolicy {
  max_retries: number;
  base_delay_ms: number;
  backoff_multiplier: number;
  max_delay_ms: number;
  jitter: boolean;
}

export interface JobResult {
  success: boolean;
  result?: unknown;
  error?: string;
  retry?: boolean;
}

// Job handler registry
type JobHandler = (payload: Record<string, unknown>, context: {
  job_id: string;
  tenant_id?: string;
  attempts: number;
}) => Promise<JobResult>;

export class EnhancedJobManager {
  private supabase: ReturnType<typeof createServerSupabaseClient>;
  private tracer = trace.getTracer('boka-jobs');
  private meter = metrics.getMeter('boka-jobs');
  private handlers = new Map<string, JobHandler>();
  
  // Metrics
  private jobsProcessedCounter = this.meter.createCounter('jobs_processed_total', {
    description: 'Total number of jobs processed',
  });

  private jobDurationHistogram = this.meter.createHistogram('job_duration_ms', {
    description: 'Job execution duration in milliseconds',
  });

  private activeJobsGauge = this.meter.createGauge('active_jobs', {
    description: 'Number of currently active jobs',
  });

  private deadLetterJobsGauge = this.meter.createGauge('dead_letter_jobs', {
    description: 'Number of jobs in dead letter queue',
  });

  constructor(supabase?: ReturnType<typeof createServerSupabaseClient>) {
    this.supabase = supabase || createServerSupabaseClient();
    this.initializeBuiltinHandlers();
  }

  /**
   * Register a job handler
   */
  registerHandler(name: string, handler: JobHandler): void {
    this.handlers.set(name, handler);
  }

  /**
   * Schedule a new job
   */
  async scheduleJob(
    name: string,
    payload: Record<string, unknown>,
    options: {
      tenant_id?: string;
      priority?: number;
      scheduled_at?: Date;
      retry_policy?: Partial<RetryPolicy>;
      timeout_ms?: number;
    } = {}
  ): Promise<{ success: boolean; job_id?: string; error?: string }> {
    const span = this.tracer.startSpan('jobs.schedule', {
      attributes: {
        'job.name': name,
        'job.priority': options.priority || 5,
      },
    });

    try {
      const defaultRetryPolicy: RetryPolicy = {
        max_retries: 3,
        base_delay_ms: 1000,
        backoff_multiplier: 2,
        max_delay_ms: 30000,
        jitter: true,
      };

      const retryPolicy = { ...defaultRetryPolicy, ...options.retry_policy };
      
      const job = {
        name,
        handler: name,
        payload,
        tenant_id: options.tenant_id,
        priority: options.priority || 5,
        max_retries: retryPolicy.max_retries,
        retry_delay_ms: retryPolicy.base_delay_ms,
        retry_backoff_multiplier: retryPolicy.backoff_multiplier,
        timeout_ms: options.timeout_ms || 30000,
        status: 'pending' as const,
        scheduled_at: (options.scheduled_at || new Date()).toISOString(),
        retry_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await this.supabase
        .from('jobs')
        .insert(job)
        .select('id')
        .single();

      if (error) throw error;

      span.setAttribute('job.id', data.id);
      span.setStatus({ code: 1 }); // OK

      return { success: true, job_id: data.id };

    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2, message: (error as Error).message }); // ERROR
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Process pending jobs
   */
  async processJobs(
    options: {
      batch_size?: number;
      worker_id?: string;
      max_runtime_ms?: number;
    } = {}
  ): Promise<{ processed: number; errors: number; dead_letter: number }> {
    const span = this.tracer.startSpan('jobs.process_batch');
    const startTime = Date.now();
    
    try {
      const batchSize = options.batch_size || 10;
      const maxRuntime = options.max_runtime_ms || 5 * 60 * 1000; // 5 minutes
      const workerId = options.worker_id || 'default';
      
      let processed = 0;
      let errors = 0;
      let deadLetter = 0;

      while (Date.now() - startTime < maxRuntime) {
        // Get next batch of jobs ordered by priority and scheduled_at
        const { data: jobs, error } = await this.supabase
          .from('jobs')
          .select('*')
          .in('status', ['pending', 'failed'])
          .lte('scheduled_at', new Date().toISOString())
          .order('priority', { ascending: false })
          .order('scheduled_at', { ascending: true })
          .limit(batchSize);

        if (error) throw error;
        if (!jobs || jobs.length === 0) break;

        // Process jobs in parallel (up to batch size)
        const jobPromises = jobs.map(job => this.processJob(job as JobDefinition));
        const results = await Promise.allSettled(jobPromises);

        for (const result of results) {
          if (result.status === 'fulfilled') {
            const { processed: jobProcessed, error: jobError, dead_letter } = result.value;
            if (jobProcessed) processed++;
            if (jobError) errors++;
            if (dead_letter) deadLetter++;
          } else {
            errors++;
          }
        }

        // Update metrics
        this.jobsProcessedCounter.add(processed, { worker_id: workerId });
      }

      span.setAttribute('jobs.processed', processed);
      span.setAttribute('jobs.errors', errors);
      span.setAttribute('jobs.dead_letter', deadLetter);

      return { processed, errors, dead_letter: deadLetter };

    } catch (error) {
      span.recordException(error as Error);
      return { processed: 0, errors: 1, dead_letter: 0 };
    } finally {
      span.end();
    }
  }

  /**
   * Process a single job
   */
  private async processJob(job: JobDefinition): Promise<{
    processed: boolean;
    error: boolean;
    dead_letter: boolean;
  }> {
    const span = this.tracer.startSpan('jobs.process_single', {
      attributes: {
        'job.id': job.id,
        'job.type': job.type,
        'job.attempts': job.attempts,
      },
    });

    const jobStartTime = Date.now();
    const tenantId = (job.payload as { tenant_id?: string })?.tenant_id;

    try {
      // Mark job as processing
      await this.updateJobStatus(job.id, 'processing');

      // Get handler by job type
      const handler = this.handlers.get(job.type);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.type}`);
      }

      // Execute job with timeout
      const result = await this.executeWithTimeout(
        handler(job.payload || {}, {
          job_id: job.id,
          tenant_id: tenantId,
          attempts: job.attempts,
        }),
        JOB_CONFIG.timeoutMs
      );

      const duration = Date.now() - jobStartTime;
      this.jobDurationHistogram.record(duration, {
        job_name: job.type,
        status: result.success ? 'completed' : 'failed',
      });

      if (result.success) {
        // Job completed successfully
        await this.updateJobStatus(job.id, 'completed');

        span.setStatus({ code: 1 }); // OK
        return { processed: true, error: false, dead_letter: false };

      } else if (result.retry && job.attempts < JOB_CONFIG.maxRetries) {
        // Schedule retry
        const nextRetry = this.calculateNextRetry(job.attempts);
        await this.updateJobStatus(job.id, 'pending', {
          attempts: job.attempts + 1,
          scheduled_at: nextRetry.toISOString(),
          last_error: result.error,
        });

        span.setAttribute('job.scheduled_retry', true);
        return { processed: false, error: true, dead_letter: false };

      } else {
        // Mark as failed (max retries exceeded)
        await this.updateJobStatus(job.id, 'failed', {
          last_error: result.error || 'Max retries exceeded',
        });

        this.deadLetterJobsGauge.record(1);
        span.setAttribute('job.max_retries_exceeded', true);
        return { processed: false, error: true, dead_letter: true };
      }

    } catch (error) {
      const duration = Date.now() - jobStartTime;
      this.jobDurationHistogram.record(duration, {
        job_name: job.type,
        status: 'error',
      });

      // Handle unexpected errors
      if (job.attempts < JOB_CONFIG.maxRetries) {
        const nextRetry = this.calculateNextRetry(job.attempts);
        await this.updateJobStatus(job.id, 'pending', {
          attempts: job.attempts + 1,
          scheduled_at: nextRetry.toISOString(),
          last_error: (error as Error).message,
        });
      } else {
        await this.updateJobStatus(job.id, 'failed', {
          last_error: (error as Error).message,
        });
        this.deadLetterJobsGauge.record(1);
      }

      span.recordException(error as Error);
      return { processed: false, error: true, dead_letter: job.attempts >= JOB_CONFIG.maxRetries };

    } finally {
      span.end();
    }
  }

  /**
   * Execute job with timeout
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Job timeout')), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Calculate next retry time with exponential backoff and jitter
   */
  private calculateNextRetry(attempts: number): Date {
    const baseDelay = JOB_CONFIG.retryDelayMs;
    const backoffMultiplier = 2;

    // Exponential backoff
    const delay = baseDelay * Math.pow(backoffMultiplier, attempts);

    // Add jitter (±25% randomness)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(1000, Math.min(delay + jitter, 300000)); // Min 1s, max 5min

    return new Date(Date.now() + finalDelay);
  }

  /**
   * Update job status and metadata
   */
  private async updateJobStatus(
    jobId: string,
    status: JobDefinition['status'],
    updates: Partial<JobDefinition> = {}
  ): Promise<void> {
    await this.supabase
      .from('jobs')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...updates,
      })
      .eq('id', jobId);
  }

  /**
   * Get job statistics
   */
  async getJobStats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }> {
    const span = this.tracer.startSpan('jobs.get_stats');

    try {
      // Get counts by status
      const { data: statusCounts } = await this.supabase
        .from('jobs')
        .select('status')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const counts = (statusCounts || []).reduce((acc, job) => {
        acc[job.status] = (acc[job.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        pending: counts['pending'] || 0,
        processing: counts['processing'] || 0,
        completed: counts['completed'] || 0,
        failed: counts['failed'] || 0,
      };

    } finally {
      span.end();
    }
  }

  /**
   * Process failed jobs queue (retry or cleanup)
   */
  async processFailedJobs(options: {
    manual_retry?: boolean;
    batch_size?: number;
  } = {}): Promise<{ requeued: number; deleted: number }> {
    const span = this.tracer.startSpan('jobs.process_failed');

    try {
      const batchSize = options.batch_size || 50;

      // Get failed jobs older than 24 hours
      const { data: failedJobs, error } = await this.supabase
        .from('jobs')
        .select('*')
        .eq('status', 'failed')
        .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(batchSize);

      if (error) throw error;
      if (!failedJobs || failedJobs.length === 0) {
        return { requeued: 0, deleted: 0 };
      }

      let requeued = 0;
      let deleted = 0;

      for (const job of failedJobs as JobDefinition[]) {
        if (options.manual_retry) {
          // Reset and requeue for manual retry
          await this.updateJobStatus(job.id, 'pending', {
            attempts: 0,
            scheduled_at: new Date().toISOString(),
            last_error: null,
          });
          requeued++;
        } else {
          // Delete old failed jobs
          await this.supabase
            .from('jobs')
            .delete()
            .eq('id', job.id);
          deleted++;
        }
      }

      span.setAttribute('dead_letter.requeued', requeued);
      span.setAttribute('dead_letter.deleted', deleted);

      return { requeued, deleted };

    } catch (error) {
      span.recordException(error as Error);
      return { requeued: 0, deleted: 0 };
    } finally {
      span.end();
    }
  }

  /**
   * Initialize built-in job handlers
   */
  private initializeBuiltinHandlers(): void {
    // Payment retry handler
    this.registerHandler('payment_retry', async (_payload, _context) => {
      // Implementation would call PaymentService retry logic
      return { success: true };
    });

    // Ledger reconciliation handler
    this.registerHandler('ledger_reconcile', async (_payload, _context) => {
      // Implementation would call PaymentService reconciliation
      return { success: true };
    });

    // Outbox dispatch handler
    this.registerHandler('outbox_dispatch', async (_payload, _context) => {
      // Implementation would call event bus dispatch
      return { success: true };
    });

    // Email notification handler
    this.registerHandler('email_notification', async (payload, _context) => {
      try {
        // Mock email sending
        console.log(`Sending email: ${payload.subject} to ${payload.to}`);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message, retry: true };
      }
    });

    // Webhook delivery handler
    this.registerHandler('webhook_delivery', async (payload, _context) => {
      try {
        // Mock webhook delivery
        console.log(`Delivering webhook to ${payload.url}`);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message, retry: true };
      }
    });

    // Data cleanup handler
    this.registerHandler('data_cleanup', async (payload, _context) => {
      try {
        // Mock data cleanup
        console.log(`Cleaning up ${payload.table} data older than ${payload.days} days`);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message, retry: false };
      }
    });

    // WhatsApp message processing handler (sophisticated flow)
    // Uses: messageProcessor -> dialogBookingBridge -> BookingEngine
    this.registerHandler('process_whatsapp_message', async (payload, context) => {
      try {
        const { message_id, tenant_id } = payload as { message_id: string; tenant_id: string };

        // Fetch the message from database
        const { data: message, error: fetchError } = await this.supabase
          .from('messages')
          .select('*')
          .eq('id', message_id)
          .single();

        if (fetchError || !message) {
          console.error('Failed to fetch message:', fetchError);
          return { success: false, error: 'Message not found', retry: false };
        }

        // Initialize dialog booking bridge
        await dialogBookingBridge.initialize();

        // Get or create session for this conversation
        const sessionId = `wa-${tenant_id}-${message.from_number}`;
        let session = await dialogManager.getSession(sessionId);

        if (!session) {
          session = await dialogManager.startSession(tenant_id as string, message.from_number);
        }

        // Process message through sophisticated conversation flow
        const result = await dialogBookingBridge.processMessage(
          tenant_id as string,
          session.id,
          message.content,
          message.from_number
        );

        // Send response via Evolution client if we have one
        if (result.response) {
          const { EvolutionClient } = await import('./evolutionClient');
          const evolutionClient = EvolutionClient.getInstance();
          await evolutionClient.sendMessage(tenant_id, message.from_number, result.response);

          // Store outbound message
          await this.supabase.from('messages').insert({
            tenant_id,
            from_number: message.to_number,
            to_number: message.from_number,
            content: result.response,
            direction: 'outbound',
            message_type: 'text',
          });
        }

        // Mark conversation as complete if booking finished
        if (result.completed) {
          await dialogManager.endSession(session.id);
        }

        return { success: true, result: { response: result.response, completed: result.completed } };
      } catch (error) {
        console.error('WhatsApp message processing error:', error);
        return { success: false, error: (error as Error).message, retry: true };
      }
    });

    // Process inbound message handler (alternative job name)
    this.registerHandler('process_inbound_message', async (payload, context) => {
      // Delegate to the main WhatsApp handler
      const handler = this.handlers.get('process_whatsapp_message');
      if (handler) {
        return handler(payload, context);
      }
      return { success: false, error: 'Handler not found', retry: false };
    });
  }
}

export default EnhancedJobManager;