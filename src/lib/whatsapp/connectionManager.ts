import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createEvolutionClient, getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';

export interface ConnectionStatus {
  id: string;
  tenant_id: string;
  instance_name: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error' | 'reconnecting';
  phone_number?: string;
  battery_level?: number;
  signal_strength?: number;
  last_seen: string;
  connection_time?: string;
  error_message?: string;
  qr_code?: string;
  webhook_url?: string;
  is_business: boolean;
  profile_name?: string;
  profile_picture?: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ConnectionMetrics {
  tenant_id: string;
  instance_name: string;
  messages_sent_today: number;
  messages_received_today: number;
  uptime_percentage: number;
  average_response_time: number;
  error_count_24h: number;
  last_message_timestamp?: string;
  total_conversations: number;
  active_conversations: number;
}

class WhatsAppConnectionManager {
  private supabase = createServerSupabaseClient();
  private connectionChecks = new Map<string, NodeJS.Timeout>();
  private readonly CHECK_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 15000; // 15 seconds

  /**
   * Start monitoring WhatsApp connections
   */
  async startMonitoring(): Promise<void> {
    console.log('🔍 Starting WhatsApp connection monitoring...');

    // Get all active WhatsApp configurations
    const { data: configs, error } = await this.supabase
      .from('tenant_whatsapp_configs')
      .select('*')
      .eq('active', true);

    if (error) {
      console.error('Failed to load WhatsApp configurations:', error);
      return;
    }

    // Start monitoring each configuration
    for (const config of configs || []) {
      await this.startInstanceMonitoring(config);
    }

    console.log(`✅ Started monitoring ${configs?.length || 0} WhatsApp instances`);
  }

  /**
   * Stop all connection monitoring
   */
  stopMonitoring(): void {
    console.log('🛑 Stopping WhatsApp connection monitoring...');

    for (const [instanceName, interval] of this.connectionChecks) {
      clearInterval(interval);
      console.log(`Stopped monitoring ${instanceName}`);
    }

    this.connectionChecks.clear();
    console.log('✅ All connection monitoring stopped');
  }

  /**
   * Start monitoring a specific instance
   */
  private async startInstanceMonitoring(config: any): Promise<void> {
    const instanceName = config.instance_name;
    
    // Stop existing monitoring if any
    if (this.connectionChecks.has(instanceName)) {
      clearInterval(this.connectionChecks.get(instanceName)!);
    }

    // Start periodic checks
    const interval = setInterval(async () => {
      await this.checkInstanceConnection(config);
    }, this.CHECK_INTERVAL);

    this.connectionChecks.set(instanceName, interval);

    // Initial check
    await this.checkInstanceConnection(config);

    console.log(`📱 Started monitoring instance: ${instanceName}`);
  }

  /**
   * Check connection status for a specific instance
   */
  private async checkInstanceConnection(config: any): Promise<void> {
    const instanceName = config.instance_name;
    const tenantId = config.tenant_id;

    try {
      console.log(`🔍 Checking connection for ${instanceName}...`);

      const evolutionClient = createEvolutionClient(config);
      
      // Get instance status
      const statusResult = await this.getInstanceStatus(evolutionClient, instanceName);
      
      if (statusResult.success) {
        await this.updateConnectionStatus(tenantId, instanceName, statusResult.status);
        
        // Update metrics
        await this.updateConnectionMetrics(tenantId, instanceName);
      } else {
        await this.handleConnectionError(tenantId, instanceName, statusResult.error);
      }

    } catch (error) {
      console.error(`Error checking connection for ${instanceName}:`, error);
      await this.handleConnectionError(
        tenantId,
        instanceName,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Get instance status from Evolution API
   */
  private async getInstanceStatus(
    evolutionClient: any,
    instanceName: string
  ): Promise<{
    success: boolean;
    status?: ConnectionStatus;
    error?: string;
  }> {
    try {
      // This would call the Evolution API to get instance status
      // For now, simulating the response structure
      const response = await fetch(`${evolutionClient.baseUrl}/instance/connectionState/${instanceName}`, {
        headers: {
          'apikey': evolutionClient.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: this.CONNECTION_TIMEOUT
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();

      // Map Evolution API response to our status format
      const status: Partial<ConnectionStatus> = {
        status: this.mapEvolutionStatus(data.state),
        phone_number: data.instance?.phone || null,
        battery_level: data.device?.battery || null,
        signal_strength: data.device?.signal || null,
        last_seen: new Date().toISOString(),
        is_business: data.instance?.businessProfile ? true : false,
        profile_name: data.instance?.name || null,
        profile_picture: data.instance?.profilePictureUrl || null,
        qr_code: data.qrcode || null,
        metadata: {
          platform: data.device?.platform,
          version: data.device?.version,
          pushname: data.instance?.pushname,
          wid: data.instance?.wid
        }
      };

      return { success: true, status: status as ConnectionStatus };

    } catch (error) {
      console.error('Evolution API error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'API request failed'
      };
    }
  }

  /**
   * Map Evolution API status to our status enum
   */
  private mapEvolutionStatus(evolutionState: string): ConnectionStatus['status'] {
    const statusMap: Record<string, ConnectionStatus['status']> = {
      'open': 'connected',
      'close': 'disconnected',
      'connecting': 'connecting',
      'qr': 'connecting',
      'error': 'error'
    };

    return statusMap[evolutionState] || 'disconnected';
  }

  /**
   * Update connection status in database
   */
  private async updateConnectionStatus(
    tenantId: string,
    instanceName: string,
    statusUpdate: Partial<ConnectionStatus>
  ): Promise<void> {
    try {
      const updates = {
        ...statusUpdate,
        updated_at: new Date().toISOString(),
        ...(statusUpdate.status === 'connected' && !statusUpdate.connection_time ? {
          connection_time: new Date().toISOString()
        } : {})
      };

      const { error } = await this.supabase
        .from('whatsapp_connections')
        .upsert({
          tenant_id: tenantId,
          instance_name: instanceName,
          ...updates
        }, {
          onConflict: 'tenant_id,instance_name'
        });

      if (error) {
        console.error('Failed to update connection status:', error);
      }

      // Send real-time update
      await this.sendRealtimeUpdate(tenantId, instanceName, statusUpdate);

    } catch (error) {
      console.error('Error updating connection status:', error);
    }
  }

  /**
   * Handle connection error
   */
  private async handleConnectionError(
    tenantId: string,
    instanceName: string,
    errorMessage: string
  ): Promise<void> {
    console.warn(`Connection error for ${instanceName}: ${errorMessage}`);

    await this.updateConnectionStatus(tenantId, instanceName, {
      status: 'error',
      error_message: errorMessage,
      last_seen: new Date().toISOString()
    });

    // Log error for monitoring
    await this.logConnectionError(tenantId, instanceName, errorMessage);
  }

  /**
   * Update connection metrics
   */
  private async updateConnectionMetrics(
    tenantId: string,
    instanceName: string
  ): Promise<void> {
    try {
      // Get today's message counts
      const today = new Date().toISOString().split('T')[0];
      
      const { data: sentMessages } = await this.supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('from_me', true)
        .gte('created_at', `${today}T00:00:00Z`)
        .lt('created_at', `${today}T23:59:59Z`);

      const { data: receivedMessages } = await this.supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('from_me', false)
        .gte('created_at', `${today}T00:00:00Z`)
        .lt('created_at', `${today}T23:59:59Z`);

      // Get conversation counts
      const { data: conversations } = await this.supabase
        .from('whatsapp_conversations')
        .select('id, last_activity')
        .eq('tenant_id', tenantId);

      const activeConversations = conversations?.filter(conv => {
        const lastActivity = new Date(conv.last_activity);
        const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
        return hoursSinceActivity < 24; // Active if activity within 24 hours
      }) || [];

      // Calculate uptime (simplified - based on error frequency)
      const { data: errors } = await this.supabase
        .from('whatsapp_connection_logs')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('instance_name', instanceName)
        .eq('level', 'error')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

      const errorCount = errors?.length || 0;
      const uptimePercentage = Math.max(0, 100 - (errorCount * 2)); // 2% penalty per error

      const metrics: Partial<ConnectionMetrics> = {
        messages_sent_today: sentMessages?.length || 0,
        messages_received_today: receivedMessages?.length || 0,
        uptime_percentage: uptimePercentage,
        average_response_time: 1500, // TODO: Calculate from actual response times
        error_count_24h: errorCount,
        total_conversations: conversations?.length || 0,
        active_conversations: activeConversations.length,
        last_message_timestamp: receivedMessages?.[0]?.created_at || null
      };

      await this.supabase
        .from('whatsapp_connection_metrics')
        .upsert({
          tenant_id: tenantId,
          instance_name: instanceName,
          ...metrics,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'tenant_id,instance_name'
        });

    } catch (error) {
      console.error('Error updating connection metrics:', error);
    }
  }

  /**
   * Send real-time update via Supabase Realtime
   */
  private async sendRealtimeUpdate(
    tenantId: string,
    instanceName: string,
    update: Partial<ConnectionStatus>
  ): Promise<void> {
    try {
      // Broadcast to realtime channel
      await this.supabase.channel(`whatsapp:${tenantId}`)
        .send({
          type: 'broadcast',
          event: 'connection_update',
          payload: {
            instance_name: instanceName,
            ...update,
            timestamp: new Date().toISOString()
          }
        });
    } catch (error) {
      console.error('Error sending realtime update:', error);
    }
  }

  /**
   * Log connection error
   */
  private async logConnectionError(
    tenantId: string,
    instanceName: string,
    errorMessage: string
  ): Promise<void> {
    try {
      await this.supabase
        .from('whatsapp_connection_logs')
        .insert({
          tenant_id: tenantId,
          instance_name: instanceName,
          level: 'error',
          message: errorMessage,
          metadata: {
            timestamp: new Date().toISOString(),
            source: 'connection_manager'
          },
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Error logging connection error:', error);
    }
  }

  /**
   * Get connection status for tenant
   */
  async getConnectionStatus(tenantId: string): Promise<ConnectionStatus[]> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_connections')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Failed to get connection status:', error);
        return [];
      }

      return data as ConnectionStatus[];
    } catch (error) {
      console.error('Error getting connection status:', error);
      return [];
    }
  }

  /**
   * Get connection metrics for tenant
   */
  async getConnectionMetrics(tenantId: string): Promise<ConnectionMetrics[]> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_connection_metrics')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Failed to get connection metrics:', error);
        return [];
      }

      return data as ConnectionMetrics[];
    } catch (error) {
      console.error('Error getting connection metrics:', error);
      return [];
    }
  }

  /**
   * Force reconnection for an instance
   */
  async forceReconnect(tenantId: string, instanceName: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const config = await getTenantWhatsAppConfig(tenantId);
      if (!config || config.instanceName !== instanceName) {
        return { success: false, error: 'Configuration not found' };
      }

      const evolutionClient = createEvolutionClient(config);

      // Call Evolution API to restart instance
      const response = await fetch(`${evolutionClient.baseUrl}/instance/restart/${instanceName}`, {
        method: 'PUT',
        headers: {
          'apikey': evolutionClient.apiKey,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Restart failed: ${response.status} ${response.statusText}`
        };
      }

      // Update status to reconnecting
      await this.updateConnectionStatus(tenantId, instanceName, {
        status: 'reconnecting',
        error_message: null
      });

      // Log reconnection attempt
      await this.supabase
        .from('whatsapp_connection_logs')
        .insert({
          tenant_id: tenantId,
          instance_name: instanceName,
          level: 'info',
          message: 'Manual reconnection initiated',
          created_at: new Date().toISOString()
        });

      return { success: true };

    } catch (error) {
      console.error('Error forcing reconnection:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get QR code for instance setup
   */
  async getQRCode(tenantId: string, instanceName: string): Promise<{
    success: boolean;
    qrCode?: string;
    error?: string;
  }> {
    try {
      const config = await getTenantWhatsAppConfig(tenantId);
      if (!config || config.instanceName !== instanceName) {
        return { success: false, error: 'Configuration not found' };
      }

      const evolutionClient = createEvolutionClient(config);

      // Get QR code from Evolution API
      const response = await fetch(`${evolutionClient.baseUrl}/instance/connect/${instanceName}`, {
        headers: {
          'apikey': evolutionClient.apiKey
        }
      });

      if (!response.ok) {
        return {
          success: false,
          error: `QR code request failed: ${response.status}`
        };
      }

      const data = await response.json();

      return {
        success: true,
        qrCode: data.qrcode || data.qr
      };

    } catch (error) {
      console.error('Error getting QR code:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Export singleton instance
export const whatsappConnectionManager = new WhatsAppConnectionManager();

// Convenience functions
export async function startConnectionMonitoring(): Promise<void> {
  await whatsappConnectionManager.startMonitoring();
}

export function stopConnectionMonitoring(): void {
  whatsappConnectionManager.stopMonitoring();
}