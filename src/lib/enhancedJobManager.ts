import { createServerSupabaseClient } from '@/lib/supabase/server';
import { trace, metrics } from '@opentelemetry/api';

export interface JobDefinition {
  id: string;
  name: string;
  handler: string;
  payload: Record<string, unknown>;
  tenant_id?: string;
  priority: number;
  max_retries: number;
  retry_delay_ms: number;
  retry_backoff_multiplier: number;
  timeout_ms: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead_letter';
  scheduled_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
}

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
  retry_count: number; 
}) => Promise<JobResult>;

export class EnhancedJobManager {
  private supabase: SupabaseClient;
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

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
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
        'job.name': job.name,
        'job.retry_count': job.retry_count,
      },
    });

    const jobStartTime = Date.now();
    
    try {
      // Mark job as running
      await this.updateJobStatus(job.id, 'running', {
        started_at: new Date().toISOString(),
      });

      // Get handler
      const handler = this.handlers.get(job.handler);
      if (!handler) {
        throw new Error(`No handler registered for job type: ${job.handler}`);
      }

      // Execute job with timeout
      const result = await this.executeWithTimeout(
        handler(job.payload, {
          job_id: job.id,
          tenant_id: job.tenant_id,
          retry_count: job.retry_count,
        }),
        job.timeout_ms
      );

      const duration = Date.now() - jobStartTime;
      this.jobDurationHistogram.record(duration, {
        job_name: job.name,
        status: result.success ? 'completed' : 'failed',
      });

      if (result.success) {
        // Job completed successfully
        await this.updateJobStatus(job.id, 'completed', {
          completed_at: new Date().toISOString(),
        });
        
        span.setStatus({ code: 1 }); // OK
        return { processed: true, error: false, dead_letter: false };

      } else if (result.retry && job.retry_count < job.max_retries) {
        // Schedule retry
        const nextRetry = this.calculateNextRetry(job);
        await this.updateJobStatus(job.id, 'pending', {
          retry_count: job.retry_count + 1,
          scheduled_at: nextRetry.toISOString(),
          error_message: result.error,
        });
        
        span.setAttribute('job.scheduled_retry', true);
        return { processed: false, error: true, dead_letter: false };

      } else {
        // Move to dead letter queue
        await this.updateJobStatus(job.id, 'dead_letter', {
          completed_at: new Date().toISOString(),
          error_message: result.error || 'Max retries exceeded',
        });

        this.deadLetterJobsGauge.record(1);
        span.setAttribute('job.moved_to_dead_letter', true);
        return { processed: false, error: true, dead_letter: true };
      }

    } catch (error) {
      const duration = Date.now() - jobStartTime;
      this.jobDurationHistogram.record(duration, {
        job_name: job.name,
        status: 'error',
      });

      // Handle unexpected errors
      if (job.retry_count < job.max_retries) {
        const nextRetry = this.calculateNextRetry(job);
        await this.updateJobStatus(job.id, 'pending', {
          retry_count: job.retry_count + 1,
          scheduled_at: nextRetry.toISOString(),
          error_message: (error as Error).message,
        });
      } else {
        await this.updateJobStatus(job.id, 'dead_letter', {
          completed_at: new Date().toISOString(),
          error_message: (error as Error).message,
        });
        this.deadLetterJobsGauge.record(1);
      }

      span.recordException(error as Error);
      return { processed: false, error: true, dead_letter: job.retry_count >= job.max_retries };

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
  private calculateNextRetry(job: JobDefinition): Date {
    const baseDelay = job.retry_delay_ms;
    const backoffMultiplier = job.retry_backoff_multiplier;
    const retryCount = job.retry_count;
    
    // Exponential backoff
    const delay = baseDelay * Math.pow(backoffMultiplier, retryCount);
    
    // Add jitter (±25% randomness)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(1000, delay + jitter); // Minimum 1 second
    
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
    running: number;
    completed: number;
    failed: number;
    dead_letter: number;
    avg_duration_ms: number;
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

      // Get average duration for completed jobs
      const { data: completedJobs } = await this.supabase
        .from('jobs')
        .select('started_at, completed_at')
        .eq('status', 'completed')
        .not('started_at', 'is', null)
        .not('completed_at', 'is', null)
        .gte('completed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const durations = (completedJobs || []).map(job => {
        const start = new Date(job.started_at!).getTime();
        const end = new Date(job.completed_at!).getTime();
        return end - start;
      }).filter(d => d > 0);

      const avgDuration = durations.length > 0 
        ? durations.reduce((a, b) => a + b, 0) / durations.length 
        : 0;

      const stats = {
        pending: counts.pending || 0,
        running: counts.running || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
        dead_letter: counts.dead_letter || 0,
        avg_duration_ms: Math.round(avgDuration),
      };

      // Update gauge metrics
      this.activeJobsGauge.record(stats.running + stats.pending);

      return stats;

    } catch (error) {
      span.recordException(error as Error);
      return {
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0,
        dead_letter: 0,
        avg_duration_ms: 0,
      };
    } finally {
      span.end();
    }
  }

  /**
   * Process dead letter queue
   */
  async processDeadLetterQueue(options: {
    manual_retry?: boolean;
    batch_size?: number;
  } = {}): Promise<{ requeued: number; deleted: number }> {
    const span = this.tracer.startSpan('jobs.process_dead_letter');
    
    try {
      const batchSize = options.batch_size || 50;
      
      // Get dead letter jobs older than 24 hours
      const { data: deadJobs, error } = await this.supabase
        .from('jobs')
        .select('*')
        .eq('status', 'dead_letter')
        .lt('updated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(batchSize);

      if (error) throw error;
      if (!deadJobs || deadJobs.length === 0) {
        return { requeued: 0, deleted: 0 };
      }

      let requeued = 0;
      let deleted = 0;

      for (const job of deadJobs as JobDefinition[]) {
        if (options.manual_retry) {
          // Reset and requeue for manual retry
          await this.updateJobStatus(job.id, 'pending', {
            retry_count: 0,
            scheduled_at: new Date().toISOString(),
            error_message: undefined,
          });
          requeued++;
        } else {
          // Delete old dead letter jobs
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
  }
}

export default EnhancedJobManager;