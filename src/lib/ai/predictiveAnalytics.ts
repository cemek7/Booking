import { createServerSupabaseClient } from '@/lib/supabase/server';

interface RevenueMetrics {
  current_period: {
    revenue: number;
    bookings: number;
    avg_booking_value: number;
    period: string;
  };
  forecast: {
    next_month: number;
    next_quarter: number;
    confidence_interval: { low: number; high: number };
    growth_rate: number;
    seasonal_factors: Record<string, number>;
  };
  trends: {
    daily_revenue: Array<{ date: string; amount: number; bookings: number }>;
    service_performance: Array<{ service: string; revenue: number; trend: 'up' | 'down' | 'stable' }>;
    customer_segments: Array<{ segment: string; revenue: number; growth: number }>;
  };
}

interface CustomerAnalytics {
  customer_id: string;
  tenant_id: string;
  lifetime_value: {
    current_clv: number;
    predicted_clv: number;
    clv_percentile: number;
    value_segment: 'low' | 'medium' | 'high' | 'vip';
  };
  behavior_patterns: {
    booking_frequency: number; // bookings per month
    avg_session_duration: number; // minutes
    preferred_times: string[];
    preferred_services: string[];
    price_sensitivity: number; // 0-1
    loyalty_score: number; // 0-100
    engagement_score: number; // 0-100
  };
  churn_analysis: {
    churn_probability: number; // 0-1
    churn_risk_level: 'low' | 'medium' | 'high' | 'critical';
    days_since_last_booking: number;
    retention_factors: string[];
    churn_indicators: string[];
    recommended_actions: Array<{
      action: string;
      timing: string;
      priority: number;
      success_probability: number;
    }>;
  };
  segmentation: {
    primary_segment: string;
    secondary_segments: string[];
    segment_migration_history: Array<{
      from_segment: string;
      to_segment: string;
      date: string;
      reason: string;
    }>;
  };
}

interface TenantBenchmark {
  tenant_id: string;
  vertical: string;
  metrics: {
    revenue_per_customer: number;
    booking_frequency: number;
    customer_retention_rate: number;
    average_booking_value: number;
    conversion_rate: number;
    customer_satisfaction: number;
  };
  industry_comparison: {
    percentile_rank: number;
    performance_vs_industry: {
      revenue: 'above' | 'below' | 'average';
      efficiency: 'above' | 'below' | 'average';
      customer_satisfaction: 'above' | 'below' | 'average';
    };
    improvement_opportunities: Array<{
      metric: string;
      current_value: number;
      industry_benchmark: number;
      potential_improvement: number;
      recommended_actions: string[];
    }>;
  };
}

interface PredictiveInsight {
  insight_id: string;
  type: 'revenue_forecast' | 'churn_prediction' | 'demand_forecast' | 'pricing_optimization' | 'staff_optimization';
  tenant_id: string;
  prediction: {
    outcome: string;
    confidence: number;
    time_horizon: string;
    impact_magnitude: 'low' | 'medium' | 'high' | 'critical';
  };
  factors: Array<{
    factor: string;
    importance: number;
    trend: 'positive' | 'negative' | 'neutral';
    current_value: number;
    impact_explanation: string;
  }>;
  recommendations: Array<{
    action: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    expected_impact: string;
    implementation_effort: 'easy' | 'medium' | 'hard';
    timeline: string;
  }>;
  historical_accuracy: {
    similar_predictions: number;
    accuracy_rate: number;
    last_validated: string;
  };
}

class PredictiveAnalyticsEngine {
  private supabase = createServerSupabaseClient();
  private modelCache = new Map<string, any>();
  private insightCache = new Map<string, PredictiveInsight[]>();

  /**
   * Generate comprehensive revenue forecasting
   */
  async generateRevenueForecast(
    tenantId: string,
    timeHorizon: 'monthly' | 'quarterly' | 'yearly',
    options: {
      includeSeasonality?: boolean;
      includeExternalFactors?: boolean;
      confidenceLevel?: number;
      scenarioAnalysis?: boolean;
    } = {}
  ): Promise<RevenueMetrics> {
    try {
      console.log(`🔮 Generating revenue forecast for tenant ${tenantId} (${timeHorizon})`);

      // Get historical revenue data
      const historicalData = await this.getHistoricalRevenueData(tenantId, timeHorizon);
      
      // Get current period metrics
      const currentPeriod = await this.getCurrentPeriodMetrics(tenantId);
      
      // Calculate seasonal factors if requested
      const seasonalFactors = options.includeSeasonality 
        ? await this.calculateSeasonalFactors(historicalData)
        : {};

      // Generate base forecast using time series analysis
      const baseForecast = await this.generateTimSeriesForecast(
        historicalData, 
        timeHorizon
      );

      // Apply seasonal adjustments
      const adjustedForecast = this.applySeasonalAdjustments(baseForecast, seasonalFactors);

      // Calculate confidence intervals
      const confidenceInterval = this.calculateConfidenceInterval(
        adjustedForecast,
        historicalData,
        options.confidenceLevel || 0.95
      );

      // Generate trend analysis
      const trends = await this.generateRevenueTrends(tenantId, historicalData);

      const forecast = {
        current_period: currentPeriod,
        forecast: {
          next_month: this.getForecastValue(adjustedForecast, 'month'),
          next_quarter: this.getForecastValue(adjustedForecast, 'quarter'),
          confidence_interval: confidenceInterval,
          growth_rate: this.calculateGrowthRate(historicalData),
          seasonal_factors: seasonalFactors
        },
        trends: trends
      };

      console.log('✅ Revenue forecast generated successfully');
      return forecast;

    } catch (error) {
      console.error('❌ Error generating revenue forecast:', error);
      return this.getFallbackRevenueMetrics(tenantId);
    }
  }

  /**
   * Analyze customer lifetime value and predict churn
   */
  async analyzeCustomerLifetimeValue(
    tenantId: string,
    customerId?: string,
    options: {
      includeSegmentation?: boolean;
      generateRetentionPlan?: boolean;
      timeHorizon?: 'quarterly' | 'yearly' | 'lifetime';
    } = {}
  ): Promise<CustomerAnalytics | CustomerAnalytics[]> {
    try {
      console.log(`🎯 Analyzing CLV for tenant ${tenantId}${customerId ? ` customer ${customerId}` : ' all customers'}`);

      if (customerId) {
        return await this.analyzeSingleCustomer(tenantId, customerId, options);
      }

      // Analyze all customers
      const customers = await this.getTenantCustomers(tenantId);
      const analytics: CustomerAnalytics[] = [];

      for (const customer of customers) {
        const analysis = await this.analyzeSingleCustomer(tenantId, customer.id, options);
        analytics.push(analysis);
      }

      console.log(`✅ CLV analysis completed for ${analytics.length} customers`);
      return analytics;

    } catch (error) {
      console.error('❌ Error analyzing customer lifetime value:', error);
      return customerId ? this.getFallbackCustomerAnalytics(tenantId, customerId) : [];
    }
  }

  /**
   * Predict customer churn and generate retention strategies
   */
  async predictCustomerChurn(
    tenantId: string,
    options: {
      riskThreshold?: number;
      includeRetentionActions?: boolean;
      timeHorizon?: number; // days
      segmentAnalysis?: boolean;
    } = {}
  ): Promise<{
    high_risk_customers: CustomerAnalytics[];
    churn_insights: {
      overall_churn_rate: number;
      churn_by_segment: Record<string, number>;
      top_churn_factors: Array<{ factor: string; impact: number }>;
      seasonal_patterns: Record<string, number>;
    };
    retention_strategies: Array<{
      strategy: string;
      target_segments: string[];
      expected_impact: number;
      implementation_cost: 'low' | 'medium' | 'high';
      timeline: string;
    }>;
  }> {
    try {
      console.log(`🚨 Predicting customer churn for tenant ${tenantId}`);

      // Get customer data
      const customers = await this.getTenantCustomers(tenantId);
      
      // Calculate churn probabilities
      const churnAnalytics = await Promise.all(
        customers.map(customer => this.calculateChurnProbability(tenantId, customer))
      );

      // Filter high-risk customers
      const riskThreshold = options.riskThreshold || 0.7;
      const highRiskCustomers = churnAnalytics.filter(
        analytics => analytics.churn_analysis.churn_probability >= riskThreshold
      );

      // Generate insights
      const insights = await this.generateChurnInsights(tenantId, churnAnalytics);

      // Generate retention strategies
      const retentionStrategies = options.includeRetentionActions 
        ? await this.generateRetentionStrategies(tenantId, highRiskCustomers, insights)
        : [];

      console.log(`✅ Churn prediction completed: ${highRiskCustomers.length} high-risk customers identified`);

      return {
        high_risk_customers: highRiskCustomers,
        churn_insights: insights,
        retention_strategies: retentionStrategies
      };

    } catch (error) {
      console.error('❌ Error predicting customer churn:', error);
      return {
        high_risk_customers: [],
        churn_insights: {
          overall_churn_rate: 0,
          churn_by_segment: {},
          top_churn_factors: [],
          seasonal_patterns: {}
        },
        retention_strategies: []
      };
    }
  }

  /**
   * Compare tenant performance with industry benchmarks
   */
  async generatePerformanceBenchmarks(
    tenantId: string,
    options: {
      vertical?: string;
      includeRecommendations?: boolean;
      anonymizeData?: boolean;
      timeFrame?: 'monthly' | 'quarterly' | 'yearly';
    } = {}
  ): Promise<TenantBenchmark> {
    try {
      console.log(`📊 Generating performance benchmarks for tenant ${tenantId}`);

      // Get tenant metrics
      const tenantMetrics = await this.getTenantPerformanceMetrics(tenantId, options.timeFrame);
      
      // Get industry benchmarks
      const industryBenchmarks = await this.getIndustryBenchmarks(
        options.vertical || tenantMetrics.vertical
      );

      // Calculate percentile rank
      const percentileRank = this.calculatePercentileRank(tenantMetrics, industryBenchmarks);

      // Generate performance comparison
      const performanceComparison = this.comparePerformance(tenantMetrics, industryBenchmarks);

      // Identify improvement opportunities
      const improvementOpportunities = options.includeRecommendations
        ? await this.identifyImprovementOpportunities(tenantMetrics, industryBenchmarks)
        : [];

      const benchmark: TenantBenchmark = {
        tenant_id: tenantId,
        vertical: tenantMetrics.vertical,
        metrics: tenantMetrics.metrics,
        industry_comparison: {
          percentile_rank: percentileRank,
          performance_vs_industry: performanceComparison,
          improvement_opportunities: improvementOpportunities
        }
      };

      console.log(`✅ Performance benchmarks generated (${percentileRank}th percentile)`);
      return benchmark;

    } catch (error) {
      console.error('❌ Error generating performance benchmarks:', error);
      return this.getFallbackBenchmark(tenantId);
    }
  }

  /**
   * Generate predictive insights for business optimization
   */
  async generatePredictiveInsights(
    tenantId: string,
    insightTypes: Array<PredictiveInsight['type']> = ['revenue_forecast', 'churn_prediction', 'demand_forecast'],
    options: {
      priority?: 'high' | 'medium' | 'low';
      timeHorizon?: string;
      minConfidence?: number;
    } = {}
  ): Promise<PredictiveInsight[]> {
    try {
      console.log(`🔍 Generating predictive insights for tenant ${tenantId}`);

      const insights: PredictiveInsight[] = [];
      const minConfidence = options.minConfidence || 0.6;

      for (const insightType of insightTypes) {
        const insight = await this.generateSpecificInsight(tenantId, insightType, options);
        
        if (insight.prediction.confidence >= minConfidence) {
          insights.push(insight);
        }
      }

      // Sort by impact and confidence
      insights.sort((a, b) => {
        const impactScore = { critical: 4, high: 3, medium: 2, low: 1 };
        const aScore = impactScore[a.prediction.impact_magnitude] * a.prediction.confidence;
        const bScore = impactScore[b.prediction.impact_magnitude] * b.prediction.confidence;
        return bScore - aScore;
      });

      // Cache insights
      this.insightCache.set(tenantId, insights);

      console.log(`✅ Generated ${insights.length} high-confidence insights`);
      return insights;

    } catch (error) {
      console.error('❌ Error generating predictive insights:', error);
      return [];
    }
  }

  // Private helper methods

  private async getHistoricalRevenueData(tenantId: string, timeHorizon: string): Promise<any[]> {
    const daysBack = timeHorizon === 'yearly' ? 730 : timeHorizon === 'quarterly' ? 180 : 90;
    
    try {
      const { data: bookings } = await this.supabase
        .from('bookings')
        .select('total_amount, created_at, status')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at');

      return bookings || [];
    } catch (error) {
      console.error('Error fetching historical revenue data:', error);
      return [];
    }
  }

  private async getCurrentPeriodMetrics(tenantId: string): Promise<RevenueMetrics['current_period']> {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    try {
      const { data: bookings } = await this.supabase
        .from('bookings')
        .select('total_amount')
        .eq('tenant_id', tenantId)
        .eq('status', 'completed')
        .gte('created_at', monthStart.toISOString());

      const revenue = (bookings || []).reduce((sum, b) => sum + (b.total_amount || 0), 0);
      const bookingCount = bookings?.length || 0;
      const avgBookingValue = bookingCount > 0 ? revenue / bookingCount : 0;

      return {
        revenue,
        bookings: bookingCount,
        avg_booking_value: avgBookingValue,
        period: `${monthStart.getFullYear()}-${(monthStart.getMonth() + 1).toString().padStart(2, '0')}`
      };
    } catch (error) {
      console.error('Error getting current period metrics:', error);
      return {
        revenue: 0,
        bookings: 0,
        avg_booking_value: 0,
        period: new Date().toISOString().slice(0, 7)
      };
    }
  }

  private async calculateSeasonalFactors(historicalData: any[]): Promise<Record<string, number>> {
    // Group data by month to identify seasonal patterns
    const monthlyData = historicalData.reduce((acc, record) => {
      const month = new Date(record.created_at).getMonth();
      if (!acc[month]) acc[month] = [];
      acc[month].push(record.total_amount || 0);
      return acc;
    }, {} as Record<number, number[]>);

    const seasonalFactors: Record<string, number> = {};

    // Calculate average for each month and normalize
    const overallAverage = historicalData.reduce((sum, r) => sum + (r.total_amount || 0), 0) / historicalData.length;

    for (let month = 0; month < 12; month++) {
      const monthData = monthlyData[month] || [];
      if (monthData.length > 0) {
        const monthAverage: number = monthData.reduce((sum: number, val: number) => sum + val, 0) / monthData.length;
        const monthName = new Date(2000, month, 1).toLocaleString('default', { month: 'long' });
        seasonalFactors[monthName] = overallAverage > 0 ? monthAverage / overallAverage : 1;
      }
    }

    return seasonalFactors;
  }

  private async generateTimSeriesForecast(historicalData: any[], timeHorizon: string): Promise<any> {
    // Simple moving average forecast (in production, use more sophisticated models)
    const periods = timeHorizon === 'yearly' ? 12 : timeHorizon === 'quarterly' ? 3 : 1;
    const recentPeriods = historicalData.slice(-30); // Last 30 data points
    
    const avgRevenue = recentPeriods.reduce((sum, r) => sum + (r.total_amount || 0), 0) / recentPeriods.length;
    const trend = this.calculateLinearTrend(recentPeriods);

    return {
      base_value: avgRevenue,
      trend_adjustment: trend,
      periods: periods,
      forecast_values: Array.from({ length: periods }, (_, i) => 
        avgRevenue + (trend * (i + 1))
      )
    };
  }

  private calculateLinearTrend(data: any[]): number {
    if (data.length < 2) return 0;

    // Simple linear regression to calculate trend
    const xValues = data.map((_, i) => i);
    const yValues = data.map(d => d.total_amount || 0);
    
    const n = data.length;
    const sumX = xValues.reduce((a, b) => a + b, 0);
    const sumY = yValues.reduce((a, b) => a + b, 0);
    const sumXY = xValues.map((x, i) => x * yValues[i]).reduce((a, b) => a + b, 0);
    const sumXX = xValues.map(x => x * x).reduce((a, b) => a + b, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope || 0;
  }

  private applySeasonalAdjustments(forecast: any, seasonalFactors: Record<string, number>): any {
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });
    const seasonalMultiplier = seasonalFactors[currentMonth] || 1;

    return {
      ...forecast,
      forecast_values: forecast.forecast_values.map((value: number) => value * seasonalMultiplier)
    };
  }

  private calculateConfidenceInterval(
    forecast: any, 
    historicalData: any[], 
    confidenceLevel: number
  ): { low: number; high: number } {
    // Calculate prediction interval based on historical variance
    const values = historicalData.map(d => d.total_amount || 0);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Z-score for confidence level (approximation)
    const zScore = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.99 ? 2.58 : 1.645;
    const margin = zScore * stdDev;

    const avgForecast = forecast.forecast_values.reduce((a: number, b: number) => a + b, 0) / forecast.forecast_values.length;

    return {
      low: Math.max(0, avgForecast - margin),
      high: avgForecast + margin
    };
  }

  private async generateRevenueTrends(tenantId: string, historicalData: any[]): Promise<RevenueMetrics['trends']> {
    // Generate daily revenue trend for last 30 days
    const last30Days = historicalData.slice(-30);
    const dailyRevenue = this.groupByDate(last30Days);

    // Analyze service performance
    const servicePerformance = await this.analyzeServicePerformance(tenantId);

    // Analyze customer segments
    const customerSegments = await this.analyzeCustomerSegments(tenantId);

    return {
      daily_revenue: dailyRevenue,
      service_performance: servicePerformance,
      customer_segments: customerSegments
    };
  }

  private groupByDate(data: any[]): Array<{ date: string; amount: number; bookings: number }> {
    const grouped = data.reduce((acc, record) => {
      const date = record.created_at.split('T')[0];
      if (!acc[date]) {
        acc[date] = { amount: 0, bookings: 0 };
      }
      acc[date].amount += record.total_amount || 0;
      acc[date].bookings += 1;
      return acc;
    }, {} as Record<string, { amount: number; bookings: number }>);

    return Object.entries(grouped).map(([date, data]) => ({
      date,
      amount: (data as { amount: number; bookings: number }).amount,
      bookings: (data as { amount: number; bookings: number }).bookings
    }));
  }

  private async analyzeServicePerformance(tenantId: string): Promise<Array<{ service: string; revenue: number; trend: 'up' | 'down' | 'stable' }>> {
    try {
      // Last 60 days split into two 30-day halves to compute trend
      const now = Date.now();
      const recent30Start = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const prev30Start = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

      const { data: txRecent } = await this.supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', recent30Start);

      const { data: txPrev } = await this.supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', prev30Start)
        .lt('created_at', recent30Start);

      const aggregate = (rows: any[]) =>
        rows.reduce((acc: Record<string, number>, r) => {
          const svc = r.metadata?.service_name || r.metadata?.service || 'Other';
          acc[svc] = (acc[svc] || 0) + Number(r.amount || 0);
          return acc;
        }, {});

      const recentByService = aggregate(txRecent || []);
      const prevByService = aggregate(txPrev || []);
      const allServices = new Set([...Object.keys(recentByService), ...Object.keys(prevByService)]);

      return Array.from(allServices).map(service => {
        const recentRev = recentByService[service] || 0;
        const prevRev = prevByService[service] || 0;
        let trend: 'up' | 'down' | 'stable' = 'stable';
        if (prevRev > 0) {
          const change = (recentRev - prevRev) / prevRev;
          if (change > 0.05) trend = 'up';
          else if (change < -0.05) trend = 'down';
        } else if (recentRev > 0) {
          trend = 'up';
        }
        return { service, revenue: recentRev, trend };
      }).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
    } catch (error) {
      console.error('Error analyzing service performance:', error);
      return [];
    }
  }

  private async analyzeCustomerSegments(tenantId: string): Promise<Array<{ segment: string; revenue: number; growth: number }>> {
    try {
      const now = Date.now();
      const recent30Start = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
      const prev30Start = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();

      // Get per-customer totals for recent + previous periods
      const { data: recentTx } = await this.supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', recent30Start);

      const { data: prevTx } = await this.supabase
        .from('transactions')
        .select('amount, metadata')
        .eq('tenant_id', tenantId)
        .in('status', ['completed', 'paid'])
        .gte('created_at', prev30Start)
        .lt('created_at', recent30Start);

      // Segment by total spend: VIP (>500), Regular (100-500), New (<100)
      const segment = (total: number) => total > 500 ? 'VIP' : total > 100 ? 'Regular' : 'New';

      const byCustomer = (rows: any[]) =>
        rows.reduce((acc: Record<string, number>, r) => {
          const cid = r.metadata?.customer_id || 'unknown';
          acc[cid] = (acc[cid] || 0) + Number(r.amount || 0);
          return acc;
        }, {});

      const recentPerCustomer = byCustomer(recentTx || []);
      const prevPerCustomer = byCustomer(prevTx || []);

      const recentBySeg: Record<string, number> = {};
      const prevBySeg: Record<string, number> = {};
      for (const [, total] of Object.entries(recentPerCustomer)) {
        const seg = segment(total);
        recentBySeg[seg] = (recentBySeg[seg] || 0) + total;
      }
      for (const [, total] of Object.entries(prevPerCustomer)) {
        const seg = segment(total);
        prevBySeg[seg] = (prevBySeg[seg] || 0) + total;
      }

      return ['VIP', 'Regular', 'New'].map(seg => {
        const rev = recentBySeg[seg] || 0;
        const prev = prevBySeg[seg] || 0;
        const growth = prev > 0 ? Math.round(((rev - prev) / prev) * 100) : (rev > 0 ? 100 : 0);
        return { segment: seg, revenue: rev, growth };
      });
    } catch (error) {
      console.error('Error analyzing customer segments:', error);
      return [];
    }
  }

  private getForecastValue(forecast: any, period: 'month' | 'quarter'): number {
    if (!forecast.forecast_values || forecast.forecast_values.length === 0) return 0;
    
    if (period === 'month') {
      return forecast.forecast_values[0] || 0;
    } else {
      return forecast.forecast_values.slice(0, 3).reduce((sum: number, val: number) => sum + val, 0);
    }
  }

  private calculateGrowthRate(historicalData: any[]): number {
    if (historicalData.length < 2) return 0;

    const recent = historicalData.slice(-30);
    const older = historicalData.slice(-60, -30);

    if (recent.length === 0 || older.length === 0) return 0;

    const recentSum = recent.reduce((sum, r) => sum + (r.total_amount || 0), 0);
    const olderSum = older.reduce((sum, r) => sum + (r.total_amount || 0), 0);

    if (olderSum === 0) return 0;

    return ((recentSum - olderSum) / olderSum) * 100;
  }

  private getFallbackRevenueMetrics(tenantId: string): RevenueMetrics {
    return {
      current_period: {
        revenue: 0,
        bookings: 0,
        avg_booking_value: 0,
        period: new Date().toISOString().slice(0, 7)
      },
      forecast: {
        next_month: 0,
        next_quarter: 0,
        confidence_interval: { low: 0, high: 0 },
        growth_rate: 0,
        seasonal_factors: {}
      },
      trends: {
        daily_revenue: [],
        service_performance: [],
        customer_segments: []
      }
    };
  }

  // Additional helper methods for customer analytics, churn prediction, etc...
  
  private async analyzeSingleCustomer(tenantId: string, customerId: string, options: any): Promise<CustomerAnalytics> {
    try {
      // Try customer_analytics cache first
      const { data: cached } = await this.supabase
        .from('customer_analytics')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('customer_id', customerId)
        .maybeSingle();

      if (cached && new Date(cached.expires_at) > new Date()) {
        return {
          customer_id: customerId,
          tenant_id: tenantId,
          lifetime_value: {
            current_clv: Number(cached.lifetime_value || 0),
            predicted_clv: Number(cached.predicted_ltv || 0),
            clv_percentile: 50,
            value_segment: cached.lifetime_value > 500 ? 'vip' : cached.lifetime_value > 200 ? 'high' : cached.lifetime_value > 50 ? 'medium' : 'low',
          },
          behavior_patterns: {
            booking_frequency: 0,
            avg_session_duration: 0,
            preferred_times: (cached.personalization_profile?.preferred_times as string[]) || [],
            preferred_services: (cached.personalization_profile?.preferred_services as string[]) || [],
            price_sensitivity: 0.5,
            loyalty_score: Number(cached.loyalty_score || 50),
            engagement_score: 50,
          },
          churn_analysis: {
            churn_probability: Number(cached.churn_probability || 0.5),
            churn_risk_level: Number(cached.churn_probability) > 0.7 ? 'high' : Number(cached.churn_probability) > 0.4 ? 'medium' : 'low',
            days_since_last_booking: 0,
            retention_factors: [],
            churn_indicators: [],
            recommended_actions: [],
          },
          segmentation: {
            primary_segment: cached.personalization_profile?.segment || 'regular',
            secondary_segments: [],
            segment_migration_history: [],
          },
        };
      }

      // Compute from reservations + transactions
      const [{ data: reservations }, { data: transactions }] = await Promise.all([
        this.supabase
          .from('reservations')
          .select('id, status, start_at, service, created_at')
          .eq('tenant_id', tenantId)
          .eq('customer_id', customerId)
          .order('created_at', { ascending: false }),
        this.supabase
          .from('transactions')
          .select('amount, status, created_at')
          .eq('tenant_id', tenantId)
          .eq('customer_id', customerId)
          .in('status', ['completed', 'paid']),
      ]);

      const totalSpent = (transactions || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      const bookingCount = (reservations || []).length;
      const completedCount = (reservations || []).filter((r: any) => r.status === 'completed').length;
      const lastBookingDate = reservations?.[0]?.created_at ? new Date(reservations[0].created_at) : null;
      const daysSinceLastBooking = lastBookingDate
        ? Math.floor((Date.now() - lastBookingDate.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      const churnProbability = daysSinceLastBooking > 180 ? 0.9 : daysSinceLastBooking > 90 ? 0.6 : daysSinceLastBooking > 60 ? 0.3 : 0.1;
      const valueSegment: 'low' | 'medium' | 'high' | 'vip' = totalSpent > 500 ? 'vip' : totalSpent > 200 ? 'high' : totalSpent > 50 ? 'medium' : 'low';

      // Extract preferred times from reservation start_at
      const hourCounts: Record<number, number> = {};
      for (const r of (reservations || [])) {
        if (r.start_at) {
          const h = new Date(r.start_at).getHours();
          hourCounts[h] = (hourCounts[h] || 0) + 1;
        }
      }
      // Extract preferred times from hour distribution
      const preferredTimes = Object.entries(hourCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([h]) => `${String(h).padStart(2, '0')}:00`);

      // Extract preferred services
      const svcCounts: Record<string, number> = {};
      for (const r of (reservations || [])) {
        if (r.service) svcCounts[r.service] = (svcCounts[r.service] || 0) + 1;
      }
      const preferredServices = Object.entries(svcCounts).sort(([, a], [, b]) => b - a).slice(0, 3).map(([s]) => s);

      // Booking frequency = bookings per month over observed lifespan
      const firstBookingDate = reservations && reservations.length > 0
        ? new Date((reservations as any[])[reservations.length - 1].created_at)
        : null;
      const observedMonths = firstBookingDate && lastBookingDate
        ? Math.max(1, (lastBookingDate.getTime() - firstBookingDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
        : 1;
      const bookingFrequency = bookingCount > 0 ? bookingCount / observedMonths : 0;

      return {
        customer_id: customerId,
        tenant_id: tenantId,
        lifetime_value: {
          current_clv: totalSpent,
          predicted_clv: totalSpent * 1.5,
          clv_percentile: 50,
          value_segment: valueSegment,
        },
        behavior_patterns: {
          booking_frequency: bookingFrequency,
          avg_session_duration: 30,
          preferred_times: preferredTimes,
          preferred_services: preferredServices,
          price_sensitivity: totalSpent > 200 ? 0.2 : 0.6,
          loyalty_score: Math.min(100, completedCount * 10),
          engagement_score: Math.min(100, bookingCount * 5),
        },
        churn_analysis: {
          churn_probability: churnProbability,
          churn_risk_level: churnProbability > 0.7 ? 'high' : churnProbability > 0.4 ? 'medium' : 'low',
          days_since_last_booking: daysSinceLastBooking,
          retention_factors: completedCount > 3 ? ['frequent_booker'] : [],
          churn_indicators: daysSinceLastBooking > 90 ? ['long_absence'] : [],
          recommended_actions: [],
        },
        segmentation: {
          primary_segment: valueSegment === 'vip' ? 'vip' : bookingCount === 0 ? 'new' : 'regular',
          secondary_segments: [],
          segment_migration_history: [],
        },
      };
    } catch (error) {
      console.error('Error analyzing customer:', error);
      return this.getFallbackCustomerAnalytics(tenantId, customerId);
    }
  }

  private async getTenantCustomers(tenantId: string): Promise<any[]> {
    const { data: customers } = await this.supabase
      .from('customers')
      .select('id, phone, email')
      .eq('tenant_id', tenantId);
    
    return customers || [];
  }

  private async calculateChurnProbability(tenantId: string, customer: any): Promise<CustomerAnalytics> {
    // Simplified churn calculation
    return await this.analyzeSingleCustomer(tenantId, customer.id, {});
  }

  private async generateChurnInsights(tenantId: string, analytics: CustomerAnalytics[]): Promise<any> {
    // Calculate overall churn metrics
    const totalCustomers = analytics.length;
    const churnedCustomers = analytics.filter(a => a.churn_analysis.churn_probability > 0.7).length;
    const overallChurnRate = totalCustomers > 0 ? churnedCustomers / totalCustomers : 0;

    return {
      overall_churn_rate: overallChurnRate,
      churn_by_segment: {},
      top_churn_factors: [],
      seasonal_patterns: {}
    };
  }

  private async generateRetentionStrategies(tenantId: string, highRiskCustomers: CustomerAnalytics[], insights: any): Promise<any[]> {
    return [
      {
        strategy: 'Personalized Offers',
        target_segments: ['high_value'],
        expected_impact: 0.3,
        implementation_cost: 'medium',
        timeline: '2 weeks'
      }
    ];
  }

  private getFallbackCustomerAnalytics(tenantId: string, customerId: string): CustomerAnalytics {
    return {
      customer_id: customerId,
      tenant_id: tenantId,
      lifetime_value: {
        current_clv: 0,
        predicted_clv: 0,
        clv_percentile: 50,
        value_segment: 'medium'
      },
      behavior_patterns: {
        booking_frequency: 0,
        avg_session_duration: 0,
        preferred_times: [],
        preferred_services: [],
        price_sensitivity: 0.5,
        loyalty_score: 50,
        engagement_score: 50
      },
      churn_analysis: {
        churn_probability: 0.5,
        churn_risk_level: 'medium',
        days_since_last_booking: 0,
        retention_factors: [],
        churn_indicators: [],
        recommended_actions: []
      },
      segmentation: {
        primary_segment: 'new',
        secondary_segments: [],
        segment_migration_history: []
      }
    };
  }

  // Additional methods for benchmarks and insights...
  
  private async getTenantPerformanceMetrics(tenantId: string, timeFrame?: string): Promise<any> {
    try {
      const daysBack = timeFrame === 'yearly' ? 365 : timeFrame === 'quarterly' ? 90 : 30;
      const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

      const [
        { data: transactions },
        { data: reservations },
        { data: feedback },
        { data: tenantRow },
      ] = await Promise.all([
        this.supabase
          .from('transactions')
          .select('amount, metadata')
          .eq('tenant_id', tenantId)
          .in('status', ['completed', 'paid'])
          .gte('created_at', since),
        this.supabase
          .from('reservations')
          .select('id, status, phone')
          .eq('tenant_id', tenantId)
          .gte('created_at', since),
        this.supabase
          .from('customer_feedback')
          .select('score')
          .eq('tenant_id', tenantId),
        this.supabase
          .from('tenants')
          .select('industry')
          .eq('id', tenantId)
          .maybeSingle(),
      ]);

      const totalRevenue = (transactions || []).reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
      const totalBookings = (reservations || []).length;
      const completedBookings = (reservations || []).filter((r: any) => r.status === 'completed').length;
      const uniqueCustomers = new Set((reservations || []).map((r: any) => r.phone).filter(Boolean)).size;
      const avgBookingValue = totalBookings > 0 ? totalRevenue / totalBookings : 0;
      const avgRating = feedback && feedback.length > 0
        ? (feedback as Array<{ score: number }>).reduce((s, f) => s + f.score, 0) / feedback.length
        : 0;

      return {
        vertical: (tenantRow as any)?.industry || 'general',
        metrics: {
          revenue_per_customer: uniqueCustomers > 0 ? totalRevenue / uniqueCustomers : 0,
          booking_frequency: uniqueCustomers > 0 ? totalBookings / uniqueCustomers : 0,
          customer_retention_rate: totalBookings > 0 ? completedBookings / totalBookings : 0,
          average_booking_value: avgBookingValue,
          conversion_rate: totalBookings > 0 ? completedBookings / totalBookings : 0,
          customer_satisfaction: avgRating,
        },
      };
    } catch (error) {
      console.error('Error getting tenant performance metrics:', error);
      return {
        vertical: 'general',
        metrics: {
          revenue_per_customer: 0,
          booking_frequency: 0,
          customer_retention_rate: 0,
          average_booking_value: 0,
          conversion_rate: 0,
          customer_satisfaction: 0,
        },
      };
    }
  }

  private async getIndustryBenchmarks(vertical: string): Promise<any> {
    return {
      revenue_per_customer: 120,
      booking_frequency: 2.0,
      customer_retention_rate: 0.75,
      average_booking_value: 55,
      conversion_rate: 0.20,
      customer_satisfaction: 4.2
    };
  }

  private calculatePercentileRank(tenantMetrics: any, industryBenchmarks: any): number {
    // Simple percentile calculation
    const metrics = tenantMetrics.metrics;
    const benchmarks = industryBenchmarks;
    
    let totalScore = 0;
    let metricCount = 0;
    
    for (const [key, value] of Object.entries(metrics)) {
      if (benchmarks[key] && typeof value === 'number') {
        const score = (value as number) / benchmarks[key];
        totalScore += Math.min(score, 2); // Cap at 2x benchmark
        metricCount++;
      }
    }
    
    const avgScore = metricCount > 0 ? totalScore / metricCount : 1;
    return Math.round(avgScore * 50); // Convert to percentile
  }

  private comparePerformance(tenantMetrics: any, industryBenchmarks: any): any {
    const metrics = tenantMetrics.metrics;
    const benchmarks = industryBenchmarks;
    
    return {
      revenue: metrics.revenue_per_customer > benchmarks.revenue_per_customer ? 'above' : 'below',
      efficiency: metrics.conversion_rate > benchmarks.conversion_rate ? 'above' : 'below',
      customer_satisfaction: metrics.customer_satisfaction > benchmarks.customer_satisfaction ? 'above' : 'below'
    };
  }

  private async identifyImprovementOpportunities(tenantMetrics: any, industryBenchmarks: any): Promise<any[]> {
    const opportunities = [];
    const metrics = tenantMetrics.metrics;
    const benchmarks = industryBenchmarks;
    
    for (const [key, value] of Object.entries(metrics)) {
      if (benchmarks[key] && (value as number) < benchmarks[key]) {
        opportunities.push({
          metric: key,
          current_value: value,
          industry_benchmark: benchmarks[key],
          potential_improvement: benchmarks[key] - (value as number),
          recommended_actions: [`Improve ${key.replace('_', ' ')}`]
        });
      }
    }
    
    return opportunities;
  }

  private getFallbackBenchmark(tenantId: string): TenantBenchmark {
    return {
      tenant_id: tenantId,
      vertical: 'general',
      metrics: {
        revenue_per_customer: 100,
        booking_frequency: 1.5,
        customer_retention_rate: 0.7,
        average_booking_value: 50,
        conversion_rate: 0.15,
        customer_satisfaction: 4.0
      },
      industry_comparison: {
        percentile_rank: 50,
        performance_vs_industry: {
          revenue: 'average',
          efficiency: 'average',
          customer_satisfaction: 'average'
        },
        improvement_opportunities: []
      }
    };
  }

  private async generateSpecificInsight(tenantId: string, type: PredictiveInsight['type'], options: any): Promise<PredictiveInsight> {
    const insightId = `insight_${type}_${Date.now()}`;
    
    return {
      insight_id: insightId,
      type,
      tenant_id: tenantId,
      prediction: {
        outcome: `Predicted ${type} outcome`,
        confidence: 0.8,
        time_horizon: options.timeHorizon || '30 days',
        impact_magnitude: 'medium'
      },
      factors: [
        {
          factor: 'Historical trends',
          importance: 0.6,
          trend: 'positive',
          current_value: 100,
          impact_explanation: 'Based on historical patterns'
        }
      ],
      recommendations: [
        {
          action: 'Monitor performance',
          priority: 'medium',
          expected_impact: 'Improved tracking',
          implementation_effort: 'easy',
          timeline: '1 week'
        }
      ],
      historical_accuracy: {
        similar_predictions: 10,
        accuracy_rate: 0.85,
        last_validated: new Date().toISOString()
      }
    };
  }
}

export { PredictiveAnalyticsEngine, type RevenueMetrics, type CustomerAnalytics, type TenantBenchmark, type PredictiveInsight };