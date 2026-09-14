import type { SupabaseClient } from "@supabase/supabase-js";

export interface ConversationFlags {
  last_inbound_at: string | null;
  opted_out_at: string | null;
}

/**
 * The two fields every business-initiated send has to know before it sends:
 * when the customer last wrote in (the 24-hour window) and whether they opted
 * out. Missing conversation rows deliberately read as "never wrote in, not
 * opted out" so a first-contact send is gated by the window, not by an error.
 */
export async function loadConversationFlags(
  admin: SupabaseClient,
  tenantId: string,
  phone: string,
): Promise<ConversationFlags> {
  const { data } = await admin
    .from("whatsapp_conversations")
    .select("last_inbound_at, opted_out_at")
    .eq("tenant_id", tenantId)
    .eq("phone_number", phone)
    .maybeSingle();

  return {
    last_inbound_at:
      typeof data?.last_inbound_at === "string" ? data.last_inbound_at : null,
    opted_out_at:
      typeof data?.opted_out_at === "string" ? data.opted_out_at : null,
  };
}
