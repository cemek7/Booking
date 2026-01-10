import { createHttpHandler } from '../../../../lib/create-http-handler';
import { getOwnerUsage } from '../../../../lib/services/owner-usage-service';

export const GET = createHttpHandler(
  async (ctx) => {
    const usageData = await getOwnerUsage(ctx.supabase, ctx.user.tenantId);
    return usageData;
  },
  'GET',
  { auth: true, roles: ['owner', 'superadmin'] }
);


      return {
        date: date.toISOString().split('T')[0],
        calls: Math.floor(Math.random() * 200) + 50,
        tokens: Math.floor(Math.random() * 5000) + 1000,
        cost: (Math.random() * 5 + 1).toFixed(2)
      };
    });

    return NextResponse.json({
      current_month: {
        usage: currentMonthUsage,
        limits,
        usage_percentages: {
          tokens: Math.min(tokenUsagePercent, 100),
          calls: Math.min(callUsagePercent, 100),
          cost: Math.min(costUsagePercent, 100)
        },
        alerts: {
          near_token_limit: tokenUsagePercent > 80,
          near_call_limit: callUsagePercent > 80,
          near_cost_limit: costUsagePercent > 80,
          over_any_limit: tokenUsagePercent > 100 || callUsagePercent > 100 || costUsagePercent > 100
        }
      },
      last_month: {
        usage: lastMonthUsage,
        growth: {
          calls: ((currentMonthUsage.openrouter_calls - lastMonthUsage.openrouter_calls) / lastMonthUsage.openrouter_calls * 100).toFixed(1),
          tokens: ((currentMonthUsage.total_tokens - lastMonthUsage.total_tokens) / lastMonthUsage.total_tokens * 100).toFixed(1),
          cost: ((parseFloat(currentMonthUsage.cost_usd) - parseFloat(lastMonthUsage.cost_usd)) / parseFloat(lastMonthUsage.cost_usd) * 100).toFixed(1)
        }
      },
      daily_trends: dailyUsage,
      ai_performance: {
        total_bookings: totalBookings,
        ai_assisted_bookings: aiAssistedBookings.length,
        ai_conversion_rate: aiConversionRate.toFixed(1),
        avg_conversation_length: (Math.random() * 8 + 3).toFixed(1), // messages
        success_rate: (Math.random() * 20 + 75).toFixed(1) // percentage
      },
      plan_info: {
        current_plan: tenant.plan,
        can_upgrade: tenant.plan === 'free',
        billing_cycle: 'monthly',
        next_billing_date: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0]
      }
    });

  } catch (error) {
    console.error('Owner usage API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const POST = createHttpHandler(
  async (ctx) => {
    const body = await ctx.request.json();
    const body = await request.json();
    
    // Get current user and verify owner role
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's tenant and verify role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || !['owner', 'superadmin'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { action, budget_limit, notification_threshold } = body;

    if (action === 'set_budget') {
      if (!budget_limit || budget_limit <= 0) {
        return NextResponse.json({ error: 'Invalid budget limit' }, { status: 400 });
      }

      // Update tenant settings with budget configuration
      const { error: budgetError } = await supabase
        .from('tenant_settings')
        .upsert({
          tenant_id: profile.tenant_id,
          llm_budget_limit: budget_limit,
          llm_notification_threshold: notification_threshold || 80,
          updated_at: new Date().toISOString()
        });

      if (budgetError) {
        return NextResponse.json({ error: 'Failed to set budget limit' }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'Budget limit set successfully',
        budget_limit,
        notification_threshold: notification_threshold || 80
      });
    }

    if (action === 'pause_ai') {
      // Pause AI features for the tenant
      const { error: pauseError } = await supabase
        .from('tenant_settings')
        .upsert({
          tenant_id: profile.tenant_id,
          ai_features_enabled: false,
          updated_at: new Date().toISOString()
        });

      if (pauseError) {
        return NextResponse.json({ error: 'Failed to pause AI features' }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'AI features paused successfully'
      });
    }

    if (action === 'resume_ai') {
      // Resume AI features for the tenant
      const { error: resumeError } = await supabase
        .from('tenant_settings')
        .upsert({
          tenant_id: profile.tenant_id,
          ai_features_enabled: true,
          updated_at: new Date().toISOString()
        });

      if (resumeError) {
        return NextResponse.json({ error: 'Failed to resume AI features' }, { status: 500 });
      }

      return NextResponse.json({ 
        message: 'AI features resumed successfully'
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Owner usage management API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}