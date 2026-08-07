import { callGoogleAI } from '@/lib/google-ai';
import { callOpenRouter } from '@/lib/openrouter';
import { callCloudflareAI, getCloudflareAIModel, isCloudflareAIConfigured } from '@/lib/cloudflare-ai';

export interface PromptInput {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model: string;
}

export interface PromptOutput {
  json: unknown;
  usage: unknown;
}

export interface AIProvider {
  complete(input: PromptInput): Promise<PromptOutput>;
}

export function getAIProvider(input: {
  mode?: string;
  openRouterModel?: string;
  openRouterFallbackModels?: string[];
  cloudflareModel?: string;
  cloudflareFallbackModels?: string[];
  disableGoogle?: boolean;
} = {}): AIProvider {
  const normalized = (input.mode ?? 'auto').toLowerCase();
  const openRouterModel = input.openRouterModel;
  const openRouterFallbackModels = input.openRouterFallbackModels ?? [];
  const cloudflareModel = input.cloudflareModel;
  const cloudflareFallbackModels = input.cloudflareFallbackModels ?? [];
  const disableGoogle = input.disableGoogle === true;

  if (normalized === 'google' && !disableGoogle) {
    return {
      complete: async ({ messages, model }) => callGoogleAI(messages, model),
    };
  }

  if (normalized === 'openrouter') {
    return {
      complete: async ({ messages, model }) => callOpenRouterWithChain(
        messages,
        dedupeModels([openRouterModel, model, ...openRouterFallbackModels])
      ),
    };
  }

  if (normalized === 'cloudflare') {
    return {
      complete: async ({ messages, model }) => callCloudflareWithChain(
        messages,
        dedupeModels([cloudflareModel, model, ...cloudflareFallbackModels])
      ),
    };
  }

  if (disableGoogle && normalized !== 'auto') {
    throw new Error(`Unsupported AI provider mode: ${input.mode}`);
  }

  return {
    complete: async ({ messages, model }) => {
      // Prefer Workers AI in auto mode when it is configured, then retain
      // OpenRouter and Google AI as independent fallbacks.
      if (isCloudflareAIConfigured()) {
        try {
          return await callCloudflareWithChain(
            messages,
            dedupeModels([cloudflareModel, getCloudflareAIModel(), ...cloudflareFallbackModels])
          );
        } catch (error) {
          if (!process.env.OPENROUTER_API_KEY && (disableGoogle || !process.env.GOOGLE_AI_API_KEY)) throw error;
        }
      }

      if (process.env.OPENROUTER_API_KEY) {
        try {
          return await callOpenRouterWithChain(
            messages,
            dedupeModels([openRouterModel, model, ...openRouterFallbackModels])
          );
        } catch (error) {
          if (disableGoogle || !process.env.GOOGLE_AI_API_KEY) throw error;
        }
      }

      if (disableGoogle) throw new Error('No configured AI provider available');
      try {
        return await callGoogleAI(messages, model);
      } catch (error) {
        if (!process.env.OPENROUTER_API_KEY) throw error;
        return callOpenRouterWithChain(
          messages,
          dedupeModels([openRouterModel, model, ...openRouterFallbackModels])
        );
      }
    },
  };
}

async function callCloudflareWithChain(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  models: string[]
): Promise<PromptOutput> {
  let lastError: unknown = null;

  for (const model of models) {
    try {
      return await callCloudflareAI(messages, model, 1);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No Cloudflare AI model available');
}

async function callOpenRouterWithChain(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  models: string[]
): Promise<PromptOutput> {
  let lastError: unknown = null;

  for (const model of models) {
    try {
      return await callOpenRouter(messages, model, 1);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No OpenRouter model available');
}

function dedupeModels(models: Array<string | undefined>): string[] {
  return models
    .map((model) => model?.trim())
    .filter((model): model is string => Boolean(model))
    .filter((model, index, items) => items.indexOf(model) === index);
}
