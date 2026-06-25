import { callGoogleAI } from '@/lib/google-ai';
import { callOpenRouter } from '@/lib/openrouter';

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
  disableGoogle?: boolean;
} = {}): AIProvider {
  const normalized = (input.mode ?? 'auto').toLowerCase();
  const openRouterModel = input.openRouterModel;
  const openRouterFallbackModels = input.openRouterFallbackModels ?? [];
  const disableGoogle = input.disableGoogle === true;

  if (normalized === 'google' && !disableGoogle) {
    return {
      complete: async ({ messages, model }) => callGoogleAI(messages, model),
    };
  }

  if (normalized === 'openrouter' || disableGoogle) {
    return {
      complete: async ({ messages, model }) => callOpenRouterWithChain(
        messages,
        dedupeModels([openRouterModel, model, ...openRouterFallbackModels])
      ),
    };
  }

  return {
    complete: async ({ messages, model }) => {
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
