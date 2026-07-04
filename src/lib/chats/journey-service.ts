import { createSupabaseAdminClient } from '@/lib/supabase/server';
import {
  getChatJourneyState,
  mergeChatJourneyState,
  type ChatJourneyState,
  type ChatMetadata,
} from '@/lib/chats/operations';

type ChatJourneyPatch = Partial<ChatJourneyState>;

export async function updateChatJourneyByExternalId(input: {
  tenantId: string;
  externalId: string;
  patch: ChatJourneyPatch;
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: chat } = await admin
    .from('chats')
    .select('id, metadata')
    .eq('tenant_id', input.tenantId)
    .eq('customer_phone', input.externalId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!chat?.id) return;

  const metadata = (chat.metadata ?? null) as ChatMetadata;
  const nextMetadata = mergeChatJourneyState(metadata, input.patch);

  await admin
    .from('chats')
    .update({ metadata: nextMetadata })
    .eq('id', chat.id)
    .eq('tenant_id', input.tenantId);
}

export async function clearChatJourneyIfMatches(input: {
  tenantId: string;
  externalId: string;
  type: ChatJourneyState['type'];
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: chat } = await admin
    .from('chats')
    .select('id, metadata')
    .eq('tenant_id', input.tenantId)
    .eq('customer_phone', input.externalId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!chat?.id) return;
  const metadata = (chat.metadata ?? null) as ChatMetadata;
  const current = getChatJourneyState(metadata);
  if (current.type !== input.type) return;

  const nextMetadata = mergeChatJourneyState(metadata, {
    type: 'general',
    stage: null,
    leadId: null,
    cartId: null,
    orderId: null,
    cartItemCount: 0,
    orderTotalCents: null,
  });

  await admin
    .from('chats')
    .update({ metadata: nextMetadata })
    .eq('id', chat.id)
    .eq('tenant_id', input.tenantId);
}
