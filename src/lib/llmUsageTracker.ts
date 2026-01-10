import { createClient } from '@/lib/supabase/client';
import { sendLLMUsageAlert } from '@/lib/llmAlertService';

export interface LLMUsageRecord {
  id?: string;
  tenant_id: string;
  user_id: string;
  provider: 'openrouter' | 'openai' | 'anthropic' | 'local';
  model: string;
  operation: 'intent_detection' | 'paraphrasing' | 'conversation' | 'booking_assistant' | 'template_generation';
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  request_id?: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface LLMUsageQuota {
  tenant_id: string;
  plan: 'free' | 'premium' | 'enterprise';
  monthly_token_limit: number;
  monthly_cost_limit: number;
  monthly_request_limit: number;
  current_month_tokens: number;
  current_month_cost: number;
  current_month_requests: number;
  quota_reset_date: string;
  overage_allowed: boolean;
  notification_threshold: number; // percentage (0-100)
  ai_features_enabled: boolean;
}

export interface LLMUsageAlert {
  tenant_id: string;
  alert_type: 'quota_warning' | 'quota_exceeded' | 'budget_warning' | 'budget_exceeded' | 'unusual_spike';
  message: string;
  current_usage: number;
  limit: number;
  percentage: number;
  created_at: string;
}

class LLMUsageTracker {
  private supabase = createClient();

  /**
   * Record LLM usage for a tenant
   */
  async recordUsage(usage: Omit<LLMUsageRecord, 'id' | 'created_at'>): Promise<void> {
    try {
      // Insert usage record
      const { error: insertError } = await this.supabase
        .from('llm_usage')
        .insert({
          ...usage,
          created_at: new Date().toISOString()
        });

      if (insertError) {
        console.error('Failed to record LLM usage:', insertError);
        throw new Error('Failed to record LLM usage');
      }

      // Update quota counters
      await this.updateQuotaCounters(usage.tenant_id, usage.total_tokens, usage.cost_usd);

      // Check for quota violations and send alerts if needed
      await this.checkQuotaViolations(usage.tenant_id);

    } catch (error) {
      console.error('LLM usage tracking error:', error);
      // Don't throw - we don't want LLM tracking failures to break the main flow
    }
  }

  /**
   * Get current quota status for a tenant
   */
  async getQuotaStatus(tenantId: string): Promise<LLMUsageQuota | null> {
    try {
      const { data, error } = await this.supabase
        .from('llm_quotas')
        .select('*')
        .eq('tenant_id', tenantId)
        .single();

      if (error && error.code !== 'PGRST116') { // Not found is OK
        console.error('Failed to get quota status:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Error getting quota status:', error);
      return null;
    }
  }

  /**
   * Check if tenant can make LLM request
   */
  async canMakeRequest(tenantId: string, estimatedTokens: number = 1000): Promise<boolean> {
    try {
      const quota = await this.getQuotaStatus(tenantId);
      
      if (!quota) {
        // No quota set - assume free tier defaults
        const defaultQuota = await this.initializeQuota(tenantId, 'free');
        return defaultQuota ? this.canMakeRequest(tenantId, estimatedTokens) : false;
      }

      // Check if AI features are disabled
      if (!quota.ai_features_enabled) {
        return false;
      }

      // Check token limits
      if (quota.current_month_tokens + estimatedTokens > quota.monthly_token_limit && !quota.overage_allowed) {
        return false;
      }

      // Check request limits
      if (quota.current_month_requests >= quota.monthly_request_limit && !quota.overage_allowed) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error checking request permission:', error);
      return false; // Fail safely
    }
  }

  /**
   * Initialize quota for new tenant
   */
  async initializeQuota(tenantId: string, plan: 'free' | 'premium' | 'enterprise'): Promise<LLMUsageQuota | null> {
    try {
      const quotaConfig = this.getQuotaConfig(plan);
      const resetDate = new Date();
      resetDate.setMonth(resetDate.getMonth() + 1, 1); // First day of next month

      const quota: Omit<LLMUsageQuota, 'current_month_tokens' | 'current_month_cost' | 'current_month_requests'> = {
        tenant_id: tenantId,
        plan,
        monthly_token_limit: quotaConfig.tokens,
        monthly_cost_limit: quotaConfig.cost,
        monthly_request_limit: quotaConfig.requests,
        quota_reset_date: resetDate.toISOString(),
        overage_allowed: plan !== 'free',
        notification_threshold: 80,
        ai_features_enabled: true
      };

      const { data, error } = await this.supabase
        .from('llm_quotas')
        .upsert({
          ...quota,
          current_month_tokens: 0,
          current_month_cost: 0,
          current_month_requests: 0
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to initialize quota:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error initializing quota:', error);
      return null;
    }
  }

  /**
   * Get usage statistics for a tenant
   */
  async getUsageStats(tenantId: string, days: number = 30): Promise<{
    total_usage: LLMUsageRecord[];
    daily_aggregates: any[];
    operation_breakdown: any[];
    cost_trend: any[];
  } | null> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Get total usage
      const { data: totalUsage, error: usageError } = await this.supabase
        .from('llm_usage')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      if (usageError) {
        console.error('Failed to get usage stats:', usageError);
        return null;
      }

      // Calculate daily aggregates
      const dailyAggregates = this.aggregateUsageByDay(totalUsage || []);

      // Calculate operation breakdown
      const operationBreakdown = this.aggregateUsageByOperation(totalUsage || []);

      // Calculate cost trend
      const costTrend = this.calculateCostTrend(totalUsage || []);

      return {
        total_usage: totalUsage || [],
        daily_aggregates: dailyAggregates,
        operation_breakdown: operationBreakdown,
        cost_trend: costTrend
      };
    } catch (error) {
      console.error('Error getting usage statistics:', error);
      return null;
    }
  }

  /**
   * Update quota counters after usage
   */
  private async updateQuotaCounters(tenantId: string, tokens: number, cost: number): Promise<void> {
    const { error } = await this.supabase
      .rpc('increment_llm_usage', {
        p_tenant_id: tenantId,
        p_tokens: tokens,
        p_cost: cost,
        p_requests: 1
      });

    if (error) {
      console.error('Failed to update quota counters:', error);
    }
  }

  /**
   * Check for quota violations and create alerts
   */
  private async checkQuotaViolations(tenantId: string): Promise<void> {
    try {
      const quota = await this.getQuotaStatus(tenantId);
      if (!quota) return;

      const alerts: Omit<LLMUsageAlert, 'created_at'>[] = [];

      // Check token usage
      const tokenPercentage = (quota.current_month_tokens / quota.monthly_token_limit) * 100;
      if (tokenPercentage >= quota.notification_threshold && tokenPercentage < 100) {
        alerts.push({
          tenant_id: tenantId,
          alert_type: 'quota_warning',
          message: `Token usage is at ${tokenPercentage.toFixed(1)}% of monthly limit`,
          current_usage: quota.current_month_tokens,
          limit: quota.monthly_token_limit,
          percentage: tokenPercentage
        });

        // Send notification
        await sendLLMUsageAlert(tenantId, 'quota_warning', {
          currentUsage: quota.current_month_tokens,
          limit: quota.monthly_token_limit,
          percentage: tokenPercentage,
          metric: 'tokens'
        });
      } else if (tokenPercentage >= 100) {
        alerts.push({
          tenant_id: tenantId,
          alert_type: 'quota_exceeded',
          message: `Token quota exceeded: ${quota.current_month_tokens} / ${quota.monthly_token_limit}`,
          current_usage: quota.current_month_tokens,
          limit: quota.monthly_token_limit,
          percentage: tokenPercentage
        });

        // Send critical notification
        await sendLLMUsageAlert(tenantId, 'quota_exceeded', {
          currentUsage: quota.current_month_tokens,
          limit: quota.monthly_token_limit,
          percentage: tokenPercentage,
          metric: 'tokens'
        });
      }

      // Check cost usage
      const costPercentage = (quota.current_month_cost / quota.monthly_cost_limit) * 100;
      if (costPercentage >= quota.notification_threshold && costPercentage < 100) {
        alerts.push({
          tenant_id: tenantId,
          alert_type: 'budget_warning',
          message: `LLM costs are at ${costPercentage.toFixed(1)}% of monthly budget`,
          current_usage: quota.current_month_cost,
          limit: quota.monthly_cost_limit,
          percentage: costPercentage
        });

        // Send notification
        await sendLLMUsageAlert(tenantId, 'budget_warning', {
          currentUsage: quota.current_month_cost,
          limit: quota.monthly_cost_limit,
          percentage: costPercentage,
          metric: 'cost'
        });
      } else if (costPercentage >= 100) {
        alerts.push({
          tenant_id: tenantId,
          alert_type: 'budget_exceeded',
          message: `Monthly budget exceeded: $${quota.current_month_cost.toFixed(2)} / $${quota.monthly_cost_limit.toFixed(2)}`,
          current_usage: quota.current_month_cost,
          limit: quota.monthly_cost_limit,
          percentage: costPercentage
        });

        // Send critical notification
        await sendLLMUsageAlert(tenantId, 'budget_exceeded', {
          currentUsage: quota.current_month_cost,
          limit: quota.monthly_cost_limit,
          percentage: costPercentage,
          metric: 'cost'
        });
      }

      // Insert alerts
      if (alerts.length > 0) {
        const { error: alertError } = await this.supabase
          .from('llm_usage_alerts')
          .insert(alerts.map(alert => ({
            ...alert,
            created_at: new Date().toISOString()
          })));

        if (alertError) {
          console.error('Failed to create usage alerts:', alertError);
        }
      }

      // Disable AI features if hard limits exceeded and no overage allowed
      if (!quota.overage_allowed && (tokenPercentage >= 100 || costPercentage >= 100)) {
        await this.supabase
          .from('llm_quotas')
          .update({ ai_features_enabled: false })
          .eq('tenant_id', tenantId);
      }

    } catch (error) {
      console.error('Error checking quota violations:', error);
    }
  }

  /**
   * Get quota configuration for plan
   */
  private getQuotaConfig(plan: 'free' | 'premium' | 'enterprise') {
    const configs = {
      free: {
        tokens: 10000,
        cost: 5,
        requests: 1000
      },
      premium: {
        tokens: 500000,
        cost: 200,
        requests: 20000
      },
      enterprise: {
        tokens: 2000000,
        cost: 1000,
        requests: 100000
      }
    };

    return configs[plan];
  }

  /**
   * Aggregate usage by day
   */
  private aggregateUsageByDay(usage: LLMUsageRecord[]): any[] {
    const dailyMap = new Map();

    usage.forEach(record => {
      const day = record.created_at?.split('T')[0] || '';
      if (!dailyMap.has(day)) {
        dailyMap.set(day, {
          date: day,
          total_tokens: 0,
          total_cost: 0,
          total_requests: 0
        });
      }

      const dayData = dailyMap.get(day);
      dayData.total_tokens += record.total_tokens;
      dayData.total_cost += record.cost_usd;
      dayData.total_requests += 1;
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Aggregate usage by operation type
   */
  private aggregateUsageByOperation(usage: LLMUsageRecord[]): any[] {
    const operationMap = new Map();

    usage.forEach(record => {
      if (!operationMap.has(record.operation)) {
        operationMap.set(record.operation, {
          operation: record.operation,
          total_tokens: 0,
          total_cost: 0,
          total_requests: 0
        });
      }

      const opData = operationMap.get(record.operation);
      opData.total_tokens += record.total_tokens;
      opData.total_cost += record.cost_usd;
      opData.total_requests += 1;
    });

    return Array.from(operationMap.values());
  }

  /**
   * Calculate cost trend over time
   */
  private calculateCostTrend(usage: LLMUsageRecord[]): any[] {
    const dailyMap = new Map();

    usage.forEach(record => {
      const day = record.created_at?.split('T')[0] || '';
      if (!dailyMap.has(day)) {
        dailyMap.set(day, 0);
      }
      dailyMap.set(day, dailyMap.get(day) + record.cost_usd);
    });

    return Array.from(dailyMap.entries())
      .map(([date, cost]) => ({ date, cost }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

// Singleton instance
export const llmUsageTracker = new LLMUsageTracker();

/**
 * Convenience function to record LLM usage
 */
export async function recordLLMUsage(
  tenantId: string,
  userId: string,
  provider: 'openrouter' | 'openai' | 'anthropic' | 'local',
  model: string,
  operation: LLMUsageRecord['operation'],
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  metadata?: Record<string, any>
): Promise<void> {
  await llmUsageTracker.recordUsage({
    tenant_id: tenantId,
    user_id: userId,
    provider,
    model,
    operation,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    cost_usd: costUsd,
    metadata
  });
}

/**
 * Convenience function to check if tenant can make LLM request
 */
export async function canMakeLLMRequest(tenantId: string, estimatedTokens?: number): Promise<boolean> {
  return await llmUsageTracker.canMakeRequest(tenantId, estimatedTokens);
}

/**
 * Get tenant's current LLM quota status
 */
export async function getLLMQuotaStatus(tenantId: string): Promise<LLMUsageQuota | null> {
  return await llmUsageTracker.getQuotaStatus(tenantId);
}

/**
 * Get tenant's LLM usage statistics
 */
export async function getLLMUsageStats(tenantId: string, days?: number) {
  return await llmUsageTracker.getUsageStats(tenantId, days);
}