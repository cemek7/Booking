import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SmartBookingRecommendations } from '@/lib/ai/smartBookingRecommendations';
import { PredictiveAnalyticsEngine } from '@/lib/ai/predictiveAnalytics';

interface AutomationRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  trigger: {
    type: 'time_based' | 'event_based' | 'condition_based' | 'ml_prediction';
    conditions: Array<{
      field: string;
      operator: 'equals' | 'greater_than' | 'less_than' | 'contains' | 'in_range';
      value: any;
    }>;
    schedule?: {
      frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
      time?: string;
      timezone: string;
    };
  };
  actions: Array<{
    type: 'send_reminder' | 'generate_offer' | 'update_customer' | 'create_booking' | 'send_notification' | 'trigger_workflow';
    parameters: Record<string, any>;
    delay_minutes?: number;
  }>;
  status: 'active' | 'inactive' | 'paused';
  success_rate: number;
  last_executed: string;
  next_execution: string;
  created_at: string;
}

interface ReminderOptimization {
  customer_phone: string;
  appointment_id: string;
  optimal_timing: {
    send_at: string;
    channels: Array<{
      channel: 'whatsapp' | 'sms' | 'email' | 'call';
      priority: number;
      success_probability: number;
    }>;
  };
  message_personalization: {
    tone: 'formal' | 'casual' | 'friendly' | 'professional';
    content_elements: string[];
    urgency_level: 'low' | 'medium' | 'high';
  };
  follow_up_strategy: {
    intervals: number[]; // minutes
    escalation_channels: string[];
    max_attempts: number;
  };
}

interface RebookingStrategy {
  customer_phone: string;
  missed_appointment: {
    appointment_id: string;
    service_id: string;
    missed_date: string;
    reason?: string;
  };
  rebooking_suggestions: Array<{
    service_id: string;
    staff_id: string;
    suggested_date: string;
    suggested_time: string;
    incentive?: {
      type: 'discount' | 'upgrade' | 'add_on';
      value: number;
      description: string;
    };
    confidence_score: number;
  }>;
  outreach_plan: {
    initial_contact: {
      timing: string; // when to first reach out
      channel: string;
      message_template: string;
    };
    follow_ups: Array<{
      delay_hours: number;
      channel: string;
      message_template: string;
    }>;
  };
}

interface ContentGeneration {
  content_type: 'marketing_message' | 'service_description' | 'offer_text' | 'reminder_message' | 'follow_up_message';
  target_audience: {
    customer_segment: string;
    demographics: Record<string, any>;
    preferences: Record<string, any>;
  };
  vertical_context: 'beauty' | 'hospitality' | 'medicine';
  generated_content: {
    primary_text: string;
    alternative_versions: string[];
    call_to_action: string;
    personalization_tags: string[];
  };
  optimization_data: {
    predicted_engagement: number;
    sentiment_score: number;
    readability_score: number;
    conversion_potential: number;
  };
}

interface CrossVerticalInsight {
  insight_id: string;
  source_vertical: string;
  applicable_verticals: string[];
  insight_type: 'customer_behavior' | 'operational_efficiency' | 'marketing_strategy' | 'pricing_strategy';
  description: string;
  data_points: Array<{
    metric: string;
    value: number;
    context: string;
  }>;
  recommendations: Array<{
    action: string;
    expected_impact: string;
    implementation_complexity: 'low' | 'medium' | 'high';
    success_probability: number;
  }>;
  confidence_level: number;
  validation_status: 'pending' | 'validated' | 'rejected';
}

class AutomationWorkflows {
  private supabase = createServerSupabaseClient();
  private smartRecommendations = new SmartBookingRecommendations();
  private predictiveEngine = new PredictiveAnalyticsEngine();
  private activeRules = new Map<string, AutomationRule>();
  private executionQueue = new Map<string, any[]>();

  /**
   * Create and manage smart reminder system with optimal timing
   */
  async createSmartReminderSystem(
    tenantId: string,
    options: {
      enablePersonalization?: boolean;
      enableOptimalTiming?: boolean;
      enableMultiChannel?: boolean;
      customRules?: Partial<AutomationRule>[];
    } = {}
  ): Promise<{
    system_id: string;
    active_rules: AutomationRule[];
    optimization_metrics: {
      response_rate: number;
      booking_confirmation_rate: number;
      customer_satisfaction: number;
    };
  }> {
    try {
      console.log(`📅 Creating smart reminder system for tenant ${tenantId}`);

      const systemId = `reminder_system_${tenantId}_${Date.now()}`;
      const rules: AutomationRule[] = [];

      // 24-hour advance reminder
      rules.push(await this.createReminderRule(tenantId, {
        name: '24-Hour Advance Reminder',
        hours_before: 24,
        channels: ['whatsapp', 'sms'],
        personalization_enabled: options.enablePersonalization || true
      }));

      // 2-hour advance reminder
      rules.push(await this.createReminderRule(tenantId, {
        name: '2-Hour Advance Reminder',
        hours_before: 2,
        channels: ['whatsapp'],
        personalization_enabled: options.enablePersonalization || true
      }));

      // Follow-up for no-response
      if (options.enableMultiChannel) {
        rules.push(await this.createFollowUpRule(tenantId, {
          name: 'No Response Follow-up',
          trigger_after_hours: 1,
          escalation_channels: ['sms', 'call']
        }));
      }

      // Post-appointment feedback
      rules.push(await this.createFeedbackRule(tenantId, {
        name: 'Post-Appointment Feedback',
        delay_hours: 24
      }));

      // Save rules to database
      for (const rule of rules) {
        await this.saveAutomationRule(rule);
        this.activeRules.set(rule.id, rule);
      }

      // Calculate initial metrics
      const optimizationMetrics = await this.calculateReminderMetrics(tenantId);

      console.log(`✅ Smart reminder system created with ${rules.length} rules`);

      return {
        system_id: systemId,
        active_rules: rules,
        optimization_metrics: optimizationMetrics
      };

    } catch (error) {
      console.error('❌ Error creating smart reminder system:', error);
      throw error;
    }
  }

  /**
   * Implement automated rebooking for missed appointments
   */
  async implementAutomatedRebooking(
    tenantId: string,
    options: {
      enableIncentives?: boolean;
      maxRebookingAttempts?: number;
      customIncentiveRules?: any[];
    } = {}
  ): Promise<{
    rebooking_system_id: string;
    strategies: RebookingStrategy[];
    success_metrics: {
      rebooking_rate: number;
      average_recovery_time: number;
      customer_retention_impact: number;
    };
  }> {
    try {
      console.log(`🔄 Implementing automated rebooking for tenant ${tenantId}`);

      // Get recent missed appointments
      const missedAppointments = await this.getMissedAppointments(tenantId, {
        days_back: 7,
        include_customer_context: true
      });

      const strategies: RebookingStrategy[] = [];

      for (const appointment of missedAppointments) {
        const strategy = await this.generateRebookingStrategy(
          tenantId, 
          appointment,
          options
        );
        strategies.push(strategy);

        // Execute immediate outreach if enabled
        await this.executeRebookingOutreach(strategy);
      }

      // Create ongoing rebooking automation rule
      const rebookingRule = await this.createRebookingAutomationRule(tenantId, options);
      await this.saveAutomationRule(rebookingRule);

      // Calculate success metrics
      const successMetrics = await this.calculateRebookingMetrics(tenantId);

      const systemId = `rebooking_system_${tenantId}_${Date.now()}`;

      console.log(`✅ Automated rebooking implemented: ${strategies.length} strategies generated`);

      return {
        rebooking_system_id: systemId,
        strategies: strategies,
        success_metrics: successMetrics
      };

    } catch (error) {
      console.error('❌ Error implementing automated rebooking:', error);
      throw error;
    }
  }

  /**
   * Generate dynamic content using AI for marketing and communications
   */
  async generateDynamicContent(
    tenantId: string,
    contentRequests: Array<{
      type: ContentGeneration['content_type'];
      target_customer?: string;
      context?: Record<string, any>;
      tone?: string;
    }>,
    options: {
      enablePersonalization?: boolean;
      enableA_BTesting?: boolean;
      verticalOptimization?: boolean;
    } = {}
  ): Promise<ContentGeneration[]> {
    try {
      console.log(`✨ Generating dynamic content for tenant ${tenantId}`);

      const generatedContent: ContentGeneration[] = [];

      for (const request of contentRequests) {
        // Get target audience data
        const targetAudience = request.target_customer
          ? await this.getCustomerAudienceData(tenantId, request.target_customer)
          : await this.getGenericAudienceData(tenantId);

        // Get vertical context
        const verticalContext = await this.getVerticalContext(tenantId);

        // Generate content using AI
        const content = await this.generateContentWithAI(
          request.type,
          targetAudience,
          verticalContext,
          request.context || {},
          request.tone
        );

        // Optimize content for engagement
        const optimizedContent = await this.optimizeContentForEngagement(
          content,
          targetAudience,
          verticalContext
        );

        generatedContent.push(optimizedContent);

        // Set up A/B testing if enabled
        if (options.enableA_BTesting) {
          await this.setupContentA_BTest(optimizedContent);
        }
      }

      console.log(`✅ Generated ${generatedContent.length} dynamic content pieces`);

      return generatedContent;

    } catch (error) {
      console.error('❌ Error generating dynamic content:', error);
      throw error;
    }
  }

  /**
   * Implement cross-vertical learning and insights sharing
   */
  async implementCrossVerticalLearning(
    options: {
      enableInsightSharing?: boolean;
      enableBestPracticeTransfer?: boolean;
      enablePerformanceBenchmarking?: boolean;
      verticalScope?: string[];
    } = {}
  ): Promise<{
    insights: CrossVerticalInsight[];
    best_practices: Array<{
      practice_id: string;
      source_vertical: string;
      applicable_verticals: string[];
      description: string;
      impact_metrics: Record<string, number>;
      implementation_guide: string[];
    }>;
    performance_comparisons: Array<{
      metric: string;
      vertical_performance: Record<string, number>;
      insights: string[];
    }>;
  }> {
    try {
      console.log('🔄 Implementing cross-vertical learning system');

      const verticals = options.verticalScope || ['beauty', 'hospitality', 'medicine'];
      
      // Generate cross-vertical insights
      const insights = await this.generateCrossVerticalInsights(verticals);

      // Identify transferable best practices
      const bestPractices = options.enableBestPracticeTransfer 
        ? await this.identifyBestPractices(verticals)
        : [];

      // Create performance comparisons
      const performanceComparisons = options.enablePerformanceBenchmarking
        ? await this.createPerformanceComparisons(verticals)
        : [];

      // Enable insight sharing between tenants (anonymized)
      if (options.enableInsightSharing) {
        await this.enableInsightSharing(insights);
      }

      console.log(`✅ Cross-vertical learning implemented: ${insights.length} insights generated`);

      return {
        insights,
        best_practices: bestPractices,
        performance_comparisons: performanceComparisons
      };

    } catch (error) {
      console.error('❌ Error implementing cross-vertical learning:', error);
      throw error;
    }
  }

  /**
   * Optimize reminder timing based on customer behavior patterns
   */
  async optimizeReminderTiming(
    tenantId: string,
    customerPhone: string,
    appointmentId: string
  ): Promise<ReminderOptimization> {
    try {
      // Get customer communication patterns
      const customerPatterns = await this.getCustomerCommunicationPatterns(
        tenantId, 
        customerPhone
      );

      // Get appointment details
      const appointment = await this.getAppointmentDetails(appointmentId);

      // Calculate optimal timing
      const optimalTiming = await this.calculateOptimalReminderTiming(
        customerPatterns,
        appointment
      );

      // Generate personalized message strategy
      const messagePersonalization = await this.generateMessagePersonalization(
        customerPatterns,
        appointment
      );

      // Create follow-up strategy
      const followUpStrategy = this.createFollowUpStrategy(customerPatterns);

      return {
        customer_phone: customerPhone,
        appointment_id: appointmentId,
        optimal_timing: optimalTiming,
        message_personalization: messagePersonalization,
        follow_up_strategy: followUpStrategy
      };

    } catch (error) {
      console.error('Error optimizing reminder timing:', error);
      throw error;
    }
  }

  // Private helper methods

  private async createReminderRule(
    tenantId: string, 
    config: {
      name: string;
      hours_before: number;
      channels: string[];
      personalization_enabled: boolean;
    }
  ): Promise<AutomationRule> {
    const ruleId = `reminder_${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: ruleId,
      tenant_id: tenantId,
      name: config.name,
      description: `Automated reminder sent ${config.hours_before} hours before appointment`,
      trigger: {
        type: 'time_based',
        conditions: [
          {
            field: 'hours_until_appointment',
            operator: 'equals',
            value: config.hours_before
          }
        ],
        schedule: {
          frequency: 'hourly',
          timezone: 'UTC'
        }
      },
      actions: [
        {
          type: 'send_reminder',
          parameters: {
            channels: config.channels,
            personalization_enabled: config.personalization_enabled,
            template_type: 'appointment_reminder'
          }
        }
      ],
      status: 'active',
      success_rate: 0.85, // Initial estimate
      last_executed: '',
      next_execution: '',
      created_at: new Date().toISOString()
    };
  }

  private async createFollowUpRule(
    tenantId: string,
    config: {
      name: string;
      trigger_after_hours: number;
      escalation_channels: string[];
    }
  ): Promise<AutomationRule> {
    const ruleId = `followup_${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: ruleId,
      tenant_id: tenantId,
      name: config.name,
      description: `Follow-up for customers who don't respond to initial reminders`,
      trigger: {
        type: 'condition_based',
        conditions: [
          {
            field: 'reminder_response_received',
            operator: 'equals',
            value: false
          },
          {
            field: 'hours_since_reminder',
            operator: 'greater_than',
            value: config.trigger_after_hours
          }
        ]
      },
      actions: [
        {
          type: 'send_reminder',
          parameters: {
            channels: config.escalation_channels,
            urgency_level: 'high',
            template_type: 'follow_up_reminder'
          }
        }
      ],
      status: 'active',
      success_rate: 0.65,
      last_executed: '',
      next_execution: '',
      created_at: new Date().toISOString()
    };
  }

  private async createFeedbackRule(
    tenantId: string,
    config: {
      name: string;
      delay_hours: number;
    }
  ): Promise<AutomationRule> {
    const ruleId = `feedback_${tenantId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      id: ruleId,
      tenant_id: tenantId,
      name: config.name,
      description: `Request feedback after completed appointments`,
      trigger: {
        type: 'event_based',
        conditions: [
          {
            field: 'appointment_status',
            operator: 'equals',
            value: 'completed'
          }
        ]
      },
      actions: [
        {
          type: 'send_notification',
          parameters: {
            template_type: 'feedback_request',
            delay_hours: config.delay_hours
          },
          delay_minutes: config.delay_hours * 60
        }
      ],
      status: 'active',
      success_rate: 0.45,
      last_executed: '',
      next_execution: '',
      created_at: new Date().toISOString()
    };
  }

  private async saveAutomationRule(rule: AutomationRule): Promise<void> {
    try {
      await this.supabase
        .from('automation_rules')
        .upsert(rule);
    } catch (error) {
      console.error('Error saving automation rule:', error);
    }
  }

  private async calculateReminderMetrics(tenantId: string): Promise<any> {
    // Placeholder implementation
    return {
      response_rate: 0.85,
      booking_confirmation_rate: 0.92,
      customer_satisfaction: 4.6
    };
  }

  private async getMissedAppointments(tenantId: string, options: any): Promise<any[]> {
    const daysAgo = new Date(Date.now() - options.days_back * 24 * 60 * 60 * 1000);

    try {
      const { data: appointments } = await this.supabase
        .from('bookings')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'no_show')
        .gte('created_at', daysAgo.toISOString());

      return appointments || [];
    } catch (error) {
      console.error('Error getting missed appointments:', error);
      return [];
    }
  }

  private async generateRebookingStrategy(
    tenantId: string,
    appointment: any,
    options: any
  ): Promise<RebookingStrategy> {
    // Get customer preferences and history
    const customerRecommendations = await this.smartRecommendations.getServiceRecommendations(
      tenantId,
      appointment.customer_phone,
      {
        preferredDate: appointment.scheduled_date,
        includeCrossSell: false
      }
    );

    // Generate rebooking suggestions
    const rebookingSuggestions = customerRecommendations.slice(0, 3).map((rec, index) => ({
      service_id: rec.service_id,
      staff_id: rec.staff_suggestions[0]?.staff_id || '',
      suggested_date: rec.optimal_time_slots[0]?.date || '',
      suggested_time: rec.optimal_time_slots[0]?.time || '',
      incentive: options.enableIncentives ? {
        type: 'discount' as const,
        value: 10 + (index * 5), // 10%, 15%, 20% discounts
        description: `${10 + (index * 5)}% off for rebooking`
      } : undefined,
      confidence_score: rec.confidence_score
    }));

    return {
      customer_phone: appointment.customer_phone,
      missed_appointment: {
        appointment_id: appointment.id,
        service_id: appointment.service_id,
        missed_date: appointment.scheduled_date,
        reason: appointment.cancellation_reason
      },
      rebooking_suggestions: rebookingSuggestions,
      outreach_plan: {
        initial_contact: {
          timing: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours later
          channel: 'whatsapp',
          message_template: 'rebooking_offer'
        },
        follow_ups: [
          {
            delay_hours: 24,
            channel: 'sms',
            message_template: 'rebooking_reminder'
          },
          {
            delay_hours: 72,
            channel: 'whatsapp',
            message_template: 'rebooking_final_offer'
          }
        ]
      }
    };
  }

  private async executeRebookingOutreach(strategy: RebookingStrategy): Promise<void> {
    // Implementation would send messages through WhatsApp/SMS
    console.log(`📞 Executing rebooking outreach for ${strategy.customer_phone}`);
  }

  private async createRebookingAutomationRule(tenantId: string, options: any): Promise<AutomationRule> {
    const ruleId = `rebooking_${tenantId}_${Date.now()}`;

    return {
      id: ruleId,
      tenant_id: tenantId,
      name: 'Automated Rebooking System',
      description: 'Automatically reach out to customers who missed appointments',
      trigger: {
        type: 'event_based',
        conditions: [
          {
            field: 'appointment_status',
            operator: 'equals',
            value: 'no_show'
          }
        ]
      },
      actions: [
        {
          type: 'trigger_workflow',
          parameters: {
            workflow_type: 'rebooking_outreach',
            enable_incentives: options.enableIncentives || false,
            max_attempts: options.maxRebookingAttempts || 3
          },
          delay_minutes: 120 // 2 hour delay
        }
      ],
      status: 'active',
      success_rate: 0.35, // Initial estimate
      last_executed: '',
      next_execution: '',
      created_at: new Date().toISOString()
    };
  }

  private async calculateRebookingMetrics(tenantId: string): Promise<any> {
    // Placeholder implementation
    return {
      rebooking_rate: 0.35,
      average_recovery_time: 48, // hours
      customer_retention_impact: 0.25
    };
  }

  // Additional helper methods for content generation, cross-vertical learning, etc.
  
  private async getCustomerAudienceData(tenantId: string, customerPhone: string): Promise<any> {
    // Get customer profile and preferences
    return {
      customer_segment: 'regular',
      demographics: { age_range: '25-35' },
      preferences: { communication_style: 'friendly' }
    };
  }

  private async getGenericAudienceData(tenantId: string): Promise<any> {
    return {
      customer_segment: 'general',
      demographics: {},
      preferences: { communication_style: 'professional' }
    };
  }

  private async getVerticalContext(tenantId: string): Promise<'beauty' | 'hospitality' | 'medicine'> {
    // Get tenant's vertical from database
    return 'beauty'; // Placeholder
  }

  private async generateContentWithAI(
    type: ContentGeneration['content_type'],
    audience: any,
    vertical: string,
    context: any,
    tone?: string
  ): Promise<ContentGeneration> {
    // AI content generation implementation
    return {
      content_type: type,
      target_audience: audience,
      vertical_context: vertical as any,
      generated_content: {
        primary_text: `Generated ${type} content for ${vertical}`,
        alternative_versions: ['Alternative 1', 'Alternative 2'],
        call_to_action: 'Book now!',
        personalization_tags: ['{{name}}', '{{service}}']
      },
      optimization_data: {
        predicted_engagement: 0.75,
        sentiment_score: 0.8,
        readability_score: 0.9,
        conversion_potential: 0.65
      }
    };
  }

  private async optimizeContentForEngagement(
    content: ContentGeneration,
    audience: any,
    vertical: string
  ): Promise<ContentGeneration> {
    // Content optimization implementation
    return content; // Placeholder
  }

  private async setupContentA_BTest(content: ContentGeneration): Promise<void> {
    // A/B testing setup implementation
    console.log(`🧪 Setting up A/B test for ${content.content_type}`);
  }

  // Cross-vertical learning methods
  
  private async generateCrossVerticalInsights(verticals: string[]): Promise<CrossVerticalInsight[]> {
    // Generate insights by analyzing patterns across verticals
    return [
      {
        insight_id: `insight_${Date.now()}`,
        source_vertical: 'beauty',
        applicable_verticals: ['hospitality'],
        insight_type: 'customer_behavior',
        description: 'Weekend booking patterns show increased demand',
        data_points: [
          { metric: 'weekend_booking_rate', value: 1.4, context: 'vs weekdays' }
        ],
        recommendations: [
          {
            action: 'Implement weekend pricing premium',
            expected_impact: '15% revenue increase',
            implementation_complexity: 'low',
            success_probability: 0.8
          }
        ],
        confidence_level: 0.85,
        validation_status: 'pending'
      }
    ];
  }

  private async identifyBestPractices(verticals: string[]): Promise<any[]> {
    return []; // Placeholder
  }

  private async createPerformanceComparisons(verticals: string[]): Promise<any[]> {
    return []; // Placeholder
  }

  private async enableInsightSharing(insights: CrossVerticalInsight[]): Promise<void> {
    // Enable anonymized insight sharing
    console.log(`🤝 Enabling insight sharing for ${insights.length} insights`);
  }

  // Communication optimization methods

  private async getCustomerCommunicationPatterns(tenantId: string, customerPhone: string): Promise<any> {
    return {
      preferred_times: ['10:00', '14:00', '18:00'],
      response_rates_by_channel: { whatsapp: 0.9, sms: 0.7, email: 0.4 },
      engagement_patterns: { peak_hours: [10, 14, 18], peak_days: [1, 2, 3, 4, 5] }
    };
  }

  private async getAppointmentDetails(appointmentId: string): Promise<any> {
    try {
      const { data: appointment } = await this.supabase
        .from('bookings')
        .select('*')
        .eq('id', appointmentId)
        .single();

      return appointment;
    } catch (error) {
      console.error('Error getting appointment details:', error);
      return {};
    }
  }

  private async calculateOptimalReminderTiming(patterns: any, appointment: any): Promise<any> {
    // Calculate optimal send time based on customer patterns and appointment time
    const appointmentTime = new Date(appointment.scheduled_at);
    const customerPeakTimes = patterns.preferred_times.map((time: string) => {
      const [hour, minute] = time.split(':');
      return parseInt(hour);
    });

    // Find the peak time closest to but before appointment
    const optimalHour = customerPeakTimes
      .filter((hour: number) => hour < appointmentTime.getHours())
      .pop() || customerPeakTimes[0];

    const optimalTime = new Date(appointmentTime);
    optimalTime.setHours(optimalHour, 0, 0, 0);
    optimalTime.setDate(appointmentTime.getDate() - 1); // Day before

    return {
      send_at: optimalTime.toISOString(),
      channels: [
        { channel: 'whatsapp', priority: 1, success_probability: 0.9 },
        { channel: 'sms', priority: 2, success_probability: 0.7 }
      ]
    };
  }

  private async generateMessagePersonalization(patterns: any, appointment: any): Promise<any> {
    return {
      tone: patterns.preferred_communication_style || 'friendly',
      content_elements: ['service_name', 'appointment_time', 'staff_name'],
      urgency_level: 'medium'
    };
  }

  private createFollowUpStrategy(patterns: any): any {
    return {
      intervals: [60, 180, 360], // 1 hour, 3 hours, 6 hours
      escalation_channels: ['whatsapp', 'sms', 'call'],
      max_attempts: 3
    };
  }
}

export { AutomationWorkflows, type AutomationRule, type ReminderOptimization, type RebookingStrategy, type ContentGeneration, type CrossVerticalInsight };