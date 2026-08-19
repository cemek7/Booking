import { Role } from './index';

export type LlmContextMessage = {
  id: string;
  role?: string | null;
  content: string | null;
  created_at?: string | null;
};

export type TenantLlmSettings = {
  id: string;
  name?: string | null;
  industry?: string | null;
  tone_config?: Record<string, unknown> | null;
  preferred_llm_model?: string | null;
  llm_token_rate?: number | null;
  preferred_language?: string | null;
  business_hours?: Record<string, { open: string | null; close: string | null; closed: boolean }> | null;
  greeting?: string | null;
  signature?: string | null;
  capture_leads?: boolean;
  follow_up_delay_hours?: number;
};

export type RecentChat = {
  id: string;
  customer_id?: string | null;
  message?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LlmContext = {
  tenant: TenantLlmSettings | null;
  recentMessages: LlmContextMessage[];
  recentCalls?: Array<Record<string, unknown>>;
  faqs?: Array<{ question: string; answer: string }>;
  recentChat?: RecentChat | null;
  recentSummary?: string | null;
};

export type GetContextOpts = {
  limit?: number;
  customerMessage?: string;
  // server-side Supabase client instance
  supabaseClient?: import('@supabase/supabase-js').SupabaseClient | undefined;
};

export {};
