import type { Intent } from './intentDetector';

export type TenantContext = {
  tenant_id: string;
  name?: string;
  industry?: string;
  tone_config?: Record<string, unknown>;
  faqs?: Array<{ question: string; answer: string }>;
};

export type PromptObject = {
  tenantContext: TenantContext;
  messages: string[]; // recent conversation messages (rolling context)
  intent?: Intent;
};

/**
 * Assemble a prompt object for the LLM. Keeps prompt composition logic in one place.
 * This function currently returns a structured object to be sent to LLM adapter.
 */
export function buildPrompt(tenantContext: TenantContext, recentMessages: string[], intent?: Intent): PromptObject {
  // Add top-3 FAQs if present
  const faqs = tenantContext.faqs || [];
  const topFaqs = faqs.slice(0, 3);

  return {
    tenantContext: {
      tenant_id: tenantContext.tenant_id,
      name: tenantContext.name,
      industry: tenantContext.industry,
      tone_config: tenantContext.tone_config,
      faqs: topFaqs
    },
    messages: recentMessages,
    intent
  };
}

export default buildPrompt;
