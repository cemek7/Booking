/**
 * Error Alerting Module
 * 
 * Provides critical error alerting capabilities via multiple channels:
 * - Console logging (always)
 * - Email notifications (configurable)
 * - Slack webhooks (configurable)
 * - Database audit trail (always)
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AlertContext {
  /**
   * Operation that failed (e.g., 'booking_creation', 'payment_processing')
   */
  operation: string;
  
  /**
   * Tenant ID (for multi-tenant tracking)
   */
  tenantId?: string;
  
  /**
   * Resource ID (booking ID, customer ID, etc.)
   */
  resourceId?: string;
  
  /**
   * Additional metadata
   */
  metadata?: Record<string, any>;
  
  /**
   * Stack trace if available
   */
  stackTrace?: string;
}

export interface AlertConfig {
  /**
   * Minimum severity level to trigger alerts (default: 'error')
   */
  minSeverity?: AlertSeverity;
  
  /**
   * Email recipients for alerts
   */
  emailRecipients?: string[];
  
  /**
   * Slack webhook URL
   */
  slackWebhookUrl?: string;
  
  /**
   * Enable database logging (default: true)
   */
  enableDatabaseLogging?: boolean;
}

const SEVERITY_LEVELS: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3
};

/**
 * Alert Service Class
 */
export class AlertService {
  private config: Required<AlertConfig>;
  private supabase;

  constructor(config: AlertConfig = {}) {
    this.config = {
      minSeverity: config.minSeverity || 'error',
      emailRecipients: config.emailRecipients || [],
      slackWebhookUrl: config.slackWebhookUrl || process.env.SLACK_WEBHOOK_URL || '',
      enableDatabaseLogging: config.enableDatabaseLogging ?? true
    };
    this.supabase = createServerSupabaseClient();
  }

  /**
   * Send a critical alert
   */
  async sendCriticalAlert(error: Error | string, context: AlertContext): Promise<void> {
    await this.sendAlert('critical', error, context);
  }

  /**
   * Send an error alert
   */
  async sendErrorAlert(error: Error | string, context: AlertContext): Promise<void> {
    await this.sendAlert('error', error, context);
  }

  /**
   * Send a warning alert
   */
  async sendWarningAlert(message: string, context: AlertContext): Promise<void> {
    await this.sendAlert('warning', message, context);
  }

  /**
   * Send an info alert
   */
  async sendInfoAlert(message: string, context: AlertContext): Promise<void> {
    await this.sendAlert('info', message, context);
  }

  /**
   * Send alert with specified severity
   */
  private async sendAlert(
    severity: AlertSeverity,
    errorOrMessage: Error | string,
    context: AlertContext
  ): Promise<void> {
    // Check if severity meets minimum threshold
    if (SEVERITY_LEVELS[severity] < SEVERITY_LEVELS[this.config.minSeverity]) {
      return;
    }

    const errorMessage = errorOrMessage instanceof Error 
      ? errorOrMessage.message 
      : errorOrMessage;
    
    const stackTrace = errorOrMessage instanceof Error 
      ? errorOrMessage.stack 
      : context.stackTrace;

    const alert = {
      severity,
      message: errorMessage,
      operation: context.operation,
      tenantId: context.tenantId,
      resourceId: context.resourceId,
      metadata: context.metadata || {},
      stackTrace,
      timestamp: new Date().toISOString()
    };

    // Log to console (always)
    this.logToConsole(alert);

    // Log to database
    if (this.config.enableDatabaseLogging) {
      await this.logToDatabase(alert);
    }

    // Send to external channels for high severity
    if (severity === 'critical' || severity === 'error') {
      await Promise.all([
        this.sendToSlack(alert),
        this.sendToEmail(alert)
      ]);
    }
  }

  /**
   * Log alert to console with color coding
   */
  private logToConsole(alert: any): void {
    const emoji = {
      info: 'ℹ️',
      warning: '⚠️',
      error: '❌',
      critical: '🚨'
    };

    console.error(
      `${emoji[alert.severity as AlertSeverity]} [${alert.severity.toUpperCase()}] ${alert.operation}:`,
      alert.message
    );
    
    if (alert.tenantId) {
      console.error(`  Tenant: ${alert.tenantId}`);
    }
    
    if (alert.resourceId) {
      console.error(`  Resource: ${alert.resourceId}`);
    }
    
    if (alert.metadata && Object.keys(alert.metadata).length > 0) {
      console.error('  Metadata:', JSON.stringify(alert.metadata, null, 2));
    }
    
    if (alert.stackTrace) {
      console.error('  Stack:', alert.stackTrace);
    }
  }

  /**
   * Log alert to database for audit trail
   */
  private async logToDatabase(alert: any): Promise<void> {
    try {
      await this.supabase
        .from('error_logs')
        .insert({
          severity: alert.severity,
          message: alert.message,
          operation: alert.operation,
          tenant_id: alert.tenantId,
          resource_id: alert.resourceId,
          metadata: alert.metadata,
          stack_trace: alert.stackTrace,
          created_at: alert.timestamp
        });
    } catch (error) {
      // Don't fail if logging fails
      console.error('[Alert] Failed to log to database:', error);
    }
  }

  /**
   * Send alert to Slack
   */
  private async sendToSlack(alert: any): Promise<void> {
    if (!this.config.slackWebhookUrl) {
      return;
    }

    const color = {
      info: '#36a64f',
      warning: '#ff9900',
      error: '#ff0000',
      critical: '#990000'
    };

    const payload = {
      attachments: [
        {
          color: color[alert.severity as AlertSeverity],
          title: `🚨 ${alert.severity.toUpperCase()}: ${alert.operation}`,
          text: alert.message,
          fields: [
            ...(alert.tenantId ? [{ title: 'Tenant', value: alert.tenantId, short: true }] : []),
            ...(alert.resourceId ? [{ title: 'Resource', value: alert.resourceId, short: true }] : []),
            { title: 'Timestamp', value: alert.timestamp, short: false }
          ],
          footer: 'Booka Alert System',
          ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
        }
      ]
    };

    try {
      await fetch(this.config.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error('[Alert] Failed to send to Slack:', error);
    }
  }

  /**
   * Send alert via email (placeholder - implement with actual email service)
   */
  private async sendToEmail(alert: any): Promise<void> {
    if (this.config.emailRecipients.length === 0) {
      return;
    }

    // TODO: Implement email sending via SendGrid, AWS SES, etc.
    console.log('[Alert] Would send email to:', this.config.emailRecipients);
    console.log('[Alert] Email content:', alert);
  }
}

/**
 * Singleton alert service instance
 */
let alertServiceInstance: AlertService | null = null;

/**
 * Get or create alert service instance
 */
export function getAlertService(config?: AlertConfig): AlertService {
  if (!alertServiceInstance) {
    alertServiceInstance = new AlertService(config);
  }
  return alertServiceInstance;
}

/**
 * Convenience functions for common alert scenarios
 */
export async function alertBookingFailure(error: Error, bookingId: string, tenantId: string): Promise<void> {
  const alertService = getAlertService();
  await alertService.sendCriticalAlert(error, {
    operation: 'booking_creation',
    tenantId,
    resourceId: bookingId,
    metadata: { error_type: 'booking_failure' }
  });
}

export async function alertPaymentFailure(error: Error, transactionId: string, tenantId: string): Promise<void> {
  const alertService = getAlertService();
  await alertService.sendCriticalAlert(error, {
    operation: 'payment_processing',
    tenantId,
    resourceId: transactionId,
    metadata: { error_type: 'payment_failure' }
  });
}

export async function alertWebhookFailure(error: Error, webhookType: string, tenantId: string): Promise<void> {
  const alertService = getAlertService();
  await alertService.sendErrorAlert(error, {
    operation: 'webhook_processing',
    tenantId,
    metadata: { webhook_type: webhookType, error_type: 'webhook_failure' }
  });
}

export async function alertNotificationFailure(error: Error, notificationType: string, tenantId: string): Promise<void> {
  const alertService = getAlertService();
  await alertService.sendErrorAlert(error, {
    operation: 'notification_sending',
    tenantId,
    metadata: { notification_type: notificationType, error_type: 'notification_failure' }
  });
}
