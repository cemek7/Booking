// @ts-nocheck
import { defaultLogger } from '@/lib/logger';
import { Queue, Worker, Job, QueueOptions, WorkerOptions, JobsOptions, FlowJob, FlowProducer } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import { getEventBus } from '../eventbus/eventBus';
import { observability } from '../observability/observability';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// Job type definitions and validation schemas
const PaymentJobSchema = z.object({
  type: z.enum(['process_payment', 'process_refund', 'verify_payment', 'reconcile_payments']),
  booking_id: z.string().uuid().optional(),
  transaction_id: z.string().uuid().optional(),
  payment_provider: z.enum(['stripe', 'paystack', 'flutterwave']).optional(),
  amount: z.number().positive().optional(),
  currency: z.string().length(3).optional(),
  metadata: z.record(z.unknown()).optional()
});

const NotificationJobSchema = z.object({
  type: z.enum(['booking_confirmation', 'booking_reminder', 'payment_receipt', 'cancellation_notice', 'whatsapp_message']),
  recipient: z.string(),
  channel: z.enum(['email', 'sms', 'whatsapp', 'push']),
  template_id: z.string().optional(),
  template_data: z.record(z.unknown()).optional(),
  scheduled_for: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal')
});

const DataExportJobSchema = z.object({
  type: z.enum(['bookings_export', 'payments_export', 'analytics_export', 'backup']),
  tenant_id: z.string().uuid(),
  export_format: z.enum(['csv', 'excel', 'json', 'pdf']).default('csv'),
  date_range: z.object({
    start_date: z.string().datetime(),
    end_date: z.string().datetime()
  }),
  filters: z.record(z.unknown()).optional(),
  delivery_method: z.enum(['email', 'download_link', 's3']).default('email')
});

const MaintenanceJobSchema = z.object({
  type: z.enum(['cleanup_old_data', 'generate_reports', 'send_close_reports', 'sync_external_calendars', 'backup_database']),
  tenant_id: z.string().uuid().optional(),
  parameters: z.record(z.unknown()).optional()
});

interface QueueConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
    maxRetriesPerRequest: number;
    retryDelayOnFailover: number;
    enableOfflineQueue: boolean;
  };
  queues: {
    [queueName: string]: {
      concurrency: number;
      defaultJobOptions: JobsOptions;
    };
  };
}

interface JobResult {
  success: boolean;
  result?: unknown;
  error?: string;
  duration?: number;
  retryCount?: number;
}

type BookingWorkflowData = {
  id: string;
  price_cents?: number;
  currency?: string;
  customer_email?: string;
} & Record<string, unknown>;

type QueueJobData = {
  transaction_id?: string;
  tenant_id?: string;
  amount?: number;
  reason?: string;
  date?: string;
  recipient?: string;
  type?: string;
  export_format?: 'csv' | 'excel' | 'json' | 'pdf';
  date_range?: { start_date?: string; end_date?: string };
  template_data?: { html?: string; body?: string; subject?: string };
};

interface QueueMetrics {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

/**
 * Production-grade job queue infrastructure with Redis/BullMQ
 * Handles background processing, scheduled tasks, and reliable job execution
 */
export class WorkerQueueService {
  private redis: IORedis;
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private flowProducer: FlowProducer;
  private eventBus: ReturnType<typeof getEventBus>;
  private supabase: ReturnType<typeof createServerSupabaseClient>;
  private isInitialized = false;

  private config: QueueConfig = {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false
    },
    queues: {
      'payments': {
        concurrency: 5,
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50
        }
      },
      'notifications': {
        concurrency: 10,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: 200,
          removeOnFail: 100
        }
      },
      'data-export': {
        concurrency: 2,
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 30000,
          },
          removeOnComplete: 20,
          removeOnFail: 20
        }
      },
      'maintenance': {
        concurrency: 1,
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 60000,
          },
          removeOnComplete: 10,
          removeOnFail: 10
        }
      }
    }
  };

  // Performance metrics
  private metrics = {
    jobsProcessed: 0,
    jobsFailed: 0,
    totalProcessingTime: 0,
    averageProcessingTime: 0,
    queuesCount: 0,
    workersCount: 0
  };

  constructor() {
    this.eventBus = getEventBus();
    this.supabase = createServerSupabaseClient();

    // Initialize Redis connection (shared by all queues/workers to reduce connection count)
    this.redis = new IORedis({
      ...this.config.redis,
      lazyConnect: true,
      maxRetriesPerRequest: null, // required by BullMQ when sharing connection
      reconnectOnError: (err) => {
        defaultLogger.warn('Redis reconnect on error:', err.message);
        return err.message.includes('READONLY') || err.message.includes('ECONNRESET');
      }
    });
  }

  /**
   * Initialize the worker queue service
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;

      // Connect to Redis
      await this.redis.connect();
      defaultLogger.info('Connected to Redis for job queues');

      // Initialize event bus
      await this.eventBus.initialize();

      // Initialize queues and workers
      await this.initializeQueues();
      await this.initializeWorkers();

      // Initialize flow producer for complex workflows (shares existing Redis connection)
      this.flowProducer = new FlowProducer({ connection: this.redis });

      // Set up monitoring and health checks
      this.setupMonitoring();

      this.isInitialized = true;
      defaultLogger.info('WorkerQueueService initialized successfully');
    } catch (error) {
      defaultLogger.error('Failed to initialize WorkerQueueService:', error);
      throw error;
    }
  }

  /**
   * Initialize all queues
   */
  private async initializeQueues(): Promise<void> {
    for (const [queueName, queueConfig] of Object.entries(this.config.queues)) {
      const queue = new Queue(queueName, {
        connection: this.redis,
        defaultJobOptions: queueConfig.defaultJobOptions
      });

      this.queues.set(queueName, queue);
      this.metrics.queuesCount++;
    }
  }

  /**
   * Initialize all workers
   */
  private async initializeWorkers(): Promise<void> {
    // Payments worker
    const paymentsWorker = new Worker('payments', async (job: Job) => {
      return await this.processPaymentJob(job);
    }, {
      connection: this.redis,
      concurrency: this.config.queues.payments.concurrency
    });

    this.workers.set('payments', paymentsWorker);

    // Notifications worker
    const notificationsWorker = new Worker('notifications', async (job: Job) => {
      return await this.processNotificationJob(job);
    }, {
      connection: this.redis,
      concurrency: this.config.queues.notifications.concurrency
    });

    this.workers.set('notifications', notificationsWorker);

    // Data export worker
    const dataExportWorker = new Worker('data-export', async (job: Job) => {
      return await this.processDataExportJob(job);
    }, {
      connection: this.redis,
      concurrency: this.config.queues['data-export'].concurrency
    });

    this.workers.set('data-export', dataExportWorker);

    // Maintenance worker
    const maintenanceWorker = new Worker('maintenance', async (job: Job) => {
      return await this.processMaintenanceJob(job);
    }, {
      connection: this.redis,
      concurrency: this.config.queues.maintenance.concurrency
    });

    this.workers.set('maintenance', maintenanceWorker);

    // Set up worker event listeners
    this.setupWorkerEventListeners();

    this.metrics.workersCount = this.workers.size;
  }

  /**
   * Add payment processing job
   */
  async addPaymentJob(
    jobData: z.infer<typeof PaymentJobSchema>,
    options: JobsOptions = {}
  ): Promise<Job> {
    const traceContext = observability.startTrace('queue.add_payment_job');
    
    try {
      const validatedData = PaymentJobSchema.parse(jobData);
      observability.setTraceTag(traceContext, 'job_type', validatedData.type);
      
      const queue = this.queues.get('payments');
      if (!queue) {
        throw new Error('Payments queue not initialized');
      }

      const job = await queue.add(validatedData.type, validatedData, {
        ...this.config.queues.payments.defaultJobOptions,
        ...options
      });

      observability.recordBusinessMetric('queue_job_added_total', 1, {
        queue: 'payments',
        job_type: validatedData.type
      });

      observability.finishTrace(traceContext, 'success');
      return job;
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Failed to add payment job', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Add notification job
   */
  async addNotificationJob(
    jobData: z.infer<typeof NotificationJobSchema>,
    options: JobsOptions = {}
  ): Promise<Job> {
    const traceContext = observability.startTrace('queue.add_notification_job');
    
    try {
      const validatedData = NotificationJobSchema.parse(jobData);
      observability.setTraceTag(traceContext, 'notification_type', validatedData.type);
      observability.setTraceTag(traceContext, 'channel', validatedData.channel);
      
      const queue = this.queues.get('notifications');
      if (!queue) {
        throw new Error('Notifications queue not initialized');
      }

      // Handle scheduled notifications
      const jobOptions: JobsOptions = {
        ...this.config.queues.notifications.defaultJobOptions,
        ...options
      };

      if (validatedData.scheduled_for) {
        const scheduledTime = new Date(validatedData.scheduled_for);
        const delay = scheduledTime.getTime() - Date.now();
        if (delay > 0) {
          jobOptions.delay = delay;
        }
      }

      // Set priority
      if (validatedData.priority === 'critical') {
        jobOptions.priority = 100;
      } else if (validatedData.priority === 'high') {
        jobOptions.priority = 50;
      } else if (validatedData.priority === 'low') {
        jobOptions.priority = -50;
      }

      const job = await queue.add(validatedData.type, validatedData, jobOptions);

      observability.recordBusinessMetric('queue_job_added_total', 1, {
        queue: 'notifications',
        job_type: validatedData.type,
        channel: validatedData.channel
      });

      observability.finishTrace(traceContext, 'success');
      return job;
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Failed to add notification job', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Add data export job
   */
  async addDataExportJob(
    jobData: z.infer<typeof DataExportJobSchema>,
    options: JobsOptions = {}
  ): Promise<Job> {
    const traceContext = observability.startTrace('queue.add_data_export_job');
    
    try {
      const validatedData = DataExportJobSchema.parse(jobData);
      observability.setTraceTag(traceContext, 'export_type', validatedData.type);
      observability.setTraceTag(traceContext, 'format', validatedData.export_format);
      
      const queue = this.queues.get('data-export');
      if (!queue) {
        throw new Error('Data export queue not initialized');
      }

      const job = await queue.add(validatedData.type, validatedData, {
        ...this.config.queues['data-export'].defaultJobOptions,
        ...options
      });

      observability.recordBusinessMetric('queue_job_added_total', 1, {
        queue: 'data-export',
        job_type: validatedData.type
      });

      observability.finishTrace(traceContext, 'success');
      return job;
    } catch (error) {
      observability.addTraceLog(traceContext, 'error', 'Failed to add data export job', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');
      throw error;
    }
  }

  /**
   * Schedule recurring maintenance jobs
   */
  async scheduleMaintenanceJobs(): Promise<void> {
    try {
      const queue = this.queues.get('maintenance');
      if (!queue) {
        throw new Error('Maintenance queue not initialized');
      }

      // Daily cleanup job at 2 AM
      await queue.add('cleanup_old_data', 
        { type: 'cleanup_old_data' },
        {
          repeat: { cron: '0 2 * * *' },
          jobId: 'daily-cleanup'
        }
      );

      // Weekly reports on Sunday at 6 AM
      await queue.add('generate_reports',
        { type: 'generate_reports' },
        {
          repeat: { cron: '0 6 * * 0' },
          jobId: 'weekly-reports'
        }
      );

      // Every 15 minutes, sweep tenants whose local close-report time has passed.
      await queue.add('send_close_reports',
        { type: 'send_close_reports' },
        {
          repeat: { cron: '*/15 * * * *' },
          jobId: 'send-close-reports'
        }
      );

      // Hourly external calendar sync
      await queue.add('sync_external_calendars',
        { type: 'sync_external_calendars' },
        {
          repeat: { cron: '0 * * * *' },
          jobId: 'hourly-calendar-sync'
        }
      );

      // Daily database backup at 3 AM
      await queue.add('backup_database',
        { type: 'backup_database' },
        {
          repeat: { cron: '0 3 * * *' },
          jobId: 'daily-backup'
        }
      );

      defaultLogger.info('Scheduled recurring maintenance jobs');
    } catch (error) {
      defaultLogger.error('Failed to schedule maintenance jobs:', error);
      throw error;
    }
  }

  /**
   * Create complex workflow using FlowProducer
   */
  async createBookingWorkflow(
    bookingData: BookingWorkflowData,
    tenantId: string
  ): Promise<void> {
    try {
      const flowJob: FlowJob = {
        name: 'booking-workflow',
        queueName: 'payments',
        data: {
          type: 'process_payment',
          booking_id: bookingData.id,
          amount: bookingData.price_cents,
          currency: bookingData.currency
        },
        children: [
          {
            name: 'send-confirmation',
            queueName: 'notifications',
            data: {
              type: 'booking_confirmation',
              recipient: bookingData.customer_email,
              channel: 'email',
              template_data: bookingData
            }
          },
          {
            name: 'send-whatsapp-confirmation',
            queueName: 'notifications',
            data: {
              type: 'whatsapp_message',
              recipient: bookingData.customer_phone,
              channel: 'whatsapp',
              template_data: bookingData
            }
          },
          {
            name: 'schedule-reminder',
            queueName: 'notifications',
            data: {
              type: 'booking_reminder',
              recipient: bookingData.customer_email,
              channel: 'email',
              scheduled_for: new Date(new Date(bookingData.start_time).getTime() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours before
              template_data: bookingData
            }
          }
        ]
      };

      await this.flowProducer.add(flowJob);

      observability.recordBusinessMetric('queue_workflow_created_total', 1, {
        workflow_type: 'booking'
      });
    } catch (error) {
      defaultLogger.error('Failed to create booking workflow:', error);
      throw error;
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(queueName?: string): Promise<Map<string, QueueMetrics>> {
    const metrics = new Map<string, QueueMetrics>();

    try {
      const queues = queueName ? [this.queues.get(queueName)] : Array.from(this.queues.values());

      for (const queue of queues) {
        if (queue) {
          const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');

          metrics.set(queue.name, {
            queued: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: await queue.isPaused() ? 1 : 0
          });
        }
      }
    } catch (error) {
      defaultLogger.error('Failed to get queue metrics:', error);
    }

    return metrics;
  }

  /**
   * Process payment job
   */
  private async processPaymentJob(job: Job): Promise<JobResult> {
    const startTime = Date.now();
    const traceContext = observability.startTrace('queue.process_payment_job');
    
    try {
      observability.setTraceTag(traceContext, 'job_id', job.id);
      observability.setTraceTag(traceContext, 'job_type', job.data.type);

      // Simulate payment processing logic
      switch (job.data.type) {
        case 'process_payment':
          // Process payment using payment service
          await this.simulatePaymentProcessing(job.data);
          break;
        case 'process_refund':
          // Process refund
          await this.simulateRefundProcessing(job.data);
          break;
        case 'verify_payment':
          // Verify payment status
          await this.simulatePaymentVerification(job.data);
          break;
        case 'reconcile_payments':
          // Reconcile payments
          await this.simulatePaymentReconciliation(job.data);
          break;
      }

      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);
      
      observability.recordBusinessMetric('queue_job_completed_total', 1, {
        queue: 'payments',
        job_type: job.data.type,
        duration_ms: duration
      });

      observability.finishTrace(traceContext, 'success');

      return {
        success: true,
        duration,
        retryCount: job.attemptsMade
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      observability.addTraceLog(traceContext, 'error', 'Payment job failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');

      return {
        success: false,
        error: error.message,
        duration,
        retryCount: job.attemptsMade
      };
    }
  }

  /**
   * Process notification job
   */
  private async processNotificationJob(job: Job): Promise<JobResult> {
    const startTime = Date.now();
    const traceContext = observability.startTrace('queue.process_notification_job');
    
    try {
      observability.setTraceTag(traceContext, 'job_id', job.id);
      observability.setTraceTag(traceContext, 'notification_type', job.data.type);
      observability.setTraceTag(traceContext, 'channel', job.data.channel);

      // Process different notification types
      switch (job.data.channel) {
        case 'email':
          await this.sendEmailNotification(job.data);
          break;
        case 'sms':
          await this.sendSMSNotification(job.data);
          break;
        case 'whatsapp':
          await this.sendWhatsAppNotification(job.data);
          break;
        case 'push':
          await this.sendPushNotification(job.data);
          break;
      }

      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      observability.recordBusinessMetric('queue_job_completed_total', 1, {
        queue: 'notifications',
        job_type: job.data.type,
        channel: job.data.channel,
        duration_ms: duration
      });

      observability.finishTrace(traceContext, 'success');

      return {
        success: true,
        duration,
        retryCount: job.attemptsMade
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      observability.addTraceLog(traceContext, 'error', 'Notification job failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');

      return {
        success: false,
        error: error.message,
        duration,
        retryCount: job.attemptsMade
      };
    }
  }

  /**
   * Process data export job
   */
  private async processDataExportJob(job: Job): Promise<JobResult> {
    const startTime = Date.now();
    const traceContext = observability.startTrace('queue.process_data_export_job');
    
    try {
      observability.setTraceTag(traceContext, 'job_id', job.id);
      observability.setTraceTag(traceContext, 'export_type', job.data.type);

      // Simulate data export processing
      const exportResult = await this.generateDataExport(job.data);

      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      observability.recordBusinessMetric('queue_job_completed_total', 1, {
        queue: 'data-export',
        job_type: job.data.type,
        duration_ms: duration
      });

      observability.finishTrace(traceContext, 'success');

      return {
        success: true,
        result: exportResult,
        duration,
        retryCount: job.attemptsMade
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      observability.addTraceLog(traceContext, 'error', 'Data export job failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');

      return {
        success: false,
        error: error.message,
        duration,
        retryCount: job.attemptsMade
      };
    }
  }

  /**
   * Process maintenance job
   */
  private async processMaintenanceJob(job: Job): Promise<JobResult> {
    const startTime = Date.now();
    const traceContext = observability.startTrace('queue.process_maintenance_job');
    
    try {
      observability.setTraceTag(traceContext, 'job_id', job.id);
      observability.setTraceTag(traceContext, 'maintenance_type', job.data.type);

      // Process different maintenance tasks
      switch (job.data.type) {
        case 'cleanup_old_data':
          await this.performDataCleanup();
          break;
        case 'generate_reports':
          await this.generateReports();
          break;
        case 'send_close_reports':
          await this.sendCloseReports();
          break;
        case 'sync_external_calendars':
          await this.syncExternalCalendars();
          break;
        case 'backup_database':
          await this.performDatabaseBackup();
          break;
      }

      const duration = Date.now() - startTime;
      this.updateMetrics(duration, false);

      observability.recordBusinessMetric('queue_job_completed_total', 1, {
        queue: 'maintenance',
        job_type: job.data.type,
        duration_ms: duration
      });

      observability.finishTrace(traceContext, 'success');

      return {
        success: true,
        duration,
        retryCount: job.attemptsMade
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.updateMetrics(duration, true);

      observability.addTraceLog(traceContext, 'error', 'Maintenance job failed', {
        error_message: error.message
      });
      observability.finishTrace(traceContext, 'error');

      return {
        success: false,
        error: error.message,
        duration,
        retryCount: job.attemptsMade
      };
    }
  }

  /**
   * Set up worker event listeners
   */
  private setupWorkerEventListeners(): void {
    for (const [workerName, worker] of this.workers.entries()) {
      worker.on('completed', (job: Job) => {
        observability.recordBusinessMetric('queue_job_completed_total', 1, {
          queue: workerName
        });
      });

      worker.on('failed', (job: Job | undefined, err: Error) => {
        observability.recordBusinessMetric('queue_job_failed_total', 1, {
          queue: workerName,
          error: err.name
        });
      });

      worker.on('stalled', (jobId: string) => {
        observability.recordBusinessMetric('queue_job_stalled_total', 1, {
          queue: workerName
        });
      });
    }
  }

  /**
   * Set up monitoring and health checks
   */
  private setupMonitoring(): void {
    // Monitor queue health every minute
    setInterval(async () => {
      const metrics = await this.getQueueMetrics();
      
      for (const [queueName, queueMetrics] of metrics.entries()) {
        observability.recordBusinessMetric('queue_jobs_waiting', queueMetrics.queued, {
          queue: queueName
        });
        observability.recordBusinessMetric('queue_jobs_active', queueMetrics.active, {
          queue: queueName
        });
        observability.recordBusinessMetric('queue_jobs_failed', queueMetrics.failed, {
          queue: queueName
        });
      }
    }, 60000);
  }

  /**
   * Update processing metrics
   */
  private updateMetrics(duration: number, failed: boolean): void {
    this.metrics.jobsProcessed++;
    this.metrics.totalProcessingTime += duration;
    this.metrics.averageProcessingTime = this.metrics.totalProcessingTime / this.metrics.jobsProcessed;
    
    if (failed) {
      this.metrics.jobsFailed++;
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    try {
      defaultLogger.info('Shutting down WorkerQueueService...');

      // Close all workers
      for (const [name, worker] of this.workers.entries()) {
        defaultLogger.info(`Closing worker: ${name}`);
        await worker.close();
      }

      // Close all queues
      for (const [name, queue] of this.queues.entries()) {
        defaultLogger.info(`Closing queue: ${name}`);
        await queue.close();
      }

      // Close flow producer
      if (this.flowProducer) {
        await this.flowProducer.close();
      }

      // Close Redis connection
      if (this.redis) {
        this.redis.disconnect();
      }

      defaultLogger.info('WorkerQueueService shutdown complete');
    } catch (error) {
      defaultLogger.error('WorkerQueueService shutdown error:', error);
    }
  }

  private async simulatePaymentProcessing(data: QueueJobData): Promise<void> {
    const supabase = createServerSupabaseClient();
    const PaymentService = (await import('@/lib/paymentService')).default;
    const svc = new PaymentService(supabase);
    if (data.transaction_id) {
      await svc.retryFailedTransaction(data.transaction_id);
    }
  }

  private async simulateRefundProcessing(data: QueueJobData): Promise<void> {
    const supabase = createServerSupabaseClient();
    const PaymentService = (await import('@/lib/paymentService')).default;
    const svc = new PaymentService(supabase);
    if (data.transaction_id && data.tenant_id) {
      await svc.processRefund({ tenantId: data.tenant_id, transactionId: data.transaction_id, amount: data.amount, reason: data.reason });
    }
  }

  private async simulatePaymentVerification(data: QueueJobData): Promise<void> {
    const supabase = createServerSupabaseClient();
    if (data.transaction_id && data.tenant_id) {
      const PaymentService = (await import('@/lib/paymentService')).default;
      const svc = new PaymentService(supabase);
      await svc.retryFailedTransaction(data.transaction_id);
    }
  }

  private async simulatePaymentReconciliation(data: QueueJobData): Promise<void> {
    const supabase = createServerSupabaseClient();
    const PaymentService = (await import('@/lib/paymentService')).default;
    const svc = new PaymentService(supabase);
    if (data.tenant_id) {
      await svc.reconcileLedger(data.tenant_id, data.date);
    }
  }

  private async sendEmailNotification(data: QueueJobData): Promise<void> {
    const { sendEmail } = await import('@/lib/integrations/email-service');
    if (!data.recipient) return;
    const html = data.template_data?.html || `<p>${data.template_data?.body || data.type}</p>`;
    const subject = data.template_data?.subject || data.type?.replace(/_/g, ' ');
    await sendEmail({ to: data.recipient, subject, html });
  }

  private async sendSMSNotification(data: QueueJobData): Promise<void> {
    const { sendSMS } = await import('@/lib/integrations/sms-service');
    if (!data.recipient) return;
    const body = data.template_data?.body || data.type?.replace(/_/g, ' ');
    await sendSMS({ to: data.recipient, body });
  }

  private async sendWhatsAppNotification(data: QueueJobData): Promise<void> {
    const { sendWhatsApp } = await import('@/lib/integrations/whatsapp-service');
    if (!data.recipient) return;
    await sendWhatsApp({
      number: data.recipient,
      text: data.template_data?.body || data.type?.replace(/_/g, ' '),
    });
  }

  private async sendPushNotification(data: QueueJobData): Promise<void> {
    // Push notifications require a push gateway — log and skip gracefully
    defaultLogger.warn('[WorkerQueue] Push notification not configured:', data.recipient);
  }

  private async generateDataExport(data: QueueJobData): Promise<{ rows: unknown[]; format: string }> {
    const supabase = createServerSupabaseClient();
    let query = supabase.from('reservations').select('*').eq('tenant_id', data.tenant_id);
    if (data.date_range?.start_date) query = query.gte('created_at', data.date_range.start_date);
    if (data.date_range?.end_date) query = query.lte('created_at', data.date_range.end_date);
    const { data: rows } = await query;
    return { rows: rows ?? [], format: data.export_format ?? 'json' };
  }

  private async performDataCleanup(): Promise<void> {
    const supabase = createServerSupabaseClient();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('jobs').delete().eq('status', 'completed').lt('updated_at', cutoff);
  }

  private async generateReports(): Promise<void> {
    // Reports are generated on-demand via analytics API routes
    defaultLogger.info('[WorkerQueue] Report generation delegated to analytics API');
  }

  private async sendCloseReports(): Promise<void> {
    const { runDueCloseReportsWithAdmin } = await import('@/lib/reconciliation/closeReportJob');
    const sentCount = await runDueCloseReportsWithAdmin();
    defaultLogger.info('[WorkerQueue] Close report sweep complete', { sentCount });
  }

  private async syncExternalCalendars(): Promise<void> {
    // Calendar sync is handled by /api/calendar/* routes
    defaultLogger.info('[WorkerQueue] Calendar sync delegated to calendar integration routes');
  }

  private async performDatabaseBackup(): Promise<void> {
    // Database backups are handled by Supabase's automated backup infrastructure
    defaultLogger.info('[WorkerQueue] Database backup handled by Supabase infrastructure');
  }
}

// Export singleton instance — use global to survive Next.js HMR in dev
// without this, every hot-reload creates a new instance with stacked intervals/connections
declare global {
  // eslint-disable-next-line no-var
  var __workerQueue: WorkerQueueService | undefined;
}

export const workerQueue: WorkerQueueService =
  globalThis.__workerQueue ?? (globalThis.__workerQueue = new WorkerQueueService());
