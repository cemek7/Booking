import { defaultLogger } from '@/lib/logger';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { recordLLMUsage, canMakeLLMRequest } from '@/lib/llmUsageTracker';
import { callOpenRouter } from '@/lib/openrouter';
import { isGoogleAIConfigured, getGoogleAIModel } from '@/lib/google-ai';
import { estimatePromptTokens, withTenantWalletSpend } from './billing/ai-wallet';

export interface TemplateGenerationRequest {
  category: 'confirmation' | 'reminder' | 'cancellation' | 'welcome' | 'follow_up' | 'custom';
  vertical: 'beauty' | 'hospitality' | 'medicine' | 'general';
  language: 'en' | 'es' | 'fr' | 'de' | 'pt';
  tone: 'professional' | 'friendly' | 'casual' | 'warm' | 'formal';
  description?: string;
  customRequirements?: string;
  includeEmojis?: boolean;
  length: 'short' | 'medium' | 'long';
}

export interface GeneratedTemplate {
  name: string;
  content: string;
  description: string;
  variables: Array<{
    name: string;
    type: 'text' | 'date' | 'time' | 'email' | 'phone' | 'number';
    description: string;
    required: boolean;
  }>;
  confidence: number;
}

type LLMChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    } | null;
    text?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
};

class AITemplateGenerator {

  /**
   * Generate template content using AI
   */
  async generateTemplate(
    request: TemplateGenerationRequest,
    tenantId?: string,
    userId?: string
  ): Promise<GeneratedTemplate> {
    // Check quota if tenant/user provided
    if (tenantId && !(await canMakeLLMRequest(tenantId, 500))) {
      throw new Error('LLM quota exceeded. Please upgrade your plan or wait for quota reset.');
    }

    if (!isGoogleAIConfigured() && !process.env.OPENROUTER_API_KEY) {
      throw new Error('No LLM provider configured. Set GOOGLE_AI_API_KEY or OPENROUTER_API_KEY.');
    }

    try {
      const systemPrompt = this.buildSystemPrompt(request);
      const userPrompt = this.buildUserPrompt(request);
      const supabase = createSupabaseAdminClient();

      const { json: data } = await withTenantWalletSpend(
        supabase,
        tenantId ?? null,
        {
          estimatedTokens: estimatePromptTokens(systemPrompt.length + userPrompt.length),
          provider: isGoogleAIConfigured() ? 'google_ai' : 'openrouter',
          model: isGoogleAIConfigured() ? getGoogleAIModel() : undefined,
          requestId: `template:${tenantId ?? 'preview'}:${Date.now()}`,
          description: 'AI template generation',
          metadata: {
            category: request.category,
            vertical: request.vertical,
            language: request.language,
            tone: request.tone,
          },
        },
        () => callOpenRouter(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          undefined,
          2
        )
      );
      const content = (data as LLMChatCompletionResponse | null | undefined)?.choices?.[0]?.message?.content
        ?? (data as LLMChatCompletionResponse | null | undefined)?.choices?.[0]?.text;

      if (!content) {
        throw new Error('No content returned from AI');
      }

      // Track usage
      if (tenantId && userId) {
        const usage = data.usage;
        const inputTokens = usage?.prompt_tokens || 200;
        const outputTokens = usage?.completion_tokens || 300;
        const costUsd = 0; // Free model — no cost
        const activeModel = isGoogleAIConfigured() ? getGoogleAIModel() : 'free-model';
        const activeProvider = isGoogleAIConfigured() ? 'google_ai' as const : 'openrouter' as const;

        await recordLLMUsage(
          tenantId,
          userId,
          activeProvider,
          activeModel,
          'template_generation',
          inputTokens,
          outputTokens,
          costUsd,
          {
            category: request.category,
            vertical: request.vertical,
            language: request.language,
            tone: request.tone
          }
        );
      }

      // Parse the generated content
      const template = this.parseGeneratedContent(content, request);
      
      return template;

    } catch (error) {
      defaultLogger.error('AI template generation failed:', error);
      throw new Error('Failed to generate template with AI');
    }
  }

  /**
   * Build system prompt for template generation
   */
  private buildSystemPrompt(request: TemplateGenerationRequest): string {
    const { vertical, category, language, tone } = request;

    return `You are an expert template writer specializing in ${vertical} businesses. Create a ${category} message template with the following requirements:

BUSINESS CONTEXT:
- Industry: ${vertical}
- Message Type: ${category}
- Language: ${language}
- Tone: ${tone}

TEMPLATE REQUIREMENTS:
1. Use {{variable_name}} syntax for dynamic content
2. Include appropriate variables for the message type
3. Make it engaging and professional
4. ${request.includeEmojis ? 'Include relevant emojis' : 'No emojis'}
5. Length: ${request.length}

STANDARD VARIABLES TO INCLUDE:
- {{customer_name}} - Customer's name
- {{business_name}} - Business name
- {{appointment_date}} - Appointment date
- {{appointment_time}} - Appointment time
- {{service_name}} - Service/treatment name
- {{staff_name}} - Staff member name (optional)
- {{business_phone}} - Business phone number
- {{business_address}} - Business address

Return ONLY a valid JSON object with this structure:
{
  "name": "Template Name",
  "content": "Template content with {{variables}}",
  "description": "Brief description of when to use this template",
  "variables": [
    {
      "name": "variable_name",
      "type": "text|date|time|email|phone|number",
      "description": "What this variable represents",
      "required": true|false
    }
  ],
  "confidence": 0.95
}`;
  }

  /**
   * Build user prompt with specific requirements
   */
  /** Strip prompt-injection patterns and enforce a max length on user-supplied strings */
  private sanitizeUserInput(input: string, maxLength = 500): string {
    return input
      .slice(0, maxLength)
      // Remove sequences that attempt to override system instructions
      .replace(/ignore\s+(previous|above|all)\s+instructions?/gi, '')
      .replace(/system\s*:/gi, '')
      .replace(/\[INST\]|\[\/INST\]|<\|im_start\|>|<\|im_end\|>/g, '');
  }

  private buildUserPrompt(request: TemplateGenerationRequest): string {
    let prompt = `Generate a ${request.category} template for a ${request.vertical} business.`;

    if (request.description) {
      prompt += `\n\nSpecific context: ${this.sanitizeUserInput(request.description)}`;
    }

    if (request.customRequirements) {
      prompt += `\n\nCustom requirements: ${this.sanitizeUserInput(request.customRequirements)}`;
    }

    // Add vertical-specific guidance
    switch (request.vertical) {
      case 'beauty':
        prompt += `\n\nThis is for a beauty/wellness business (salon, spa, etc.). Focus on relaxation, pampering, and personal care.`;
        break;
      case 'hospitality':
        prompt += `\n\nThis is for hospitality (hotel, restaurant, events). Focus on service excellence and memorable experiences.`;
        break;
      case 'medicine':
        prompt += `\n\nThis is for healthcare. Be professional, reassuring, and include any necessary compliance language. Avoid medical advice.`;
        break;
      case 'general':
        prompt += `\n\nThis is for general professional services. Keep it versatile and professional.`;
        break;
    }

    // Add category-specific guidance
    switch (request.category) {
      case 'confirmation':
        prompt += `\n\nConfirmation messages should be reassuring and include all key appointment details.`;
        break;
      case 'reminder':
        prompt += `\n\nReminder messages should be friendly but not pushy, with clear next steps.`;
        break;
      case 'cancellation':
        prompt += `\n\nCancellation messages should be understanding and encourage rebooking.`;
        break;
      case 'welcome':
        prompt += `\n\nWelcome messages should be warm and set expectations for the experience.`;
        break;
      case 'follow_up':
        prompt += `\n\nFollow-up messages should check satisfaction and encourage future bookings.`;
        break;
    }

    return prompt;
  }

  /**
   * Parse AI-generated content into template structure
   */
  private parseGeneratedContent(content: string, request: TemplateGenerationRequest): GeneratedTemplate {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in AI response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate required fields
      if (!parsed.name || !parsed.content || !parsed.description) {
        throw new Error('Missing required fields in AI response');
      }

      // Ensure variables array exists
      if (!Array.isArray(parsed.variables)) {
        parsed.variables = this.extractVariablesFromContent(parsed.content);
      }

      // Add confidence if not provided
      if (typeof parsed.confidence !== 'number') {
        parsed.confidence = 0.85; // Default confidence
      }

      return {
        name: parsed.name,
        content: parsed.content,
        description: parsed.description,
        variables: parsed.variables,
        confidence: Math.min(parsed.confidence, 0.95) // Cap confidence
      };

    } catch (error) {
      defaultLogger.error('Failed to parse AI-generated content:', error);
      
      // Fallback: create a basic template from the raw content
      return this.createFallbackTemplate(content, request);
    }
  }

  /**
   * Extract variables from template content
   */
  private extractVariablesFromContent(content: string) {
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const variables = new Set<string>();
    let match;

    while ((match = variablePattern.exec(content)) !== null) {
      variables.add(match[1].trim());
    }

    return Array.from(variables).map(name => ({
      name,
      type: this.guessVariableType(name),
      description: this.generateVariableDescription(name),
      required: this.isVariableRequired(name)
    }));
  }

  /**
   * Guess variable type based on name
   */
  private guessVariableType(name: string): 'text' | 'date' | 'time' | 'email' | 'phone' | 'number' {
    const lowerName = name.toLowerCase();
    
    if (lowerName.includes('date')) return 'date';
    if (lowerName.includes('time')) return 'time';
    if (lowerName.includes('email')) return 'email';
    if (lowerName.includes('phone')) return 'phone';
    if (lowerName.includes('number') || lowerName.includes('count') || lowerName.includes('id')) return 'number';
    
    return 'text';
  }

  /**
   * Generate description for variable
   */
  private generateVariableDescription(name: string): string {
    const descriptions: Record<string, string> = {
      customer_name: 'Customer\'s full name',
      business_name: 'Business name',
      appointment_date: 'Appointment date',
      appointment_time: 'Appointment time',
      service_name: 'Service or treatment name',
      staff_name: 'Staff member name',
      business_phone: 'Business contact number',
      business_address: 'Business address',
      booking_reference: 'Booking reference number',
      cancellation_link: 'Link to cancel appointment'
    };

    return descriptions[name] || `Value for ${name.replace(/_/g, ' ')}`;
  }

  /**
   * Check if variable is typically required
   */
  private isVariableRequired(name: string): boolean {
    const requiredVariables = [
      'customer_name',
      'business_name',
      'appointment_date',
      'appointment_time',
      'service_name'
    ];

    return requiredVariables.includes(name);
  }

  /**
   * Create fallback template when AI parsing fails
   */
  private createFallbackTemplate(content: string, request: TemplateGenerationRequest): GeneratedTemplate {
    const cleanContent = content.replace(/```/g, '').trim();
    
    return {
      name: `${request.category.charAt(0).toUpperCase() + request.category.slice(1)} Template`,
      content: cleanContent,
      description: `AI-generated ${request.category} template for ${request.vertical} business`,
      variables: this.extractVariablesFromContent(cleanContent),
      confidence: 0.7 // Lower confidence for fallback
    };
  }

  /**
   * Generate template suggestions based on vertical and category
   */
  async generateTemplateSuggestions(
    vertical: string,
    category: string,
    language: string = 'en'
  ): Promise<string[]> {
    const suggestions: Record<string, Record<string, string[]>> = {
      beauty: {
        confirmation: [
          'Spa appointment confirmation with relaxation focus',
          'Hair appointment confirmation with style details',
          'Nail service confirmation with treatment duration'
        ],
        reminder: [
          'Gentle spa reminder with preparation tips',
          'Hair appointment reminder with style consultation note',
          'Beauty treatment reminder with aftercare information'
        ]
      },
      hospitality: {
        confirmation: [
          'Hotel reservation confirmation with amenities',
          'Restaurant booking confirmation with menu highlights',
          'Event space confirmation with setup details'
        ],
        reminder: [
          'Hotel check-in reminder with arrival instructions',
          'Restaurant reminder with special occasion note',
          'Event reminder with parking and access information'
        ]
      },
      medicine: {
        confirmation: [
          'Medical appointment confirmation with preparation instructions',
          'Consultation confirmation with required documents',
          'Treatment confirmation with insurance information'
        ],
        reminder: [
          'Appointment reminder with health questionnaire',
          'Medical reminder with fasting or preparation requirements',
          'Follow-up reminder with results discussion note'
        ]
      }
    };

    return suggestions[vertical]?.[category] || [
      `${category} template for ${vertical} business`,
      `Professional ${category} message with business details`,
      `Customer-focused ${category} communication`
    ];
  }
}

// Export singleton instance
export const aiTemplateGenerator = new AITemplateGenerator();

// Convenience function
export async function generateAITemplate(
  request: TemplateGenerationRequest,
  tenantId?: string,
  userId?: string
): Promise<GeneratedTemplate> {
  return await aiTemplateGenerator.generateTemplate(request, tenantId, userId);
}

export async function getTemplateSuggestions(
  vertical: string,
  category: string,
  language?: string
): Promise<string[]> {
  return await aiTemplateGenerator.generateTemplateSuggestions(vertical, category, language);
}
