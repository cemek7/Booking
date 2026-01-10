/**
 * Machine Learning Integration for Predictive Analytics
 * Handles scheduling optimization, demand forecasting, and anomaly detection
 * Follows established LLM/AI infrastructure patterns for error handling and monitoring
 */

import { trace, metrics } from '@opentelemetry/api';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { addLlmTokens } from './usageMetrics';
import { ensureTenantHasQuota } from './llmQuota';
import metricsLib from './metrics';

// Error types following llmAdapter pattern
type MLQuotaBlockedError = Error & { code?: string };

// Result types with consistent structure
export interface MLServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    computeUnits?: number;
    cacheHits?: number;
  };
}

// Data structure interfaces for ML operations
export interface BookingData {
  id: string;
  tenant_id: string;
  service_id?: string;
  staff_id?: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
  customer_id?: string;
  price?: number;
}

export interface RevenueData {
  date: string;
  amount: number;
  booking_count: number;
  service_id?: string;
  tenant_id: string;
}

export interface StaffData {
  staff_id: string;
  working_hours: number;
  bookings_handled: number;
  utilization_rate: number;
  date: string;
  tenant_id: string;
}

export interface CustomerData {
  customer_id: string;
  booking_frequency: number;
  last_booking_date: string;
  total_spent: number;
  preferred_services: string[];
  tenant_id: string;
}

export interface ServicePricingData {
  service_id: string;
  base_price: number;
  current_price: number;
  demand_score: number;
  competition_price?: number;
  seasonal_factor: number;
  tenant_id: string;
}

export interface PredictiveModelParameters {
  learning_rate: number;
  regularization: number;
  feature_weights: Record<string, number>;
  validation_threshold: number;
}

export interface PredictiveModelMetadata {
  training_dataset_size: number;
  validation_score: number;
  feature_importance: Record<string, number>;
  hyperparameters: Record<string, number>;
  created_by: string;
  training_duration_ms: number;
}

export interface PredictiveModel {
  id: string;
  name: string;
  type: 'scheduling' | 'demand_forecasting' | 'anomaly_detection' | 'pricing_optimization';
  version: string;
  status: 'training' | 'ready' | 'updating' | 'error';
  accuracy?: number;
  last_trained: string;
  parameters: PredictiveModelParameters;
  metadata: PredictiveModelMetadata;
}

export interface SchedulingPrediction {
  time_slot: string;
  probability_score: number;
  confidence_level: number;
  factors: {
    historical_demand: number;
    staff_availability: number;
    seasonal_trend: number;
    client_preferences: number;
  };
  recommended_capacity: number;
  alternative_slots?: string[];
}

export interface DemandForecast {
  date: string;
  predicted_bookings: number;
  confidence_interval: [number, number];
  trend_direction: 'increasing' | 'decreasing' | 'stable';
  seasonal_factor: number;
  factors: {
    historical_average: number;
    seasonal_adjustment: number;
    event_impact: number;
    marketing_influence: number;
  };
}

export interface AnomalyDetection {
  id: string;
  timestamp: string;
  type: 'booking_pattern' | 'revenue_anomaly' | 'staff_utilization' | 'customer_behavior';
  severity: 'low' | 'medium' | 'high';
  score: number;
  description: string;
  data_points: Record<string, number>;
  suggested_actions: string[];
  auto_resolved: boolean;
}

export interface PricingOptimization {
  service_id: string;
  service_name: string;
  current_price: number;
  optimized_price: number;
  price_change_percentage: number;
  expected_demand_impact: number;
  revenue_impact: number;
  elasticity_score: number;
  confidence: number;
  factors: {
    competitor_pricing: number;
    demand_level: number;
    capacity_utilization: number;
    customer_sensitivity: number;
  };
}

export interface CustomerInsightMLData {
  customer_id: string;
  lifetime_value_prediction: number;
  churn_probability: number;
  next_booking_prediction: {
    likelihood: number;
    estimated_date: string;
    preferred_services: string[];
  };
  personalization_profile: {
    preferred_times: string[];
    booking_patterns: string;
    price_sensitivity: 'low' | 'medium' | 'high';
    loyalty_score: number;
  };
}

export class MachineLearningService {
  private supabase: SupabaseClient;
  private tracer = trace.getTracer('boka-ml');
  private meter = metrics.getMeter('boka-ml');

  // Metrics
  private predictionRequestsCounter = this.meter.createCounter('ml_predictions_total', {
    description: 'Total ML prediction requests',
  });

  private modelAccuracyGauge = this.meter.createGauge('ml_model_accuracy', {
    description: 'Current model accuracy scores',
  });

  private predictionLatencyHistogram = this.meter.createHistogram('ml_prediction_latency_ms', {
    description: 'ML prediction latency',
  });

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Get optimal scheduling predictions for available time slots
   */
  async getSchedulingPredictions(
    tenantId: string,
    date: string,
    serviceId?: string,
    staffId?: string
  ): Promise<MLServiceResult<SchedulingPrediction[]>> {
    const span = this.tracer.startSpan('ml.scheduling_predictions');
    const startTime = Date.now();

    try {
      if (!tenantId) {
        return { success: false, error: 'tenantId required' };
      }

      // Runtime quota check following llmAdapter pattern
      try {
        const quota = await ensureTenantHasQuota(this.supabase, tenantId);
        if (!quota.allowed) {
          const err = new Error(`ml_quota_block: ${quota.reason}`) as MLQuotaBlockedError;
          err.code = 'ml_quota_block';
          throw err;
        }
      } catch (guardErr) {
        return { success: false, error: `Quota check failed: ${(guardErr as Error).message}` };
      }

      // Get historical booking data for training
      const historicalData = await this.getHistoricalBookingData(tenantId, date, serviceId, staffId);
      
      // Get current availability slots
      const availabilitySlots = await this.getAvailabilitySlots(tenantId, date, staffId);
      
      // Calculate predictions for each available slot
      const predictions: SchedulingPrediction[] = [];

      for (const slot of availabilitySlots) {
        const prediction = await this.predictSlotOptimality(
          slot,
          historicalData,
          tenantId,
          serviceId
        );
        predictions.push(prediction);
      }

      // Sort by probability score (highest first)
      predictions.sort((a, b) => b.probability_score - a.probability_score);

      // Track usage for quota management
      const usage = { computeUnits: predictions.length, cacheHits: 0 };
      try {
        // Track compute units as tokens for quota system
        await addLlmTokens(this.supabase, tenantId, predictions.length);
      } catch (e) {
        console.warn('ML service: token tracking failed', e);
      }

      this.predictionRequestsCounter.add(1, { type: 'scheduling' });
      span.setAttribute('predictions.count', predictions.length);
      await metricsLib.incr('ml_prediction_success');

      return { success: true, data: predictions, usage };

    } catch (error) {
      span.recordException(error as Error);
      await metricsLib.incr('ml_prediction_error');
      return { success: false, error: (error as Error).message };
    } finally {
      const duration = Date.now() - startTime;
      this.predictionLatencyHistogram.record(duration, { type: 'scheduling' });
      span.end();
    }
  }

  /**
   * Generate demand forecasting for future periods
   */
  async getDemandForecast(
    tenantId: string,
    startDate: string,
    endDate: string,
    serviceId?: string
  ): Promise<{ success: boolean; forecast?: DemandForecast[]; error?: string }> {
    const span = this.tracer.startSpan('ml.demand_forecast');

    try {
      const historicalData = await this.getHistoricalDemandData(tenantId, serviceId);
      const forecastPeriod = this.getDateRange(startDate, endDate);
      
      const forecast: DemandForecast[] = [];

      for (const date of forecastPeriod) {
        const prediction = await this.forecastDemandForDate(
          date,
          historicalData,
          tenantId,
          serviceId
        );
        forecast.push(prediction);
      }

      this.predictionRequestsCounter.add(1, { type: 'demand_forecast' });
      return { success: true, forecast };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Detect anomalies in booking patterns and business metrics
   */
  async detectAnomalies(
    tenantId: string,
    lookbackDays: number = 30
  ): Promise<{ success: boolean; anomalies?: AnomalyDetection[]; error?: string }> {
    const span = this.tracer.startSpan('ml.anomaly_detection');

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lookbackDays);

      // Get recent data for analysis
      const recentData = await this.getRecentBusinessData(tenantId, startDate, endDate);
      
      // Detect different types of anomalies
      const anomalies: AnomalyDetection[] = [];

      // Booking pattern anomalies
      const bookingAnomalies = await this.detectBookingPatternAnomalies(recentData.bookings);
      anomalies.push(...bookingAnomalies);

      // Revenue anomalies
      const revenueAnomalies = await this.detectRevenueAnomalies(recentData.revenue);
      anomalies.push(...revenueAnomalies);

      // Staff utilization anomalies
      const staffAnomalies = await this.detectStaffUtilizationAnomalies(recentData.staff);
      anomalies.push(...staffAnomalies);

      // Customer behavior anomalies
      const customerAnomalies = await this.detectCustomerBehaviorAnomalies(recentData.customers);
      anomalies.push(...customerAnomalies);

      // Sort by severity and timestamp
      anomalies.sort((a, b) => {
        const severityOrder = { high: 3, medium: 2, low: 1 };
        const severityCompare = severityOrder[b.severity] - severityOrder[a.severity];
        if (severityCompare !== 0) return severityCompare;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });

      this.predictionRequestsCounter.add(1, { type: 'anomaly_detection' });
      return { success: true, anomalies };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Get pricing optimization recommendations
   */
  async getPricingOptimizations(
    tenantId: string,
    serviceIds?: string[]
  ): Promise<{ success: boolean; optimizations?: PricingOptimization[]; error?: string }> {
    const span = this.tracer.startSpan('ml.pricing_optimization');

    try {
      // Get services to optimize
      const services = await this.getServicesForOptimization(tenantId, serviceIds);
      
      const optimizations: PricingOptimization[] = [];

      for (const service of services) {
        // Get historical pricing and demand data
        const pricingHistory = await this.getServicePricingHistory(service.service_id);
        const demandHistory = await this.getServiceDemandHistory(service.service_id);
        
        // Calculate price elasticity and optimization
        const optimization = await this.optimizeServicePricing(
          service,
          pricingHistory,
          demandHistory
        );

        optimizations.push(optimization);
      }

      // Sort by expected revenue impact (highest first)
      optimizations.sort((a, b) => b.revenue_impact - a.revenue_impact);

      this.predictionRequestsCounter.add(1, { type: 'pricing_optimization' });
      return { success: true, optimizations };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  /**
   * Generate customer insights using ML
   */
  async getCustomerInsights(
    tenantId: string,
    customerIds?: string[]
  ): Promise<{ success: boolean; insights?: CustomerInsightMLData[]; error?: string }> {
    const span = this.tracer.startSpan('ml.customer_insights');

    try {
      const customers = await this.getCustomersForAnalysis(tenantId, customerIds);
      const insights: CustomerInsightMLData[] = [];

      for (const customer of customers) {
        // Get customer historical data
        const customerHistory = await this.getCustomerHistory(customer.customer_id);
        
        // Generate ML-powered insights
        const insight = await this.generateCustomerInsight(customer, customerHistory);
        insights.push(insight);
      }

      this.predictionRequestsCounter.add(1, { type: 'customer_insights' });
      return { success: true, insights };

    } catch (error) {
      span.recordException(error as Error);
      return { success: false, error: (error as Error).message };
    } finally {
      span.end();
    }
  }

  // Helper methods for predictions and ML calculations

  private async getHistoricalBookingData(
    tenantId: string,
    targetDate: string,
    serviceId?: string,
    staffId?: string
  ): Promise<BookingData[]> {
    let query = this.supabase
      .from('reservations')
      .select(`
        id,
        tenant_id,
        start_at,
        end_at,
        status,
        service_id,
        staff_id,
        customer_id,
        price,
        created_at
      `)
      .eq('tenant_id', tenantId)
      .gte('start_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // 90 days back
      .order('start_at', { ascending: true });

    // Filter by service if provided
    if (serviceId) {
      query = query.eq('service_id', serviceId);
    }
    
    // Filter by staff if provided
    if (staffId) {
      query = query.eq('staff_id', staffId);
    }
    
    // Filter by similar dates (same day of week as target)
    const targetDayOfWeek = new Date(targetDate).getDay();
    const { data } = await query;

    // Filter client-side for same day of week
    const filteredData = (data || []).filter(booking => {
      const bookingDayOfWeek = new Date(booking.start_at).getDay();
      return bookingDayOfWeek === targetDayOfWeek;
    });

    // Return properly formatted BookingData objects
    return filteredData.map(booking => ({
      id: booking.id,
      tenant_id: booking.tenant_id,
      service_id: booking.service_id,
      staff_id: booking.staff_id,
      start_at: booking.start_at,
      end_at: booking.end_at,
      status: booking.status,
      created_at: booking.created_at,
      customer_id: booking.customer_id,
      price: booking.price
    }));
  }

  private async getAvailabilitySlots(
    tenantId: string,
    date: string,
    staffId?: string
  ): Promise<string[]> {
    // Get availability slots from the optimized scheduler
    let query = this.supabase
      .from('availability_slots')
      .select('slot_time')
      .eq('tenant_id', tenantId)
      .eq('date', date)
      .eq('is_available', true);
    
    // Filter by staff if provided
    if (staffId) {
      query = query.eq('staff_id', staffId);
    }
    
    const { data } = await query;
    return (data || []).map(slot => slot.slot_time);
  }

  private async predictSlotOptimality(
    timeSlot: string,
    historicalData: BookingData[],
    tenantId: string,
    serviceId?: string
  ): Promise<SchedulingPrediction> {
    // Simplified ML prediction logic
    const slotHour = new Date(timeSlot).getHours();
    
    // Filter historical data by service if provided
    const relevantData = serviceId 
      ? historicalData.filter(booking => booking.service_id === serviceId)
      : historicalData;
    
    // Calculate historical demand for this time slot
    const historicalDemand = relevantData.filter(booking => {
      const bookingHour = new Date(booking.start_at).getHours();
      return Math.abs(bookingHour - slotHour) <= 1; // ±1 hour window
    }).length;

    // Calculate probability score based on multiple factors
    const factors = {
      historical_demand: Math.min(historicalDemand / 10, 1), // Normalize to 0-1
      staff_availability: 0.8, // Would calculate from actual staff schedules
      seasonal_trend: this.calculateSeasonalTrend(timeSlot),
      client_preferences: this.calculateClientPreferences(slotHour, tenantId),
    };

    const probability_score = Object.values(factors).reduce((sum, factor) => sum + factor, 0) / 4;
    
    return {
      time_slot: timeSlot,
      probability_score,
      confidence_level: Math.min(probability_score + 0.1, 0.95),
      factors,
      recommended_capacity: Math.ceil(probability_score * 5), // 1-5 capacity
    };
  }

  private calculateSeasonalTrend(timeSlot: string): number {
    const date = new Date(timeSlot);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();

    // Peak hours (9-11 AM, 2-4 PM)
    if ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16)) {
      return 0.9;
    }
    
    // Weekend boost
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 0.8;
    }

    return 0.6;
  }

  private calculateClientPreferences(hour: number, tenantId?: string): number {
    // Mock client preference calculation
    // In a real implementation, this would query tenant-specific booking patterns
    const preferredHours = [10, 11, 14, 15, 16]; // Popular hours
    const tenantBoost = tenantId ? 0.1 : 0; // Example logic for tenant-specific adjustment
    return preferredHours.includes(hour) ? 0.8 + tenantBoost : 0.5 + tenantBoost;
  }

  private async getHistoricalDemandData(tenantId: string, serviceId?: string): Promise<BookingData[]> {
    let query = this.supabase
      .from('reservations')
      .select('id, tenant_id, service_id, staff_id, start_at, end_at, status, created_at, customer_id')
      .eq('tenant_id', tenantId)
      .gte('start_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()); // 1 year

    if (serviceId) {
      query = query.eq('service_id', serviceId);
    }

    const { data } = await query;
    
    // Map to BookingData interface
    return (data || []).map(item => ({
      id: item.id,
      tenant_id: item.tenant_id,
      service_id: item.service_id,
      staff_id: item.staff_id,
      start_at: item.start_at,
      end_at: item.end_at,
      status: item.status,
      created_at: item.created_at,
      customer_id: item.customer_id,
      price: 0 // Default value since not selected
    }));
  }

  private getDateRange(startDate: string, endDate: string): string[] {
    const dates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  }

  private async forecastDemandForDate(
    date: string,
    historicalData: BookingData[],
    tenantId: string,
    serviceId?: string
  ): Promise<DemandForecast> {
    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();
    
    // Filter data by service if provided
    const relevantData = serviceId 
      ? historicalData.filter(booking => booking.service_id === serviceId)
      : historicalData;
    
    // Filter by tenant (additional safety check)
    const tenantData = relevantData.filter(booking => booking.tenant_id === tenantId);
    
    // Calculate historical average for same day of week
    const historicalAverage = tenantData
      .filter((booking: BookingData) => new Date(booking.start_at).getDay() === dayOfWeek)
      .length / 52; // Average per week over the year

    // Apply seasonal adjustments (simplified)
    const seasonalFactor = this.calculateSeasonalFactor(targetDate);
    const predicted_bookings = Math.round(historicalAverage * seasonalFactor);

    return {
      date,
      predicted_bookings,
      confidence_interval: [
        Math.max(0, predicted_bookings - 2),
        predicted_bookings + 3
      ],
      trend_direction: seasonalFactor > 1.1 ? 'increasing' : 
                      seasonalFactor < 0.9 ? 'decreasing' : 'stable',
      seasonal_factor: seasonalFactor,
      factors: {
        historical_average: historicalAverage,
        seasonal_adjustment: seasonalFactor - 1,
        event_impact: 0, // Would integrate with external events API
        marketing_influence: 0, // Would track marketing campaign effects
      },
    };
  }

  private calculateSeasonalFactor(date: Date): number {
    const month = date.getMonth();
    
    // Seasonal adjustments (example for beauty/hospitality)
    const seasonalMultipliers = {
      0: 0.8,  // January - post-holiday low
      1: 0.9,  // February - Valentine's boost
      2: 1.0,  // March
      3: 1.1,  // April - spring boost
      4: 1.2,  // May - wedding season
      5: 1.3,  // June - peak wedding season
      6: 1.1,  // July - summer
      7: 1.0,  // August
      8: 1.1,  // September - back to school
      9: 1.0,  // October
      10: 1.2, // November - holiday prep
      11: 1.3, // December - holiday peak
    };

    return seasonalMultipliers[month as keyof typeof seasonalMultipliers] || 1.0;
  }

  private async getRecentBusinessData(tenantId: string, startDate: Date, endDate: Date) {
    try {
      // Get booking data
      const { data: bookings } = await this.supabase
        .from('reservations')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('start_at', startDate.toISOString())
        .lte('start_at', endDate.toISOString());
      
      // Get revenue data (aggregated from bookings)
      const revenue = (bookings || []).map(booking => ({
        date: booking.start_at.split('T')[0],
        amount: booking.price || 0,
        booking_count: 1,
        service_id: booking.service_id,
        tenant_id: booking.tenant_id
      }));
      
      // Get staff data (placeholder)
      const staff: StaffData[] = [];
      
      // Get customer data (placeholder)
      const customers: CustomerData[] = [];
      
      return {
        bookings: bookings || [],
        revenue,
        staff,
        customers,
      };
    } catch (error) {
      console.warn('Failed to get recent business data:', error);
      return {
        bookings: [],
        revenue: [],
        staff: [],
        customers: [],
      };
    }
  }

  private async detectBookingPatternAnomalies(bookingData: BookingData[]): Promise<AnomalyDetection[]> {
    if (bookingData.length === 0) return [];
    
    // Analyze booking patterns for anomalies
    const hourlyBookings = new Map<number, number>();
    bookingData.forEach(booking => {
      const hour = new Date(booking.start_at).getHours();
      hourlyBookings.set(hour, (hourlyBookings.get(hour) || 0) + 1);
    });
    
    const anomalies: AnomalyDetection[] = [];
    const averageBookingsPerHour = bookingData.length / 24;
    
    hourlyBookings.forEach((count, hour) => {
      if (count > averageBookingsPerHour * 3) { // Significant spike
        anomalies.push({
          id: `booking_spike_${hour}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'booking_pattern',
          severity: 'medium',
          score: count / averageBookingsPerHour,
          description: `Unusual booking spike at ${hour}:00 - ${count} bookings (avg: ${averageBookingsPerHour.toFixed(1)})`,
          data_points: { hour, count, average: averageBookingsPerHour },
          suggested_actions: [
            'Review staff scheduling for peak hours',
            'Check for promotional campaign effects',
            'Verify booking system integrity'
          ],
          auto_resolved: false
        });
      }
    });
    
    return anomalies;
  }

  private async detectRevenueAnomalies(revenueData: RevenueData[]): Promise<AnomalyDetection[]> {
    if (revenueData.length === 0) return [];
    
    const averageRevenue = revenueData.reduce((sum, data) => sum + data.amount, 0) / revenueData.length;
    
    return revenueData.filter(data => data.amount < averageRevenue * 0.5)
      .map(data => ({
        id: `revenue_drop_${data.date}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'revenue_anomaly' as const,
        severity: 'high' as const,
        score: (averageRevenue - data.amount) / averageRevenue,
        description: `Significant revenue drop on ${data.date}: ${data.amount} (avg: ${averageRevenue.toFixed(2)})`,
        data_points: { actual_amount: data.amount, average_amount: averageRevenue, day_of_year: new Date(data.date).getDay() },
        suggested_actions: ['Review pricing strategy', 'Check for service disruptions', 'Analyze competitor activity'],
        auto_resolved: false
      }));
  }

  private async detectStaffUtilizationAnomalies(staffData: StaffData[]): Promise<AnomalyDetection[]> {
    if (staffData.length === 0) return [];
    
    return staffData.filter(data => data.utilization_rate < 0.2 || data.utilization_rate > 0.95)
      .map(data => ({
        id: `staff_util_${data.staff_id}_${data.date}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'staff_utilization' as const,
        severity: data.utilization_rate < 0.2 ? 'medium' : 'high',
        score: data.utilization_rate < 0.2 ? (0.2 - data.utilization_rate) : (data.utilization_rate - 0.95),
        description: `${data.utilization_rate < 0.2 ? 'Low' : 'Excessive'} utilization for staff ${data.staff_id}: ${(data.utilization_rate * 100).toFixed(1)}%`,
        data_points: { utilization_rate: data.utilization_rate, staff_id_hash: data.staff_id.length, analysis_date: new Date(data.date).getTime() },
        suggested_actions: data.utilization_rate < 0.2 
          ? ['Review staff scheduling', 'Consider training opportunities', 'Evaluate workload distribution'] 
          : ['Add staff support', 'Review break schedules', 'Monitor for burnout signs'],
        auto_resolved: false
      }));
  }

  private async detectCustomerBehaviorAnomalies(customerData: CustomerData[]): Promise<AnomalyDetection[]> {
    if (customerData.length === 0) return [];
    
    const avgFrequency = customerData.reduce((sum, data) => sum + data.booking_frequency, 0) / customerData.length;
    const anomalies: AnomalyDetection[] = [];
    
    // High-frequency customers (potential VIPs)
    customerData.filter(data => data.booking_frequency > avgFrequency * 3)
      .forEach(data => {
        anomalies.push({
          id: `high_freq_customer_${data.customer_id}_${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'customer_behavior' as const,
          severity: 'low' as const,
          score: data.booking_frequency / avgFrequency,
          description: `High-frequency customer: ${data.customer_id} with ${data.booking_frequency} bookings (avg: ${avgFrequency.toFixed(1)})`,
          data_points: { booking_frequency: data.booking_frequency, average_frequency: avgFrequency, total_spent: data.total_spent },
          suggested_actions: ['Consider VIP program enrollment', 'Offer loyalty rewards', 'Provide personalized service'],
          auto_resolved: false
        });
      });
    
    return anomalies;
  }

  private async getServicesForOptimization(tenantId: string, serviceIds?: string[]): Promise<ServicePricingData[]> {
    let query = this.supabase
      .from('services')
      .select('id, name, price, metadata')
      .eq('tenant_id', tenantId);

    if (serviceIds && serviceIds.length > 0) {
      query = query.in('id', serviceIds);
    }

    const { data } = await query;
    
    // Map to ServicePricingData interface
    return (data || []).map(item => ({
      service_id: item.id,
      base_price: item.price || 0,
      current_price: item.price || 0,
      demand_score: 1.0, // Default value
      competition_price: undefined,
      seasonal_factor: 1.0,
      tenant_id: tenantId
    }));
  }

  private async getServicePricingHistory(serviceId: string): Promise<ServicePricingData[]> {
    try {
      // Query historical pricing data (placeholder implementation)
      const { data, error } = await this.supabase
        .from('service_pricing_history')
        .select('*')
        .eq('service_id', serviceId)
        .order('created_at', { ascending: false })
        .limit(30);
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn('Failed to get service pricing history:', error);
      return [];
    }
  }

  private async getServiceDemandHistory(serviceId: string): Promise<BookingData[]> {
    try {
      const { data, error } = await this.supabase
        .from('reservations')
        .select('*')
        .eq('service_id', serviceId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn('Failed to get service demand history:', error);
      return [];
    }
  }

  private async optimizeServicePricing(
    service: ServicePricingData,
    pricingHistory: ServicePricingData[],
    demandHistory: BookingData[]
  ): Promise<PricingOptimization> {
    const currentPrice = service.current_price;
    
    // Analyze pricing trends and demand
    const recentDemand = demandHistory.length;
    const demandTrend = recentDemand > 0 ? Math.min(recentDemand / 10, 2) : 1;
    
    // Simple optimization algorithm
    let priceMultiplier = 1;
    if (demandTrend > 1.5 && service.demand_score > 0.8) {
      priceMultiplier = 1.1; // Increase by 10% for high demand
    } else if (demandTrend < 0.5 && service.demand_score < 0.3) {
      priceMultiplier = 0.9; // Decrease by 10% for low demand
    }
    
    const optimizedPrice = Math.round(currentPrice * priceMultiplier * service.seasonal_factor);
    const changePercentage = ((optimizedPrice - currentPrice) / currentPrice) * 100;

    return {
      service_id: service.service_id,
      service_name: `Service ${service.service_id}`,
      current_price: currentPrice,
      optimized_price: optimizedPrice,
      price_change_percentage: changePercentage,
      expected_demand_impact: demandTrend,
      revenue_impact: changePercentage * 0.8, // Estimated revenue impact
      elasticity_score: Math.abs(demandTrend - 1),
      confidence: Math.min(pricingHistory.length / 10, 1), // Higher confidence with more data
      factors: {
        competitor_pricing: 1.0, // Would be calculated from market data
        demand_level: service.demand_score,
        capacity_utilization: Math.min(recentDemand / 50, 1),
        customer_sensitivity: 1 - Math.min(pricingHistory.length / 20, 0.5)
      }
    };
  }

  private async getCustomersForAnalysis(tenantId: string, customerIds?: string[]): Promise<CustomerData[]> {
    let query = this.supabase
      .from('customers')
      .select('id, customer_name, created_at, metadata')
      .eq('tenant_id', tenantId);

    if (customerIds && customerIds.length > 0) {
      query = query.in('id', customerIds);
    }

    const { data } = await query;
    
    // Map to CustomerData interface
    return (data || []).map(item => ({
      customer_id: item.id,
      booking_frequency: 0, // Default - would be calculated
      last_booking_date: item.created_at,
      total_spent: 0, // Default - would be calculated
      preferred_services: [], // Default - would be calculated
      tenant_id: tenantId
    }));
  }

  private async getCustomerHistory(customerId: string): Promise<BookingData[]> {
    const { data } = await this.supabase
      .from('reservations')
      .select('*')
      .eq('customer_id', customerId)
      .order('start_at', { ascending: false });

    return data || [];
  }

  private async generateCustomerInsight(
    customer: CustomerData,
    history: BookingData[]
  ): Promise<CustomerInsightMLData> {
    // Mock customer insight generation
    const bookingCount = history.length;
    const totalSpent = history.reduce((sum, booking) => 
      sum + (booking.price || 0), 0);

    return {
      customer_id: customer.customer_id,
      lifetime_value_prediction: totalSpent * 1.5, // Predicted LTV
      churn_probability: bookingCount < 2 ? 0.7 : 0.2,
      next_booking_prediction: {
        likelihood: bookingCount > 0 ? 0.8 : 0.3,
        estimated_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        preferred_services: ['haircut', 'massage'], // Mock preferences
      },
      personalization_profile: {
        preferred_times: ['morning', 'afternoon'],
        booking_patterns: 'regular_monthly',
        price_sensitivity: 'medium',
        loyalty_score: Math.min(bookingCount * 10, 100),
      },
    };
  }
}

export default MachineLearningService;