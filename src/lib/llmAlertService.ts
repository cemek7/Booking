import { createClient } from '@/lib/supabase/client';

export interface NotificationConfig {
  tenant_id: string;
  email_notifications: boolean;
  sms_notifications: boolean;
  whatsapp_notifications: boolean;
  notification_email?: string;
  notification_phone?: string;
  notification_threshold: number; // percentage (0-100)
  budget_alerts: boolean;
  quota_alerts: boolean;
  daily_reports: boolean;
}

export interface AlertNotification {
  id?: string;
  tenant_id: string;
  alert_type: 'quota_warning' | 'quota_exceeded' | 'budget_warning' | 'budget_exceeded' | 'daily_report' | 'unusual_spike';
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  channels: ('email' | 'sms' | 'whatsapp' | 'in_app')[];
  data: Record<string, any>;
  sent_at?: string;
  status: 'pending' | 'sent' | 'failed' | 'retry';
  retry_count: number;
  created_at?: string;
}

class LLMAlertService {
  private supabase = createClient();

  /**
   * Send alert notification for LLM usage violations
   */
  async sendLLMAlert(
    tenantId: string,
    alertType: AlertNotification['alert_type'],
    data: {
      currentUsage: number;
      limit: number;
      percentage: number;
      metric: 'tokens' | 'cost' | 'requests';
      [key: string]: any;
    }
  ): Promise<void> {
    try {
      // Get tenant notification config
      const config = await this.getNotificationConfig(tenantId);
      if (!config) {
        console.warn(`No notification config found for tenant ${tenantId}`);
        return;
      }

      // Generate alert content
      const alertContent = this.generateAlertContent(alertType, data);
      
      // Determine notification channels
      const channels = this.getNotificationChannels(config, alertType);
      
      if (channels.length === 0) {
        console.log(`No notification channels enabled for tenant ${tenantId}, alert type ${alertType}`);
        return;
      }

      // Create alert record
      const alert: Omit<AlertNotification, 'id' | 'created_at'> = {
        tenant_id: tenantId,
        alert_type: alertType,
        title: alertContent.title,
        message: alertContent.message,
        severity: alertContent.severity,
        channels,
        data,
        status: 'pending',
        retry_count: 0
      };

      const { data: savedAlert, error } = await this.supabase
        .from('llm_alert_notifications')
        .insert(alert)
        .select()
        .single();

      if (error) {
        console.error('Failed to save alert notification:', error);
        return;
      }

      // Send notifications
      await this.deliverAlert(savedAlert, config);

    } catch (error) {
      console.error('Failed to send LLM alert:', error);
    }
  }

  /**
   * Get notification configuration for tenant
   */
  async getNotificationConfig(tenantId: string): Promise<NotificationConfig | null> {
    try {
      // Try to get from tenant_settings first
      const { data: settings, error: settingsError } = await this.supabase
        .from('tenant_settings')
        .select(`
          tenant_id,
          email_notifications,
          sms_notifications,
          whatsapp_notifications,
          llm_notification_threshold,
          llm_budget_alerts,
          llm_quota_alerts
        `)
        .eq('tenant_id', tenantId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') {
        console.error('Failed to get tenant notification settings:', settingsError);
      }

      // Get tenant owner email for notifications
      const { data: owner, error: ownerError } = await this.supabase
        .from('profiles')
        .select('email, phone')
        .eq('tenant_id', tenantId)
        .eq('role', 'owner')
        .single();

      if (ownerError) {
        console.warn('Failed to get tenant owner details:', ownerError);
      }

      // Return combined config
      return {
        tenant_id: tenantId,
        email_notifications: settings?.email_notifications ?? true,
        sms_notifications: settings?.sms_notifications ?? false,
        whatsapp_notifications: settings?.whatsapp_notifications ?? false,
        notification_email: owner?.email,
        notification_phone: owner?.phone,
        notification_threshold: settings?.llm_notification_threshold ?? 80,
        budget_alerts: settings?.llm_budget_alerts ?? true,
        quota_alerts: settings?.llm_quota_alerts ?? true,
        daily_reports: false // Can be configured later
      };

    } catch (error) {
      console.error('Error getting notification config:', error);
      return null;
    }
  }

  /**
   * Generate alert content based on type and data
   */
  private generateAlertContent(alertType: AlertNotification['alert_type'], data: any) {
    const { currentUsage, limit, percentage, metric } = data;
    
    switch (alertType) {
      case 'quota_warning':
        return {
          title: `LLM ${metric} usage warning`,
          message: `Your ${metric} usage is at ${percentage.toFixed(1)}% (${currentUsage.toLocaleString()}/${limit.toLocaleString()}) of your monthly limit. Consider upgrading your plan or optimizing usage.`,
          severity: 'medium' as const
        };
      
      case 'quota_exceeded':
        return {
          title: `LLM ${metric} quota exceeded`,
          message: `Your ${metric} usage has exceeded the monthly limit: ${currentUsage.toLocaleString()}/${limit.toLocaleString()} (${percentage.toFixed(1)}%). AI features may be paused to prevent overage charges.`,
          severity: 'critical' as const
        };
      
      case 'budget_warning':
        return {
          title: `LLM budget warning`,
          message: `Your LLM costs are at ${percentage.toFixed(1)}% ($${currentUsage.toFixed(2)}/$${limit.toFixed(2)}) of your monthly budget. Consider monitoring usage or upgrading your plan.`,
          severity: 'medium' as const
        };
      
      case 'budget_exceeded':
        return {
          title: `LLM budget exceeded`,
          message: `Your monthly LLM budget has been exceeded: $${currentUsage.toFixed(2)}/$${limit.toFixed(2)} (${percentage.toFixed(1)}%). AI features have been paused to prevent additional charges.`,
          severity: 'critical' as const
        };
      
      case 'daily_report':
        return {
          title: `Daily LLM usage report`,
          message: `Today's usage: ${currentUsage.toLocaleString()} ${metric}. Monthly progress: ${percentage.toFixed(1)}% of limit used.`,
          severity: 'low' as const
        };
      
      case 'unusual_spike':
        return {
          title: `Unusual LLM usage spike detected`,
          message: `Your ${metric} usage has increased significantly: ${currentUsage.toLocaleString()} in the last hour. This may indicate an issue or increased demand.`,
          severity: 'high' as const
        };
      
      default:
        return {
          title: `LLM usage alert`,
          message: `${metric} usage: ${currentUsage.toLocaleString()}/${limit.toLocaleString()} (${percentage.toFixed(1)}%)`,
          severity: 'medium' as const
        };
    }
  }

  /**
   * Determine which notification channels to use
   */
  private getNotificationChannels(
    config: NotificationConfig,
    alertType: AlertNotification['alert_type']
  ): AlertNotification['channels'] {
    const channels: AlertNotification['channels'] = ['in_app']; // Always include in-app

    // Critical alerts go to all enabled channels
    const isCritical = alertType.includes('exceeded');
    
    if (config.email_notifications && (isCritical || config.budget_alerts || config.quota_alerts)) {
      channels.push('email');
    }
    
    if (config.sms_notifications && isCritical) {
      channels.push('sms');
    }
    
    if (config.whatsapp_notifications && (isCritical || alertType === 'daily_report')) {
      channels.push('whatsapp');
    }

    return channels;
  }

  /**
   * Deliver alert through configured channels
   */
  private async deliverAlert(
    alert: AlertNotification,
    config: NotificationConfig
  ): Promise<void> {
    const deliveryPromises = alert.channels.map(async (channel) => {
      try {
        switch (channel) {
          case 'email':
            await this.sendEmailAlert(alert, config);
            break;
          case 'sms':
            await this.sendSMSAlert(alert, config);
            break;
          case 'whatsapp':
            await this.sendWhatsAppAlert(alert, config);
            break;
          case 'in_app':
            await this.saveInAppAlert(alert);
            break;
          default:
            console.warn(`Unknown notification channel: ${channel}`);
        }
      } catch (error) {
        console.error(`Failed to send ${channel} alert:`, error);
        throw error;
      }
    });

    try {
      await Promise.allSettled(deliveryPromises);
      
      // Update alert status
      await this.supabase
        .from('llm_alert_notifications')
        .update({ 
          status: 'sent', 
          sent_at: new Date().toISOString() 
        })
        .eq('id', alert.id);

    } catch (error) {
      console.error('Failed to deliver alerts:', error);
      
      // Update alert status to failed and increment retry count
      await this.supabase
        .from('llm_alert_notifications')
        .update({ 
          status: 'failed', 
          retry_count: alert.retry_count + 1 
        })
        .eq('id', alert.id);
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(
    alert: AlertNotification,
    config: NotificationConfig
  ): Promise<void> {
    if (!config.notification_email) {
      throw new Error('No email address configured for notifications');
    }

    // TODO: Integrate with your email service (SendGrid, AWS SES, etc.)
    // For now, we'll log the email that would be sent
    console.log('EMAIL ALERT:', {
      to: config.notification_email,
      subject: `[BOOKA] ${alert.title}`,
      body: `
        ${alert.title}
        
        ${alert.message}
        
        Severity: ${alert.severity.toUpperCase()}
        Time: ${new Date().toLocaleString()}
        
        Tenant ID: ${alert.tenant_id}
        
        ---
        Manage your notification settings: https://app.booka.com/settings/notifications
      `,
      data: alert.data
    });

    // Simulate email sending delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Send SMS alert
   */
  private async sendSMSAlert(
    alert: AlertNotification,
    config: NotificationConfig
  ): Promise<void> {
    if (!config.notification_phone) {
      throw new Error('No phone number configured for SMS notifications');
    }

    // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
    console.log('SMS ALERT:', {
      to: config.notification_phone,
      message: `BOOKA: ${alert.title} - ${alert.message.substring(0, 100)}...`,
      data: alert.data
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Send WhatsApp alert
   */
  private async sendWhatsAppAlert(
    alert: AlertNotification,
    config: NotificationConfig
  ): Promise<void> {
    if (!config.notification_phone) {
      throw new Error('No phone number configured for WhatsApp notifications');
    }

    // TODO: Integrate with WhatsApp Business API
    console.log('WHATSAPP ALERT:', {
      to: config.notification_phone,
      message: `🚨 *${alert.title}*\n\n${alert.message}\n\n_Severity: ${alert.severity}_`,
      data: alert.data
    });

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Save in-app alert
   */
  private async saveInAppAlert(alert: AlertNotification): Promise<void> {
    const { error } = await this.supabase
      .from('in_app_notifications')
      .insert({
        tenant_id: alert.tenant_id,
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        type: 'llm_usage_alert',
        data: alert.data,
        read: false,
        created_at: new Date().toISOString()
      });

    if (error) {
      console.error('Failed to save in-app alert:', error);
      throw error;
    }
  }

  /**
   * Get recent alerts for tenant
   */
  async getRecentAlerts(tenantId: string, days: number = 7): Promise<AlertNotification[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await this.supabase
        .from('llm_alert_notifications')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Failed to get recent alerts:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting recent alerts:', error);
      return [];
    }
  }

  /**
   * Mark alert as acknowledged
   */
  async acknowledgeAlert(alertId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('llm_alert_notifications')
        .update({ 
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('Failed to acknowledge alert:', error);
      }
    } catch (error) {
      console.error('Error acknowledging alert:', error);
    }
  }
}

// Export singleton instance
export const llmAlertService = new LLMAlertService();

// Convenience functions
export async function sendLLMUsageAlert(
  tenantId: string,
  alertType: AlertNotification['alert_type'],
  data: {
    currentUsage: number;
    limit: number;
    percentage: number;
    metric: 'tokens' | 'cost' | 'requests';
  }
): Promise<void> {
  await llmAlertService.sendLLMAlert(tenantId, alertType, data);
}

export async function getNotificationConfig(tenantId: string): Promise<NotificationConfig | null> {
  return await llmAlertService.getNotificationConfig(tenantId);
}

export async function getRecentLLMAlerts(tenantId: string, days?: number): Promise<AlertNotification[]> {
  return await llmAlertService.getRecentAlerts(tenantId, days);
}