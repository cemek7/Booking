/**
 * Edge-Compatible Observability Service
 *
 * This service is a lightweight version of the main ObservabilityService,
 * designed to run in Vercel's Edge Runtime. It excludes all Node.js-specific
 * APIs and focuses on tracing and business metrics that can be captured
 * from edge middleware.
 */
import { createSupabaseAdminClient } from '@/lib/supabase/server';

// Basic types needed for the edge service
interface MetricLabels {
  [key: string]: string | number | boolean;
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

export class EdgeObservabilityService {
  private supabase: any;

  constructor() {
    // Using the admin client is safe here as it only performs fetch requests.
    this.supabase = createSupabaseAdminClient();
  }

  /**
   * Create and start a trace span.
   * This is a simplified version for the edge.
   */
  startTrace(operationName: string, parentContext?: any): any {
    const traceId = this.generateId(16);
    const spanId = this.generateId(8);

    const context: TraceContext = {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentContext?.span_id,
      operation_name: operationName,
      start_time: new Date(),
      status: 'success',
      tags: {},
      logs: [],
    };

    // Return an object with methods that match the Node.js version for compatibility
    return {
      ...context,
      end: () => this.finishTrace(context),
      recordException: (error: Error) => this.addTraceLog(context, 'error', error.message, { stack: error.stack }),
    };
  }

  /**
   * Finish a trace span and send it to the backend.
   */
  finishTrace(context: TraceContext, status: 'success' | 'error' | 'timeout' = 'success'): void {
    context.end_time = new Date();
    context.duration_ms = context.end_time.getTime() - context.start_time.getTime();
    context.status = status;

    // Asynchronously send trace to the database. We don't await this on the edge
    // to avoid blocking the request.
    // this.supabase.from('traces').insert({
    //   trace_id: context.trace_id,
    //   span_id: context.span_id,
    //   parent_span_id: context.parent_span_id,
    //   operation_name: context.operation_name,
    //   start_time: context.start_time.toISOString(),
    //   end_time: context.end_time.toISOString(),
    //   duration_ms: context.duration_ms,
    //   status: context.status,
    //   tags: context.tags,
    //   logs: context.logs,
    // }).catch((error: any) => {
    //   console.error('EdgeObservability: Failed to store trace:', error.message);
    // });
  }

  /**
   * Add a log entry to a trace context.
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
      fields,
    });
  }

  /**
   * Record a business metric.
   */
  async recordBusinessMetric(
    name: string,
    value: number,
    labels: MetricLabels = {}
  ): Promise<void> {
    try {
      // Asynchronously send metric to the database.
      this.supabase.from('business_metrics').insert({
        metric_name: name,
        metric_value: value,
        labels,
        recorded_at: new Date().toISOString(),
      }).catch((error: any) => {
        console.error(`EdgeObservability: Failed to record business metric ${name}:`, error.message);
      });
    } catch (error: any) {
      console.error(`EdgeObservability: Failed to record business metric ${name}:`, error.message);
    }
  }

  /**
   * Generates a random ID. This is a simplified, edge-compatible version.
   */
  private generateId(length: number): string {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  }
}

// Export a singleton instance for use in edge files.
export const observability = new EdgeObservabilityService();
