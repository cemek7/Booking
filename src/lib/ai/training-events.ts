import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function recordAITrainingEvent(input: {
  tenantId: string;
  messageId?: string;
  channel?: string;
  userRole?: string;
  message: string;
  intent?: string | null;
  groundedContext?: unknown;
  llmResponse?: unknown;
  backendAction?: string | null;
  success?: boolean | null;
  correction?: string | null;
}): Promise<void> {
  try {
    await supabaseAdmin
      .from('ai_training_events')
      .insert({
        tenant_id: input.tenantId,
        message_id: input.messageId ?? null,
        channel: input.channel ?? null,
        user_role: input.userRole ?? null,
        message: input.message,
        intent: input.intent ?? null,
        grounded_context: input.groundedContext ?? null,
        llm_response: input.llmResponse ?? null,
        backend_action: input.backendAction ?? null,
        success: input.success ?? null,
        correction: input.correction ?? null,
      });
  } catch {
    // best effort only; AI path should not fail because observability storage failed
  }
}
