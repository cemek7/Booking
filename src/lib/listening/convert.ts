import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConvertMentionInput {
  mentionId: string;
  tenantId: string;
  contact: {
    phone: string;
    name?: string;
    email?: string;
    notes?: string;
  };
}

export async function convertMentionToLead(
  admin: SupabaseClient,
  input: ConvertMentionInput
): Promise<void> {
  const phone = (input.contact.phone ?? '').trim();
  if (!phone) {
    throw new Error('phone is required to convert a mention to a lead');
  }

  const { error: insertError } = await admin.from('leads').insert({
    tenant_id: input.tenantId,
    name: input.contact.name ?? null,
    phone,
    email: input.contact.email ?? null,
    source: 'social',
    intent: 'inquiry',
    notes: input.contact.notes ?? null,
    status: 'new',
  });
  if (insertError) {
    throw insertError;
  }

  const { error: updateError } = await admin
    .from('social_mentions')
    .update({ status: 'converted' })
    .eq('id', input.mentionId)
    .eq('tenant_id', input.tenantId);
  if (updateError) {
    throw updateError;
  }
}
