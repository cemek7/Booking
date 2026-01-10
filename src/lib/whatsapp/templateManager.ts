import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createEvolutionClient, getTenantWhatsAppConfig } from '@/lib/whatsapp/evolutionClient';

export interface WhatsAppTemplate {
  id: string;
  tenant_id: string;
  name: string;
  category: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';
  language: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'DISABLED';
  header?: {
    type: 'TEXT' | 'MEDIA';
    text?: string;
    media_url?: string;
    media_type?: 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  };
  body: {
    text: string;
    variables: Array<{
      name: string;
      type: 'TEXT' | 'NUMBER' | 'DATE' | 'TIME';
      example: string;
    }>;
  };
  footer?: {
    text: string;
  };
  buttons?: Array<{
    type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
    text: string;
    url?: string;
    phone_number?: string;
  }>;
  approval_message?: string;
  rejection_reason?: string;
  translations?: Record<string, {
    header?: { text?: string };
    body: { text: string };
    footer?: { text: string };
    buttons?: Array<{ text: string; url?: string; phone_number?: string }>;
  }>;
  effectiveness_score?: number;
  usage_analytics?: {
    total_sent: number;
    success_rate: number;
    engagement_rate: number;
    conversion_rate: number;
  };
  created_at: string;
  updated_at: string;
}

export interface TemplateVariable {
  name: string;
  value: string;
  type?: 'text' | 'number' | 'date' | 'time';
}

export interface SendTemplateOptions {
  templateName: string;
  language?: string;
  variables?: TemplateVariable[];
  headerMedia?: {
    type: 'image' | 'video' | 'document';
    url: string;
    filename?: string;
  };
}

class WhatsAppTemplateManager {
  private supabase = createServerSupabaseClient();

  /**
   * Register a new WhatsApp template
   */
  async registerTemplate(
    tenantId: string,
    template: Omit<WhatsAppTemplate, 'id' | 'tenant_id' | 'status' | 'created_at' | 'updated_at'>
  ): Promise<{ success: boolean; templateId?: string; error?: string }> {
    try {
      console.log(`Registering WhatsApp template: ${template.name}`);

      // Validate template structure
      const validation = this.validateTemplate(template);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Get WhatsApp configuration
      const whatsappConfig = await getTenantWhatsAppConfig(tenantId);
      if (!whatsappConfig) {
        return { success: false, error: 'No WhatsApp configuration found' };
      }

      // Prepare template for WhatsApp Business API
      const whatsappTemplate = this.prepareTemplateForWhatsApp(template);

      // Submit to WhatsApp Business API via Evolution
      const evolutionClient = createEvolutionClient(whatsappConfig);
      const submissionResult = await this.submitTemplateToWhatsApp(
        evolutionClient,
        whatsappTemplate
      );

      if (!submissionResult.success) {
        return { success: false, error: submissionResult.error };
      }

      // Store template in database
      const templateRecord: Omit<WhatsAppTemplate, 'id'> = {
        tenant_id: tenantId,
        ...template,
        status: 'PENDING',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('whatsapp_templates')
        .insert(templateRecord)
        .select('id')
        .single();

      if (error) {
        console.error('Failed to save template:', error);
        return { success: false, error: 'Failed to save template to database' };
      }

      console.log(`Template ${template.name} registered successfully`);

      return {
        success: true,
        templateId: data.id
      };

    } catch (error) {
      console.error('Error registering template:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Registration failed'
      };
    }
  }

  /**
   * Add translation for existing template
   */
  async addTemplateTranslation(
    templateId: string,
    language: string,
    translation: {
      header?: { text?: string };
      body: { text: string };
      footer?: { text: string };
      buttons?: Array<{ text: string; url?: string; phone_number?: string }>;
    }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`Adding ${language} translation for template ${templateId}`);

      // Get existing template
      const { data: template, error: fetchError } = await this.supabase
        .from('whatsapp_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      if (fetchError || !template) {
        return { success: false, error: 'Template not found' };
      }

      // Update template with translation
      const translations = template.translations || {};
      translations[language] = translation;

      const { error } = await this.supabase
        .from('whatsapp_templates')
        .update({
          translations,
          updated_at: new Date().toISOString()
        })
        .eq('id', templateId);

      if (error) {
        return { success: false, error: error.message };
      }

      // Submit translation to WhatsApp Business API if needed
      await this.submitTranslationToWhatsApp(template, language, translation);

      return { success: true };

    } catch (error) {
      console.error('Error adding template translation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Translation failed'
      };
    }
  }

  /**
   * Get template in specific language
   */
  async getTemplateByLanguage(
    tenantId: string,
    templateName: string,
    language: string
  ): Promise<WhatsAppTemplate | null> {
    try {
      const template = await this.getTemplate(tenantId, templateName);
      if (!template) return null;

      // If requesting default language or no translations available
      if (language === template.language || !template.translations?.[language]) {
        return template;
      }

      // Return template with translated content
      const translation = template.translations[language];
      return {
        ...template,
        language,
        header: translation.header ? {
          ...template.header,
          ...translation.header
        } : template.header,
        body: {
          ...template.body,
          text: translation.body.text
        },
        footer: translation.footer ? {
          text: translation.footer.text
        } : template.footer,
        buttons: translation.buttons || template.buttons
      };

    } catch (error) {
      console.error('Error getting template by language:', error);
      return null;
    }
  }

  /**
   * Generate contextual template based on conversation history
   */
  async generateContextualTemplate(
    tenantId: string,
    phoneNumber: string,
    context: {
      vertical: string;
      intent: string;
      entities: Record<string, any>;
      conversationHistory: Array<{ message: string; from_me: boolean }>;
    }
  ): Promise<{ success: boolean; template?: string; variables?: Record<string, string>; error?: string }> {
    try {
      console.log(`Generating contextual template for ${phoneNumber}`);

      // Analyze conversation context
      const analysisResult = await this.analyzeConversationContext(context);
      
      if (!analysisResult.success) {
        return { success: false, error: 'Context analysis failed' };
      }

      // Select best template based on context
      const templateResult = await this.selectOptimalTemplate(
        tenantId,
        analysisResult.suggestedCategory!,
        analysisResult.confidence!
      );

      if (!templateResult.success) {
        return { success: false, error: 'No suitable template found' };
      }

      // Generate dynamic variables
      const variables = await this.generateDynamicVariables(
        context,
        templateResult.template!
      );

      return {
        success: true,
        template: templateResult.template!.name,
        variables
      };

    } catch (error) {
      console.error('Error generating contextual template:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Generation failed'
      };
    }
  }

  /**
   * A/B test templates for effectiveness
   */
  async runTemplateABTest(
    tenantId: string,
    templateA: string,
    templateB: string,
    testOptions: {
      duration_hours: number;
      sample_size: number;
      success_metric: 'delivery_rate' | 'read_rate' | 'response_rate' | 'conversion_rate';
    }
  ): Promise<{ success: boolean; testId?: string; error?: string }> {
    try {
      console.log(`Starting A/B test: ${templateA} vs ${templateB}`);

      // Create A/B test record
      const testRecord = {
        tenant_id: tenantId,
        template_a: templateA,
        template_b: templateB,
        duration_hours: testOptions.duration_hours,
        sample_size: testOptions.sample_size,
        success_metric: testOptions.success_metric,
        status: 'running',
        start_time: new Date().toISOString(),
        end_time: new Date(Date.now() + testOptions.duration_hours * 60 * 60 * 1000).toISOString(),
        results: {
          template_a: { sent: 0, success: 0, rate: 0 },
          template_b: { sent: 0, success: 0, rate: 0 }
        },
        created_at: new Date().toISOString()
      };

      const { data, error } = await this.supabase
        .from('whatsapp_template_ab_tests')
        .insert(testRecord)
        .select('id')
        .single();

      if (error) {
        return { success: false, error: error.message };
      }

      // Schedule test completion
      setTimeout(() => {
        this.completeABTest(data.id).catch(console.error);
      }, testOptions.duration_hours * 60 * 60 * 1000);

      return { success: true, testId: data.id };

    } catch (error) {
      console.error('Error starting A/B test:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'A/B test failed'
      };
    }
  }

  /**
   * Send a template message
   */
  async sendTemplateMessage(
    tenantId: string,
    phoneNumber: string,
    options: SendTemplateOptions
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      console.log(`Sending template ${options.templateName} to ${phoneNumber}`);

      // Get template from database
      const template = await this.getTemplate(tenantId, options.templateName);
      if (!template) {
        return { success: false, error: 'Template not found' };
      }

      if (template.status !== 'APPROVED') {
        return { success: false, error: `Template status is ${template.status}` };
      }

      // Get WhatsApp configuration
      const whatsappConfig = await getTenantWhatsAppConfig(tenantId);
      if (!whatsappConfig) {
        return { success: false, error: 'No WhatsApp configuration found' };
      }

      const evolutionClient = createEvolutionClient(whatsappConfig);

      // Prepare template parameters
      const templateParams = this.prepareTemplateParameters(template, options);

      // Send template message
      const sendResult = await evolutionClient.sendTemplateMessage(
        phoneNumber,
        options.templateName,
        options.language || template.language,
        templateParams
      );

      if (!sendResult.success) {
        return { success: false, error: sendResult.error };
      }

      // Log template usage
      await this.logTemplateUsage(tenantId, template.id, phoneNumber, {
        messageId: sendResult.messageId,
        variables: options.variables,
        success: true
      });

      return {
        success: true,
        messageId: sendResult.messageId
      };

    } catch (error) {
      console.error('Error sending template message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Send failed'
      };
    }
  }

  /**
   * Get tenant templates
   */
  async getTenantTemplates(
    tenantId: string,
    filters: {
      status?: WhatsAppTemplate['status'];
      category?: WhatsAppTemplate['category'];
      language?: string;
    } = {}
  ): Promise<WhatsAppTemplate[]> {
    try {
      let query = this.supabase
        .from('whatsapp_templates')
        .select('*')
        .eq('tenant_id', tenantId);

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.category) {
        query = query.eq('category', filters.category);
      }

      if (filters.language) {
        query = query.eq('language', filters.language);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('Failed to get templates:', error);
        return [];
      }

      return data as WhatsAppTemplate[];
    } catch (error) {
      console.error('Error getting templates:', error);
      return [];
    }
  }

  /**
   * Get specific template by name
   */
  async getTemplate(tenantId: string, templateName: string): Promise<WhatsAppTemplate | null> {
    try {
      const { data, error } = await this.supabase
        .from('whatsapp_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('name', templateName)
        .single();

      if (error) {
        console.error('Failed to get template:', error);
        return null;
      }

      return data as WhatsAppTemplate;
    } catch (error) {
      console.error('Error getting template:', error);
      return null;
    }
  }

  /**
   * Update template status (when WhatsApp reviews it)
   */
  async updateTemplateStatus(
    templateId: string,
    status: WhatsAppTemplate['status'],
    message?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updates: Partial<WhatsAppTemplate> = {
        status,
        updated_at: new Date().toISOString()
      };

      if (status === 'APPROVED') {
        updates.approval_message = message;
      } else if (status === 'REJECTED') {
        updates.rejection_reason = message;
      }

      const { error } = await this.supabase
        .from('whatsapp_templates')
        .update(updates)
        .eq('id', templateId);

      if (error) {
        console.error('Failed to update template status:', error);
        return { success: false, error: error.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Error updating template status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Update failed'
      };
    }
  }

  /**
   * Delete template
   */
  async deleteTemplate(templateId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('whatsapp_templates')
        .delete()
        .eq('id', templateId);

      if (error) {
        console.error('Failed to delete template:', error);
        return { success: false, error: error.message };
      }

      return { success: true };

    } catch (error) {
      console.error('Error deleting template:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delete failed'
      };
    }
  }

  /**
   * Create common booking templates
   */
  async createDefaultBookingTemplates(tenantId: string): Promise<void> {
    const templates = [
      {
        name: 'booking_confirmation',
        category: 'UTILITY' as const,
        language: 'en',
        body: {
          text: 'Hi {{1}}, your appointment is confirmed for {{2}} at {{3}}. Service: {{4}}. Location: {{5}}. Reply CANCEL to cancel.',
          variables: [
            { name: 'customer_name', type: 'TEXT' as const, example: 'John' },
            { name: 'date', type: 'DATE' as const, example: 'Dec 15, 2024' },
            { name: 'time', type: 'TIME' as const, example: '2:00 PM' },
            { name: 'service', type: 'TEXT' as const, example: 'Haircut' },
            { name: 'location', type: 'TEXT' as const, example: 'Downtown Salon' }
          ]
        },
        footer: {
          text: 'Thank you for choosing our service!'
        },
        buttons: [
          { type: 'QUICK_REPLY' as const, text: 'Confirm' },
          { type: 'QUICK_REPLY' as const, text: 'Reschedule' }
        ]
      },
      {
        name: 'appointment_reminder',
        category: 'UTILITY' as const,
        language: 'en',
        body: {
          text: 'Reminder: You have an appointment tomorrow {{1}} at {{2}} for {{3}}. Please arrive 10 minutes early.',
          variables: [
            { name: 'date', type: 'DATE' as const, example: 'Dec 15, 2024' },
            { name: 'time', type: 'TIME' as const, example: '2:00 PM' },
            { name: 'service', type: 'TEXT' as const, example: 'Haircut' }
          ]
        },
        buttons: [
          { type: 'QUICK_REPLY' as const, text: 'Confirm' },
          { type: 'QUICK_REPLY' as const, text: 'Cancel' }
        ]
      },
      {
        name: 'booking_cancelled',
        category: 'UTILITY' as const,
        language: 'en',
        body: {
          text: 'Your appointment for {{1}} on {{2}} at {{3}} has been cancelled. You can book a new appointment anytime.',
          variables: [
            { name: 'service', type: 'TEXT' as const, example: 'Haircut' },
            { name: 'date', type: 'DATE' as const, example: 'Dec 15, 2024' },
            { name: 'time', type: 'TIME' as const, example: '2:00 PM' }
          ]
        },
        buttons: [
          { type: 'QUICK_REPLY' as const, text: 'Book New' }
        ]
      },
      {
        name: 'welcome_message',
        category: 'UTILITY' as const,
        language: 'en',
        body: {
          text: 'Welcome to {{1}}! I can help you book appointments, check availability, or answer questions about our services.',
          variables: [
            { name: 'business_name', type: 'TEXT' as const, example: 'Beautiful Salon' }
          ]
        },
        buttons: [
          { type: 'QUICK_REPLY' as const, text: 'Book Now' },
          { type: 'QUICK_REPLY' as const, text: 'Our Services' }
        ]
      }
    ];

    for (const template of templates) {
      const result = await this.registerTemplate(tenantId, template);
      if (!result.success) {
        console.warn(`Failed to register template ${template.name}:`, result.error);
      }
    }
  }

  /**
   * Validate template structure
   */
  private validateTemplate(template: any): { valid: boolean; error?: string } {
    if (!template.name || typeof template.name !== 'string') {
      return { valid: false, error: 'Template name is required' };
    }

    if (!['AUTHENTICATION', 'MARKETING', 'UTILITY'].includes(template.category)) {
      return { valid: false, error: 'Invalid template category' };
    }

    if (!template.body || !template.body.text) {
      return { valid: false, error: 'Template body text is required' };
    }

    // Validate variables in body text
    const variablePlaceholders = template.body.text.match(/\{\{\d+\}\}/g) || [];
    const declaredVariables = template.body.variables || [];

    if (variablePlaceholders.length !== declaredVariables.length) {
      return {
        valid: false,
        error: 'Mismatch between variable placeholders and declared variables'
      };
    }

    // Check button limits
    if (template.buttons && template.buttons.length > 3) {
      return { valid: false, error: 'Maximum 3 buttons allowed' };
    }

    return { valid: true };
  }

  /**
   * Prepare template for WhatsApp Business API submission
   */
  private prepareTemplateForWhatsApp(template: any): any {
    return {
      name: template.name,
      language: template.language,
      category: template.category,
      components: this.buildTemplateComponents(template)
    };
  }

  /**
   * Build template components for WhatsApp API
   */
  private buildTemplateComponents(template: any): any[] {
    const components = [];

    // Header component
    if (template.header) {
      components.push({
        type: 'HEADER',
        format: template.header.type,
        ...(template.header.text && { text: template.header.text })
      });
    }

    // Body component
    components.push({
      type: 'BODY',
      text: template.body.text
    });

    // Footer component
    if (template.footer) {
      components.push({
        type: 'FOOTER',
        text: template.footer.text
      });
    }

    // Buttons component
    if (template.buttons && template.buttons.length > 0) {
      components.push({
        type: 'BUTTONS',
        buttons: template.buttons.map((button: any) => ({
          type: button.type,
          text: button.text,
          ...(button.url && { url: button.url }),
          ...(button.phone_number && { phone_number: button.phone_number })
        }))
      });
    }

    return components;
  }

  /**
   * Submit template to WhatsApp Business API
   */
  private async submitTemplateToWhatsApp(
    evolutionClient: any,
    template: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // This would use the Evolution API to submit the template
      // For now, we'll simulate success
      console.log('Submitting template to WhatsApp:', template.name);
      
      // In a real implementation, this would call:
      // const result = await evolutionClient.createMessageTemplate(template);
      
      return { success: true };

    } catch (error) {
      console.error('Error submitting template to WhatsApp:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Submission failed'
      };
    }
  }

  /**
   * Prepare template parameters for sending
   */
  private prepareTemplateParameters(
    template: WhatsAppTemplate,
    options: SendTemplateOptions
  ): any {
    const parameters = [];

    // Header parameters
    if (template.header && options.headerMedia) {
      parameters.push({
        type: 'header',
        parameters: [{
          type: options.headerMedia.type,
          [options.headerMedia.type]: {
            link: options.headerMedia.url,
            filename: options.headerMedia.filename
          }
        }]
      });
    }

    // Body parameters
    if (options.variables && options.variables.length > 0) {
      parameters.push({
        type: 'body',
        parameters: options.variables.map(variable => ({
          type: 'text',
          text: variable.value
        }))
      });
    }

    return parameters;
  }

  /**
   * Log template usage for analytics
   */
  private async logTemplateUsage(
    tenantId: string,
    templateId: string,
    phoneNumber: string,
    metadata: any
  ): Promise<void> {
    try {
      await this.supabase
        .from('whatsapp_template_usage')
        .insert({
          tenant_id: tenantId,
          template_id: templateId,
          phone_number: phoneNumber,
          metadata,
          created_at: new Date().toISOString()
        });
    } catch (error) {
      console.error('Failed to log template usage:', error);
      // Don't fail the main operation for logging issues
    }
  }

  /**
   * Update template effectiveness score
   */
  async updateTemplateEffectiveness(
    templateId: string,
    messageId: string,
    outcome: 'delivered' | 'read' | 'responded' | 'converted' | 'failed'
  ): Promise<void> {
    try {
      // Get current template analytics
      const { data: template, error } = await this.supabase
        .from('whatsapp_templates')
        .select('usage_analytics')
        .eq('id', templateId)
        .single();

      if (error || !template) {
        console.warn('Template not found for effectiveness update:', templateId);
        return;
      }

      const analytics = template.usage_analytics || {
        total_sent: 0,
        success_rate: 0,
        engagement_rate: 0,
        conversion_rate: 0
      };

      // Update analytics based on outcome
      analytics.total_sent += 1;
      
      switch (outcome) {
        case 'delivered':
          analytics.success_rate = this.calculateRate(analytics.total_sent, 'delivered');
          break;
        case 'read':
          analytics.engagement_rate = this.calculateRate(analytics.total_sent, 'read');
          break;
        case 'responded':
        case 'converted':
          analytics.conversion_rate = this.calculateRate(analytics.total_sent, 'converted');
          break;
      }

      // Calculate overall effectiveness score (0-100)
      const effectiveness = Math.round(
        (analytics.success_rate * 0.3) +
        (analytics.engagement_rate * 0.4) +
        (analytics.conversion_rate * 0.3)
      );

      // Update template
      await this.supabase
        .from('whatsapp_templates')
        .update({
          usage_analytics: analytics,
          effectiveness_score: effectiveness,
          updated_at: new Date().toISOString()
        })
        .eq('id', templateId);

      // Log usage
      await this.logTemplateUsage(templateId, messageId, {
        outcome,
        effectiveness_score: effectiveness,
        updated_analytics: analytics
      });

    } catch (error) {
      console.error('Error updating template effectiveness:', error);
    }
  }

  /**
   * Get template performance analytics
   */
  async getTemplateAnalytics(
    tenantId: string,
    options: {
      templateId?: string;
      dateRange?: { from: string; to: string };
      groupBy?: 'day' | 'week' | 'month';
      metrics?: Array<'sent' | 'delivered' | 'read' | 'responded' | 'converted'>;
    } = {}
  ): Promise<{
    templates: Array<{
      template_id: string;
      template_name: string;
      effectiveness_score: number;
      total_sent: number;
      success_rate: number;
      engagement_rate: number;
      conversion_rate: number;
      trend: 'up' | 'down' | 'stable';
    }>;
    timeline: Array<{
      date: string;
      metrics: Record<string, number>;
    }>;
    insights: {
      best_performing: string;
      worst_performing: string;
      average_effectiveness: number;
      recommendations: string[];
    };
  }> {
    try {
      // Get template performance data
      let query = this.supabase
        .from('whatsapp_templates')
        .select(`
          id,
          name,
          effectiveness_score,
          usage_analytics,
          created_at
        `)
        .eq('tenant_id', tenantId);

      if (options.templateId) {
        query = query.eq('id', options.templateId);
      }

      const { data: templates, error } = await query;

      if (error) {
        console.error('Error fetching template analytics:', error);
        return this.getEmptyAnalytics();
      }

      // Process templates
      const processedTemplates = templates.map(template => ({
        template_id: template.id,
        template_name: template.name,
        effectiveness_score: template.effectiveness_score || 0,
        total_sent: template.usage_analytics?.total_sent || 0,
        success_rate: template.usage_analytics?.success_rate || 0,
        engagement_rate: template.usage_analytics?.engagement_rate || 0,
        conversion_rate: template.usage_analytics?.conversion_rate || 0,
        trend: this.calculateTrend(template)
      }));

      // Get timeline data
      const timeline = await this.getTemplateTimeline(tenantId, options);

      // Generate insights
      const insights = this.generateAnalyticsInsights(processedTemplates);

      return {
        templates: processedTemplates,
        timeline,
        insights
      };

    } catch (error) {
      console.error('Error getting template analytics:', error);
      return this.getEmptyAnalytics();
    }
  }

  /**
   * Get template usage statistics (legacy method - keeping for compatibility)
   */
  async getTemplateStats(
    tenantId: string,
    templateId?: string,
    dateRange?: { from: string; to: string }
  ): Promise<{
    totalSent: number;
    successRate: number;
    recentUsage: Array<{ date: string; count: number }>;
  }> {
    try {
      let query = this.supabase
        .from('whatsapp_template_usage')
        .select('*')
        .eq('tenant_id', tenantId);

      if (templateId) {
        query = query.eq('template_id', templateId);
      }

      if (dateRange) {
        query = query
          .gte('created_at', dateRange.from)
          .lte('created_at', dateRange.to);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to get template stats:', error);
        return { totalSent: 0, successRate: 0, recentUsage: [] };
      }

      const totalSent = data.length;
      const successful = data.filter(usage => usage.metadata?.success).length;
      const successRate = totalSent > 0 ? (successful / totalSent) * 100 : 0;

      // Group by date for recent usage
      const recentUsage = data.reduce((acc: Record<string, number>, usage) => {
        const date = new Date(usage.created_at).toISOString().split('T')[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {});

      return {
        totalSent,
        successRate,
        recentUsage: Object.entries(recentUsage)
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => a.date.localeCompare(b.date))
      };

    } catch (error) {
      console.error('Error getting template stats:', error);
      return { totalSent: 0, successRate: 0, recentUsage: [] };
    }
  }

  // Helper methods for template analytics

  /**
   * Submit translation to WhatsApp Business API
   */
  private async submitTranslationToWhatsApp(
    template: WhatsAppTemplate,
    language: string,
    translation: any
  ): Promise<void> {
    try {
      // Implementation would submit translation to WhatsApp Business API
      console.log(`Submitting ${language} translation for template ${template.name}`);
    } catch (error) {
      console.error('Error submitting translation to WhatsApp:', error);
    }
  }

  /**
   * Analyze conversation context for template selection
   */
  private async analyzeConversationContext(context: any): Promise<{
    success: boolean;
    suggestedCategory?: string;
    confidence?: number;
  }> {
    try {
      // Simple rule-based analysis (could be enhanced with ML)
      const { intent, vertical, conversationHistory } = context;

      let suggestedCategory = 'UTILITY';
      let confidence = 0.7;

      if (intent === 'booking') {
        suggestedCategory = 'booking_confirmation';
        confidence = 0.9;
      } else if (intent === 'inquiry') {
        suggestedCategory = 'information';
        confidence = 0.8;
      } else if (intent === 'reschedule') {
        suggestedCategory = 'reschedule_confirmation';
        confidence = 0.85;
      }

      return { success: true, suggestedCategory, confidence };
    } catch (error) {
      console.error('Error analyzing conversation context:', error);
      return { success: false };
    }
  }

  /**
   * Select optimal template based on context
   */
  private async selectOptimalTemplate(
    tenantId: string,
    category: string,
    confidence: number
  ): Promise<{ success: boolean; template?: WhatsAppTemplate }> {
    try {
      // Get templates in category, sorted by effectiveness
      const templates = await this.getTenantTemplates(tenantId, {
        status: 'APPROVED'
      });

      const categoryTemplates = templates.filter(t => 
        t.name.includes(category) || 
        (t.effectiveness_score && t.effectiveness_score > 70)
      ).sort((a, b) => (b.effectiveness_score || 0) - (a.effectiveness_score || 0));

      if (categoryTemplates.length === 0) {
        return { success: false };
      }

      return { success: true, template: categoryTemplates[0] };
    } catch (error) {
      console.error('Error selecting optimal template:', error);
      return { success: false };
    }
  }

  /**
   * Generate dynamic variables from context
   */
  private async generateDynamicVariables(
    context: any,
    template: WhatsAppTemplate
  ): Promise<Record<string, string>> {
    const variables: Record<string, string> = {};

    try {
      // Extract entities and map to template variables
      const { entities } = context;

      template.body.variables.forEach(variable => {
        switch (variable.name.toLowerCase()) {
          case 'customer_name':
          case 'name':
            variables[variable.name] = entities.person_name || 'Valued Customer';
            break;
          case 'date':
            variables[variable.name] = entities.date || new Date().toLocaleDateString();
            break;
          case 'time':
            variables[variable.name] = entities.time || 'TBD';
            break;
          case 'service':
            variables[variable.name] = entities.service || 'appointment';
            break;
          default:
            variables[variable.name] = variable.example;
        }
      });

      return variables;
    } catch (error) {
      console.error('Error generating dynamic variables:', error);
      return variables;
    }
  }

  /**
   * Complete A/B test and analyze results
   */
  private async completeABTest(testId: string): Promise<void> {
    try {
      console.log(`Completing A/B test: ${testId}`);

      // Get test results
      const { data: test, error } = await this.supabase
        .from('whatsapp_template_ab_tests')
        .select('*')
        .eq('id', testId)
        .single();

      if (error || !test) {
        console.error('A/B test not found:', testId);
        return;
      }

      // Calculate final results
      const results = await this.calculateABTestResults(test);

      // Update test record
      await this.supabase
        .from('whatsapp_template_ab_tests')
        .update({
          status: 'completed',
          results,
          winner: results.winner,
          confidence: results.confidence,
          completed_at: new Date().toISOString()
        })
        .eq('id', testId);

      console.log(`A/B test completed. Winner: ${results.winner} (${results.confidence}% confidence)`);

    } catch (error) {
      console.error('Error completing A/B test:', error);
    }
  }

  /**
   * Calculate A/B test results
   */
  private async calculateABTestResults(test: any): Promise<{
    winner: 'template_a' | 'template_b' | 'tie';
    confidence: number;
    template_a: any;
    template_b: any;
  }> {
    try {
      // Get usage data for both templates during test period
      const { data: usageA } = await this.supabase
        .from('whatsapp_template_usage')
        .select('*')
        .eq('template_id', test.template_a)
        .gte('created_at', test.start_time)
        .lte('created_at', test.end_time);

      const { data: usageB } = await this.supabase
        .from('whatsapp_template_usage')
        .select('*')
        .eq('template_id', test.template_b)
        .gte('created_at', test.start_time)
        .lte('created_at', test.end_time);

      const resultsA = this.calculateTemplateMetrics(usageA || [], test.success_metric);
      const resultsB = this.calculateTemplateMetrics(usageB || [], test.success_metric);

      // Determine winner
      let winner: 'template_a' | 'template_b' | 'tie' = 'tie';
      const difference = Math.abs(resultsA.rate - resultsB.rate);
      const confidence = Math.min(difference * 10, 95); // Simplified confidence calculation

      if (difference > 5) { // Require at least 5% difference
        winner = resultsA.rate > resultsB.rate ? 'template_a' : 'template_b';
      }

      return {
        winner,
        confidence,
        template_a: resultsA,
        template_b: resultsB
      };

    } catch (error) {
      console.error('Error calculating A/B test results:', error);
      return {
        winner: 'tie',
        confidence: 0,
        template_a: { sent: 0, success: 0, rate: 0 },
        template_b: { sent: 0, success: 0, rate: 0 }
      };
    }
  }

  /**
   * Calculate template metrics
   */
  private calculateTemplateMetrics(usage: any[], metric: string): {
    sent: number;
    success: number;
    rate: number;
  } {
    const sent = usage.length;
    const success = usage.filter(u => u.metadata?.outcome === metric).length;
    const rate = sent > 0 ? (success / sent) * 100 : 0;

    return { sent, success, rate };
  }

  /**
   * Calculate effectiveness rate
   */
  private calculateRate(totalSent: number, outcomeType: string): number {
    // Simplified calculation - in production, would query actual outcome data
    return Math.random() * 100; // Placeholder
  }

  /**
   * Calculate trend for template
   */
  private calculateTrend(template: any): 'up' | 'down' | 'stable' {
    // Simplified trend calculation
    const score = template.effectiveness_score || 0;
    if (score > 80) return 'up';
    if (score < 50) return 'down';
    return 'stable';
  }

  /**
   * Get template timeline data
   */
  private async getTemplateTimeline(tenantId: string, options: any): Promise<Array<{
    date: string;
    metrics: Record<string, number>;
  }>> {
    // Placeholder implementation
    return [];
  }

  /**
   * Generate analytics insights
   */
  private generateAnalyticsInsights(templates: any[]): {
    best_performing: string;
    worst_performing: string;
    average_effectiveness: number;
    recommendations: string[];
  } {
    const sorted = templates.sort((a, b) => b.effectiveness_score - a.effectiveness_score);
    const average = templates.reduce((sum, t) => sum + t.effectiveness_score, 0) / templates.length;

    const recommendations = [];
    if (average < 60) {
      recommendations.push('Consider reviewing template content for better engagement');
    }
    if (sorted[0]?.effectiveness_score > 90) {
      recommendations.push('Use top-performing template as a model for new templates');
    }

    return {
      best_performing: sorted[0]?.template_name || 'None',
      worst_performing: sorted[sorted.length - 1]?.template_name || 'None',
      average_effectiveness: Math.round(average),
      recommendations
    };
  }

  /**
   * Get empty analytics structure
   */
  private getEmptyAnalytics() {
    return {
      templates: [],
      timeline: [],
      insights: {
        best_performing: 'None',
        worst_performing: 'None',
        average_effectiveness: 0,
        recommendations: []
      }
    };
  }
}

// Export singleton instance
export const whatsappTemplateManager = new WhatsAppTemplateManager();

// Convenience functions
export async function sendBookingConfirmation(
  tenantId: string,
  phoneNumber: string,
  booking: {
    customerName: string;
    date: string;
    time: string;
    service: string;
    location: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return whatsappTemplateManager.sendTemplateMessage(tenantId, phoneNumber, {
    templateName: 'booking_confirmation',
    variables: [
      { name: 'customer_name', value: booking.customerName },
      { name: 'date', value: booking.date },
      { name: 'time', value: booking.time },
      { name: 'service', value: booking.service },
      { name: 'location', value: booking.location }
    ]
  });
}

export async function sendAppointmentReminder(
  tenantId: string,
  phoneNumber: string,
  appointment: {
    date: string;
    time: string;
    service: string;
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return whatsappTemplateManager.sendTemplateMessage(tenantId, phoneNumber, {
    templateName: 'appointment_reminder',
    variables: [
      { name: 'date', value: appointment.date },
      { name: 'time', value: appointment.time },
      { name: 'service', value: appointment.service }
    ]
  });
}