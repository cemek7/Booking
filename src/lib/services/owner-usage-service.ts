import { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@/lib/error-handling';
import { z } from 'zod';

const TenantIdSchema = z.string().uuid();

interface UsageData {
  currentMonthUsage: any;
  lastMonthUsage: any;
  plan: string;
  limits: any;
  usagePercentages: any;
  aiConversion: any;
  dailyUsage: any;
  topUsers: any;
  costBreakdown: any;
}

export async function getOwnerUsage(
  supabase: SupabaseClient,
  tenantId: string
): Promise<UsageData> {
  const validatedTenantId = TenantIdSchema.safeParse(tenantId);
  if (!validatedTenantId.success) {
    throw new AppError(400, 'Invalid tenant ID');
  }

  try {
    // Get current date ranges for reporting
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Mock LLM usage data
    const currentMonthUsage = {
      openrouter_calls: Math.floor(Math.random() * 5000) + 1000,
      total_tokens: Math.floor(Math.random() * 100000) + 20000,
      cost_usd: (Math.random() * 50 + 10).toFixed(2),
      intent_detection_calls: Math.floor(Math.random() * 3000) + 500,
      paraphraser_calls: Math.floor(Math.random() * 2000) + 300,
      conversation_processing: Math.floor(Math.random() * 1500) + 200,
    };

    const lastMonthUsage = {
      openrouter_calls: Math.floor(Math.random() * 4000) + 800,
      total_tokens: Math.floor(Math.random() * 80000) + 15000,
      cost_usd: (Math.random() * 40 + 8).toFixed(2),
      intent_detection_calls: Math.floor(Math.random() * 2500) + 400,
      paraphraser_calls: Math.floor(Math.random() * 1800) + 250,
      conversation_processing: Math.floor(Math.random() * 1200) + 150,
    };

    // Get tenant plan and limits
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('plan, status')
      .eq('id', validatedTenantId.data)
      .single();

    if (tenantError) {
      throw new AppError(500, 'Failed to fetch tenant info', tenantError);
    }

    // Define plan limits
    const planLimits = {
      free: {
        monthly_tokens: 10000,
        monthly_calls: 1000,
        monthly_cost_limit: 5,
      },
      premium: {
        monthly_tokens: 500000,
        monthly_calls: 20000,
        monthly_cost_limit: 200,
      },
    };

    const limits =
      planLimits[tenant.plan as keyof typeof planLimits] || planLimits.free;

    // Calculate usage percentages
    const usagePercentages = {
      tokenUsagePercent:
        (currentMonthUsage.total_tokens / limits.monthly_tokens) * 100,
      callUsagePercent:
        (currentMonthUsage.openrouter_calls / limits.monthly_calls) * 100,
      costUsagePercent:
        (parseFloat(currentMonthUsage.cost_usd) / limits.monthly_cost_limit) *
        100,
    };

    // Get recent bookings for conversion tracking
    const { data: recentBookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('id, status, created_at, ai_assisted')
      .eq('tenant_id', validatedTenantId.data)
      .gte('created_at', startOfMonth.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (bookingsError) {
      console.warn(
        'Failed to fetch booking data for analytics:',
        bookingsError
      );
    }

    // Calculate AI conversion metrics
    const aiAssistedBookings =
      recentBookings?.filter(b => b.ai_assisted) || [];
    const totalBookings = recentBookings?.length || 0;
    const aiConversionRate =
      totalBookings > 0 ? (aiAssistedBookings.length / totalBookings) * 100 : 0;

    // Mock daily usage trends (last 7 days)
    const dailyUsage = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(now.getDate() - i);
      return {
        date: date.toISOString().split('T')[0],
        calls: Math.floor(Math.random() * 500) + 50,
        tokens: Math.floor(Math.random() * 10000) + 1000,
      };
    }).reverse();

    // Mock top users by usage
    const topUsers = [
      {
        user_id: 'mock-user-1',
        name: 'Alice',
        calls: Math.floor(Math.random() * 500),
        tokens: Math.floor(Math.random() * 20000),
      },
      {
        user_id: 'mock-user-2',
        name: 'Bob',
        calls: Math.floor(Math.random() * 400),
        tokens: Math.floor(Math.random() * 15000),
      },
    ];

    // Mock cost breakdown by feature
    const costBreakdown = {
      intent_detection: (parseFloat(currentMonthUsage.cost_usd) * 0.4).toFixed(2),
      paraphrasing: (parseFloat(currentMonthUsage.cost_usd) * 0.3).toFixed(2),
      conversation_processing: (parseFloat(currentMonthUsage.cost_usd) * 0.2).toFixed(2),
      other: (parseFloat(currentMonthUsage.cost_usd) * 0.1).toFixed(2),
    };

    return {
      currentMonthUsage,
      lastMonthUsage,
      plan: tenant.plan,
      limits,
      usagePercentages,
      aiConversion: {
        aiAssistedBookings: aiAssistedBookings.length,
        totalBookings,
        aiConversionRate,
      },
      dailyUsage,
      topUsers,
      costBreakdown,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'An unexpected error occurred', error);
  }
}
