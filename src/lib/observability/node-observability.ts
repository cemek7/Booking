/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import * as api from '@opentelemetry/api';
import { Histogram, Counter, UpDownCounter, ObservableGauge } from '@opentelemetry/api';
import * as os from 'os';
import * as v8 from 'v8';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

function getNodeAutoInstrumentations(): unknown[] {
  return [];
}

// Types for our observability system
interface MetricLabels {
  [key: string]: string | number | boolean;
}

interface SystemMetrics {
  cpu_usage: number;
  memory_usage: number;
  memory_total: number;
  heap_used: number;
  heap_total: number;
  event_loop_lag: number;
  gc_count: number;
}

interface BusinessMetric {
  name: string;
  value: number;
  labels: MetricLabels;
  timestamp?: Date;
}

interface AlertRule {
  id: string;
  metric: string;
  threshold: number;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
  duration: number; // minutes
  enabled: boolean;
  channels: string[];
  metadata: Record<string, any>;
}

interface AlertEvent {
  id: string;
  rule_id: string;
  metric_name: string;
  current_value: number;
  threshold: number;
  status: 'firing' | 'resolved';
  started_at: Date;
  resolved_at?: Date;
  metadata: Record<string, any>;
}

interface TraceContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  operation_name: string;
  start_time: Date;
  end_time?: Date;
  duration_ms?: number;
  status: 'success' | 'error' | 'timeout';
  tags: Record<string, string>;
  logs: Array<{
    timestamp: Date;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    fields?: Record<string, any>;
  }>;
}

/**
 * Production-grade observability service for comprehensive monitoring
 * Provides metrics, tracing, logging, and alerting capabilities
 */
export class NodeObservabilityService {
  private supabase: any;
  private sdk: NodeSDK | null = null;
  private isInitialized = false;
  
  // Metrics
  private metrics = new Map<string, Histogram | Counter | UpDownCounter | ObservableGauge>();
  private lastCpuUsage = 0;
  private lastMemoryUsage = 0;
  private businessMetrics: BusinessMetric[] = [];
  private businessMetricsFlushBuffer: BusinessMetric[] = [];
  private businessMetricsFlushInterval: NodeJS.Timeout | null = null;
  private systemMetricsInterval: NodeJS.Timeout | null = null;
  
  // Alerting
  private alertRules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, AlertEvent> = new Map();
  private alertCheckInterval: NodeJS.Timeout | null = null;
  
  // Performance monitoring
  private performanceData = {
    requestCount: 0,
    errorCount: 0,
    totalLatency: 0,
    maxLatency: 0,
    minLatency: Infinity,
    lastResetTime: new Date()
  };

  constructor() {
    this.supabase = createSupabaseAdminClient();
  }

  /**
   * Initialize observability with OpenTelemetry instrumentation
   */
  async initialize(config: {
    serviceName: string;
    serviceVersion: string;
    environment: string;
    otlpEndpoint?: string;
    enableAutoInstrumentation?: boolean;
    customInstrumentations?: any[];
  }): Promise<void> {
    try {
      if (this.isInitialized) {
        defaultLogger.warn('ObservabilityService already initialized');
        return;
      }

      // Initialize OpenTelemetry
      const resource = resourceFromAttributes({
        [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment,
        [SemanticResourceAttributes.HOST_NAME]: os.hostname(),
        [SemanticResourceAttributes.PROCESS_PID]: process.pid,
      });

      // Configure exporters
      const traceExporter = new OTLPTraceExporter({
        url: config.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
      });

      const metricExporter = new OTLPMetricExporter({
        url: config.otlpEndpoint || process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
      });

      // Create SDK
      this.sdk = new NodeSDK({
        resource,
        spanProcessor: new BatchSpanProcessor(traceExporter),
        metricReader: new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 30000, // Export every 30 seconds
        }),
        instrumentations: config.enableAutoInstrumentation
          ? [...getNodeAutoInstrumentations(), ...(config.customInstrumentations || [])]
          : config.customInstrumentations || [],
      });

      // Start the SDK
      this.sdk.start();

      // Initialize custom metrics
      await this.initializeMetrics();

      // Start system monitoring
      this.startSystemMonitoring();

      // Start alert monitoring
      this.startAlertMonitoring();

      // Start batched business metrics flush (every 30s instead of per-call DB writes)
      this.startBusinessMetricsFlush();

      // Load existing alert rules
      await this.loadAlertRules();

      this.isInitialized = true;
      defaultLogger.info(`ObservabilityService initialized for ${config.serviceName}@${config.serviceVersion}`);
    } catch (error) {
      defaultLogger.error('Failed to initialize ObservabilityService:', error);
      throw error;
    }
  }

  /**
   * Initialize custom metrics
   */
  private async initializeMetrics(): Promise<void> {
    const meter = api.metrics.getMeter('booking-system', '1.0.0');

    // Business metrics
    this.metrics.set('booking_created_total', meter.createCounter('booking_created_total', {
      description: 'Total number of bookings created',
    }));

    this.metrics.set('booking_cancelled_total', meter.createCounter('booking_cancelled_total', {
      description: 'Total number of bookings cancelled',
    }));

    this.metrics.set('payment_processed_total', meter.createCounter('payment_processed_total', {
      description: 'Total number of payments processed',
    }));

    this.metrics.set('payment_failed_total', meter.createCounter('payment_failed_total', {
      description: 'Total number of failed payments',
    }));

    this.metrics.set('revenue_total', meter.createUpDownCounter('revenue_total', {
      description: 'Total revenue amount',
    }));

    // Technical metrics
    this.metrics.set('http_request_duration', meter.createHistogram('http_request_duration_seconds', {
      description: 'Duration of HTTP requests',
    }));

    this.metrics.set('database_query_duration', meter.createHistogram('database_query_duration_seconds', {
      description: 'Duration of database queries',
    }));

    this.metrics.set('webhook_events_total', meter.createCounter('webhook_events_total', {
      description: 'Total number of webhook events processed',
    }));

    this.metrics.set('active_connections', meter.createUpDownCounter('active_connections', {
      description: 'Number of active connections',
    }));

    this.metrics.set('queue_size', meter.createUpDownCounter('queue_size', {
      description: 'Current queue size',
    }));

    // System metrics — use ObservableGauge so each collection replaces the previous value
    const cpuGauge = meter.createObservableGauge('cpu_usage_percent', {
      description: 'CPU usage percentage',
    });
    cpuGauge.addCallback((result) => { result.observe(this.lastCpuUsage); });
    this.metrics.set('cpu_usage_percent', cpuGauge as unknown as ObservableGauge);

    const memGauge = meter.createObservableGauge('memory_usage_bytes', {
      description: 'Memory usage in bytes',
    });
    memGauge.addCallback((result) => { result.observe(this.lastMemoryUsage); });
    this.metrics.set('memory_usage_bytes', memGauge as unknown as ObservableGauge);

    this.metrics.set('gc_collections_total', meter.createCounter('gc_collections_total', {
      description: 'Total number of garbage collections',
    }));
  }

  /**
   * Flush buffered business metrics to DB in a single batch insert
   */
  private startBusinessMetricsFlush(): void {
    this.businessMetricsFlushInterval = setInterval(async () => {
      if (this.businessMetricsFlushBuffer.length === 0) return;
      const batch = this.businessMetricsFlushBuffer.splice(0);
      try {
        await this.supabase.from('business_metrics').insert(
          batch.map(m => ({
            metric_name: m.name,
            metric_value: m.value,
            labels: m.labels,
            recorded_at: m.timestamp?.toISOString()
          }))
        );
      } catch (error: any) {
        defaultLogger.error('Failed to flush business metrics batch:', error);
      }
    }, 30000); // flush every 30 seconds
  }

  /**
   * Start system metrics monitoring
   */
  private startSystemMonitoring(): void {
    this.systemMetricsInterval = setInterval(async () => {
      const systemMetrics = this.collectSystemMetrics();
      await this.recordSystemMetrics(systemMetrics);
    }, 60000); // Collect every 60 seconds
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics(): SystemMetrics {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const heapStats = v8.getHeapStatistics();

    return {
      cpu_usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
      memory_usage: memoryUsage.rss,
      memory_total: os.totalmem(),
      heap_used: memoryUsage.heapUsed,
      heap_total: memoryUsage.heapTotal,
      event_loop_lag: 0, // Would need hrtime measurements
      gc_count: heapStats.number_of_native_contexts,
    };
  }

  /**
   * Record system metrics
   */
  private async recordSystemMetrics(metrics: SystemMetrics): Promise<void> {
    try {
      // Update gauge fields — ObservableGauge callbacks read these directly
      this.lastCpuUsage = metrics.cpu_usage * 100;
      this.lastMemoryUsage = metrics.memory_usage;

      // Store in database for historical analysis
      await this.supabase.from('system_metrics').insert({
        metric_name: 'system_health',
        metric_value: JSON.stringify(metrics),
        labels: {
          host: os.hostname(),
          pid: process.pid,
          service: 'booking-api'
        },
        recorded_at: new Date().toISOString()
      });

    } catch (error) {
      defaultLogger.error('Failed to record system metrics:', error);
    }
  }

  /**
   * Record business metric
   */
  async recordBusinessMetric(
    name: string, 
    value: number, 
    labels: MetricLabels = {}
  ): Promise<void> {
    try {
      const metric: BusinessMetric = {
        name,
        value,
        labels,
        timestamp: new Date()
      };

      // Store locally for aggregation — cap to prevent unbounded growth
      this.businessMetrics.push(metric);
      if (this.businessMetrics.length > 1000) {
        this.businessMetrics.splice(0, this.businessMetrics.length - 1000);
      }

      // Record to OpenTelemetry
      const otelMetric = this.metrics.get(name);
      if (otelMetric) {
        // Use type guards to call the correct method
        if ('add' in otelMetric) {
          otelMetric.add(value, labels);
        }
      }

      // Buffer for batched DB flush (see startBusinessMetricsFlush) — avoids 1 DB write per call
      if (this.businessMetricsFlushBuffer.length < 5000) {
        this.businessMetricsFlushBuffer.push(metric);
      }

    } catch (error: any) {
      defaultLogger.error(`Failed to record business metric ${name}:`, error);
    }
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number
  ): void {
    try {
      const labels = {
        method,
        path: this.normalizePath(path),
        status_code: statusCode.toString(),
        status_class: `${Math.floor(statusCode / 100)}xx`
      };

      // Update performance tracking
      this.performanceData.requestCount++;
      this.performanceData.totalLatency += duration;
      this.performanceData.maxLatency = Math.max(this.performanceData.maxLatency, duration);
      this.performanceData.minLatency = Math.min(this.performanceData.minLatency, duration);

      if (statusCode >= 400) {
        this.performanceData.errorCount++;
      }

      // Record to OpenTelemetry
      (this.metrics.get('http_request_duration') as Histogram)?.record(duration / 1000, labels);

    } catch (error) {
      defaultLogger.error('Failed to record HTTP request metric:', error);
    }
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(
    operation: string,
    table: string,
    duration: number,
    success: boolean,
    rowCount?: number
  ): void {
    try {
      const labels = {
        operation,
        table,
        status: success ? 'success' : 'error'
      };

      (this.metrics.get('database_query_duration') as Histogram)?.record(duration / 1000, labels);

      // Record to business metrics for analysis
      this.recordBusinessMetric('database_operation_total', 1, {
        ...labels,
        row_count: rowCount || 0
      });

    } catch (error) {
      defaultLogger.error('Failed to record database query metric:', error);
    }
  }

  /**
   * Create and start a trace span
   */
  startTrace(operationName: string, parentContext?: any): any {
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();

    const context: TraceContext = {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentContext?.span_id,
      operation_name: operationName,
      start_time: new Date(),
      status: 'success',
      tags: {},
      logs: []
    };

    return {
      ...context,
      end: () => this.finishTrace(context),
      recordException: (error: Error) => this.addTraceLog(context, 'error', error.message, { stack: error.stack })
    };
  }

  /**
   * Finish a trace span
   */
  finishTrace(context: TraceContext, status: 'success' | 'error' | 'timeout' = 'success'): void {
    context.end_time = new Date();
    context.duration_ms = context.end_time.getTime() - context.start_time.getTime();
    context.status = status;

    // Store trace in database for analysis
    this.supabase.from('traces').insert({
      trace_id: context.trace_id,
      span_id: context.span_id,
      parent_span_id: context.parent_span_id,
      operation_name: context.operation_name,
      start_time: context.start_time.toISOString(),
      end_time: context.end_time.toISOString(),
      duration_ms: context.duration_ms,
      status: context.status,
      tags: context.tags,
      logs: context.logs
    }).then(() => {
      // Success
    }).catch((error: any) => {
      defaultLogger.error('Failed to store trace:', error);
    });
  }

  /**
   * Add log to trace context
   */
  addTraceLog(
    context: TraceContext, 
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    fields?: Record<string, any>
  ): void {
    context.logs.push({
      timestamp: new Date(),
      level,
      message,
      fields
    });
  }

  /**
   * Set trace tag
   */
  setTraceTag(context: TraceContext, key: string, value: string): void {
    context.tags[key] = value;
  }

  /**
   * Create alert rule
   */
  async createAlertRule(rule: Omit<AlertRule, 'id'>): Promise<string> {
    try {
      const id = this.generateAlertId();
      const fullRule: AlertRule = { ...rule, id };
      
      this.alertRules.set(id, fullRule);
      
      await this.supabase.from('alert_rules').insert({
        id,
        metric: rule.metric,
        threshold: rule.threshold,
        operator: rule.operator,
        duration: rule.duration,
        enabled: rule.enabled,
        channels: rule.channels,
        metadata: rule.metadata
      });

      return id;
    } catch (error) {
      defaultLogger.error('Failed to create alert rule:', error);
      throw error;
    }
  }

  /**
   * Start alert monitoring
   */
  private startAlertMonitoring(): void {
    this.alertCheckInterval = setInterval(async () => {
      await this.checkAlertRules();
    }, 60000); // Check every minute
  }

  /**
   * Check alert rules against current metrics
   */
  private async checkAlertRules(): Promise<void> {
    try {
      for (const rule of this.alertRules.values()) {
        if (!rule.enabled) continue;

        const currentValue = await this.getCurrentMetricValue(rule.metric);
        const shouldAlert = this.evaluateAlertCondition(currentValue, rule.threshold, rule.operator);

        if (shouldAlert && !this.activeAlerts.has(rule.id)) {
          // Start new alert
          await this.triggerAlert(rule, currentValue);
        } else if (!shouldAlert && this.activeAlerts.has(rule.id)) {
          // Resolve existing alert
          await this.resolveAlert(rule.id);
        }
      }
    } catch (error) {
      defaultLogger.error('Failed to check alert rules:', error);
    }
  }

  /**
   * Load alert rules from database
   */
  private async loadAlertRules(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('alert_rules')
        .select('*')
        .eq('enabled', true);

      if (error) throw error;

      for (const rule of data || []) {
        this.alertRules.set(rule.id, rule);
      }
    } catch (error) {
      defaultLogger.error('Failed to load alert rules:', error);
    }
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): {
    requestCount: number;
    errorRate: number;
    averageLatency: number;
    maxLatency: number;
    minLatency: number;
    uptime: number;
  } {
    const now = new Date();
    const uptimeMs = now.getTime() - this.performanceData.lastResetTime.getTime();
    
    return {
      requestCount: this.performanceData.requestCount,
      errorRate: this.performanceData.requestCount > 0 
        ? this.performanceData.errorCount / this.performanceData.requestCount 
        : 0,
      averageLatency: this.performanceData.requestCount > 0
        ? this.performanceData.totalLatency / this.performanceData.requestCount
        : 0,
      maxLatency: this.performanceData.maxLatency,
      minLatency: this.performanceData.minLatency === Infinity ? 0 : this.performanceData.minLatency,
      uptime: uptimeMs / 1000 // in seconds
    };
  }

  /**
   * Get health check status
   */
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, any>;
    timestamp: string;
  }> {
    const checks: Record<string, any> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    try {
      // Database health
      const dbStart = Date.now();
      const { data, error } = await this.supabase.from('tenants').select('id').limit(1);
      checks.database = {
        status: error ? 'unhealthy' : 'healthy',
        latency_ms: Date.now() - dbStart,
        error: error?.message
      };
      if (error) overallStatus = 'unhealthy';

      // Memory health
      const memoryUsage = process.memoryUsage();
      const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      checks.memory = {
        status: memoryUsagePercent > 90 ? 'unhealthy' : memoryUsagePercent > 75 ? 'degraded' : 'healthy',
        usage_percent: memoryUsagePercent,
        heap_used: memoryUsage.heapUsed,
        heap_total: memoryUsage.heapTotal
      };
      if (memoryUsagePercent > 90 && overallStatus === 'healthy') overallStatus = 'unhealthy';
      else if (memoryUsagePercent > 75 && overallStatus === 'healthy') overallStatus = 'degraded';

      // Performance health
      const perf = this.getPerformanceSummary();
      checks.performance = {
        status: perf.errorRate > 0.1 ? 'unhealthy' : perf.errorRate > 0.05 ? 'degraded' : 'healthy',
        error_rate: perf.errorRate,
        average_latency: perf.averageLatency,
        request_count: perf.requestCount
      };
      if (perf.errorRate > 0.1 && overallStatus !== 'unhealthy') overallStatus = 'unhealthy';
      else if (perf.errorRate > 0.05 && overallStatus === 'healthy') overallStatus = 'degraded';

    } catch (error: any) {
      overallStatus = 'unhealthy';
      checks.error = error.message;
    }

    return {
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Gracefully shutdown observability
   */
  async shutdown(): Promise<void> {
    try {
      if (this.systemMetricsInterval) {
        clearInterval(this.systemMetricsInterval);
      }

      if (this.alertCheckInterval) {
        clearInterval(this.alertCheckInterval);
      }

      if (this.businessMetricsFlushInterval) {
        clearInterval(this.businessMetricsFlushInterval);
      }

      if (this.sdk) {
        await this.sdk.shutdown();
      }

      defaultLogger.info('ObservabilityService shutdown complete');
    } catch (error) {
      defaultLogger.error('Error during ObservabilityService shutdown:', error);
    }
  }

  // Helper methods
  private normalizePath(path: string): string {
    return path.replace(/\/\d+/g, '/:id').replace(/\?.*/, '');
  }

  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 11);
  }

  private generateAlertId(): string {
    return 'alert_' + Math.random().toString(36).substring(2, 11);
  }

  private async getCurrentMetricValue(metricName: string): Promise<number> {
    switch (metricName) {
      // ── System metrics (read directly from process) ──
      case 'cpu_usage_percent': {
        const cpu = process.cpuUsage();
        return ((cpu.user + cpu.system) / 1_000_000) * 100;
      }
      case 'memory_usage_bytes':
        return process.memoryUsage().rss;
      case 'memory_usage_percent': {
        const mem = process.memoryUsage();
        return (mem.heapUsed / mem.heapTotal) * 100;
      }

      // ── In-process performance counters ──
      case 'error_rate':
        return this.performanceData.requestCount > 0
          ? this.performanceData.errorCount / this.performanceData.requestCount
          : 0;
      case 'request_count':
        return this.performanceData.requestCount;
      case 'average_latency_ms':
        return this.performanceData.requestCount > 0
          ? this.performanceData.totalLatency / this.performanceData.requestCount
          : 0;

      // ── Business metrics (last-hour count from DB) ──
      default: {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { count } = await this.supabase
          .from('business_metrics')
          .select('id', { count: 'exact', head: true })
          .eq('metric_name', metricName)
          .gte('recorded_at', oneHourAgo);
        return count || 0;
      }
    }
  }

  private evaluateAlertCondition(value: number, threshold: number, operator: string): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  private async triggerAlert(rule: AlertRule, currentValue: number): Promise<void> {
    const alertEvent: AlertEvent = {
      id: this.generateAlertId(),
      rule_id: rule.id,
      metric_name: rule.metric,
      current_value: currentValue,
      threshold: rule.threshold,
      status: 'firing',
      started_at: new Date(),
      metadata: rule.metadata
    };

    this.activeAlerts.set(rule.id, alertEvent);

    await this.supabase.from('alert_events').insert(alertEvent);
    
    // Send notifications through configured channels
    await this.sendAlertNotifications(alertEvent, rule.channels);
  }

  private async resolveAlert(ruleId: string): Promise<void> {
    const alert = this.activeAlerts.get(ruleId);
    if (alert) {
      alert.status = 'resolved';
      alert.resolved_at = new Date();

      await this.supabase
        .from('alert_events')
        .update({ status: 'resolved', resolved_at: alert.resolved_at })
        .eq('id', alert.id);

      this.activeAlerts.delete(ruleId);
    }
  }

  private async sendAlertNotifications(alert: AlertEvent, channels: string[]): Promise<void> {
    // Implementation would integrate with notification systems
    // Slack, email, PagerDuty, etc.
    defaultLogger.info(`Alert triggered: ${alert.metric_name} = ${alert.current_value} (threshold: ${alert.threshold})`);
  }
}

// Export singleton instance — use global to survive Next.js HMR in dev
// without this, every hot-reload stacks new setIntervals and Supabase clients
declare global {
  var __nodeObservability: NodeObservabilityService | undefined;
}

export const observability: NodeObservabilityService =
  globalThis.__nodeObservability ?? (globalThis.__nodeObservability = new NodeObservabilityService());
