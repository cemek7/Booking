import type { Intent } from './intentDetector';

export type BusinessHoursDay = {
  open: string | null;
  close: string | null;
  closed: boolean;
};

export type TenantContext = {
  tenant_id: string;
  name?: string;
  industry?: string;
  tone_config?: Record<string, unknown>;
  faqs?: Array<{ question: string; answer: string }>;
  preferred_language?: string;
  business_hours?: Record<string, BusinessHoursDay>;
  greeting?: string;
  signature?: string;
  verticalPackage?: string;
  managedPromise?: string;
  outcomeTargets?: string[];
  escalationRules?: string[];
  operational_memory?: Record<string, unknown>;
  campaignDefaults?: Record<string, unknown>;
  billingModel?: string;
};

export type PromptObject = {
  tenantContext: TenantContext;
  messages: string[];
  intent?: Intent;
  systemPrompt?: string;
};

/**
 * Build the LLM system prompt string from tenant context fields.
 * Serialises tone_config, language preference, greeting and signature
 * into a readable preamble injected as the first message in every LLM call.
 */
export function buildSystemPrompt(tenantContext: TenantContext, opts?: { out_of_hours?: boolean }): string {
  const lines: string[] = [];
  const tc = tenantContext.tone_config ?? {};

  // Identity
  if (tenantContext.name) {
    lines.push(`You are the AI assistant for ${tenantContext.name}.`);
  }
  if (tenantContext.industry) {
    lines.push(`Industry: ${tenantContext.industry}.`);
  }

  // Greeting & signature
  const greeting = tenantContext.greeting ?? (tc['greeting'] as string | undefined);
  const signature = tenantContext.signature ?? (tc['signature'] as string | undefined);
  if (greeting) lines.push(`Opening greeting: "${greeting}"`);
  if (signature) lines.push(`Sign off with: "${signature}"`);
  if (tenantContext.verticalPackage) lines.push(`Vertical package: ${tenantContext.verticalPackage}.`);
  if (tenantContext.managedPromise) lines.push(`Managed promise: ${tenantContext.managedPromise}`);
  if (tenantContext.billingModel) lines.push(`Billing model: ${tenantContext.billingModel}`);
  if (tenantContext.outcomeTargets?.length) {
    lines.push(`Outcome targets: ${tenantContext.outcomeTargets.slice(0, 5).join(', ')}`);
  }
  if (tenantContext.escalationRules?.length) {
    lines.push(`Escalate these exceptions to humans: ${tenantContext.escalationRules.slice(0, 5).join(', ')}`);
  }
  if (tenantContext.operational_memory) {
    const memoryKeys = Object.keys(tenantContext.operational_memory);
    if (memoryKeys.length) {
      lines.push(`Operational memory keys available: ${memoryKeys.slice(0, 8).join(', ')}`);
    }
  }
  if (tenantContext.campaignDefaults) {
    lines.push(`Campaign defaults: ${JSON.stringify(tenantContext.campaignDefaults).slice(0, 220)}`);
  }

  // Tone & style
  const tone = tc['tone'] as string | undefined;
  const styleGuidelines = tc['styleGuidelines'] as string | undefined;
  const voiceParameters = tc['voiceParameters'] as Record<string, unknown> | undefined;
  const samplePhrases = tc['samplePhrases'] as string[] | undefined;

  if (tone) lines.push(`Tone: ${tone}.`);
  if (styleGuidelines) lines.push(`Style guidelines: ${styleGuidelines}`);
  if (voiceParameters && typeof voiceParameters === 'object') {
    const emojiPref = voiceParameters['emoji'];
    if (emojiPref === false || emojiPref === 'off') lines.push('Do not use emoji in responses.');
    else if (emojiPref === true || emojiPref === 'on') lines.push('You may use emoji naturally to match the brand voice.');
  }
  if (samplePhrases && samplePhrases.length > 0) {
    lines.push(`Sample phrases to emulate: ${samplePhrases.slice(0, 3).join(' | ')}`);
  }

  // Language
  if (tenantContext.preferred_language && tenantContext.preferred_language !== 'en') {
    lines.push(
      `Always respond in language code "${tenantContext.preferred_language}". ` +
      `If the user writes in a different language, still reply in that language unless the user insists.`
    );
  }

  // Out-of-hours instruction
  if (opts?.out_of_hours) {
    lines.push(
      'The customer has messaged outside of business hours. ' +
      'Craft a warm, personalised message that: ' +
      '(1) greets them by name if known, ' +
      '(2) acknowledges the time in a friendly way, ' +
      '(3) states when the team will be back, ' +
      '(4) offers to take their details so the team can follow up first thing. ' +
      'Adapt the warmth and emoji use to the configured tone above.'
    );
  }

  return lines.join('\n');
}

/**
 * Assemble a prompt object for the LLM. Keeps prompt composition logic in one place.
 */
export function buildPrompt(
  tenantContext: TenantContext,
  recentMessages: string[],
  intent?: Intent,
  opts?: { out_of_hours?: boolean }
): PromptObject {
  const faqs = tenantContext.faqs || [];
  const topFaqs = faqs.slice(0, 5);
  const systemPrompt = buildSystemPrompt(tenantContext, opts);

  return {
    tenantContext: {
      tenant_id: tenantContext.tenant_id,
      name: tenantContext.name,
      industry: tenantContext.industry,
      tone_config: tenantContext.tone_config,
      faqs: topFaqs,
      preferred_language: tenantContext.preferred_language,
      business_hours: tenantContext.business_hours,
      greeting: tenantContext.greeting,
      signature: tenantContext.signature,
      verticalPackage: tenantContext.verticalPackage,
      managedPromise: tenantContext.managedPromise,
      outcomeTargets: tenantContext.outcomeTargets,
      escalationRules: tenantContext.escalationRules,
      operational_memory: tenantContext.operational_memory,
      campaignDefaults: tenantContext.campaignDefaults,
      billingModel: tenantContext.billingModel,
    },
    messages: recentMessages,
    intent,
    systemPrompt,
  };
}

export default buildPrompt;
