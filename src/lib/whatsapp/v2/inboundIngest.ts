import { randomUUID } from 'crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { ensureCustomerChannelIdentity } from '@/lib/customers/channelIdentity';
import { ensureConversation } from './conversationState';
import { ensureActiveThread } from './conversationThread';
import { resolveIncoming } from './identityResolver';
import { ingestConversationMessage } from './queueBatch';

export async function ingestCustomerInboundIfV2(input: {
  tenantId: string;
  provider: 'evolution' | 'waha' | 'meta';
  webhookExternalId: string;
  webhookPayload: unknown;
  fromNumber: string;
  toNumber: string;
  content: string;
  messageType: string;
  providerMessageId: string;
  providerTimestamp: string;
  raw: unknown;
  mediaInfo: unknown;
}): Promise<{ queueId: string; messageId: string } | null> {
  const admin = createSupabaseAdminClient();
  const { data: tenant, error } = await admin.from('tenants')
    .select('v2_enabled').eq('id', input.tenantId).maybeSingle();
  if (error) throw error;
  if (!tenant?.v2_enabled) return null;

  const identity = await resolveIncoming(
    'whatsapp', input.fromNumber, input.content, input.tenantId,
  );
  // Owner and staff operational commands remain on their established legacy
  // path until they receive a separate non-customer thread model.
  if (identity.role !== 'customer') return null;

  const customerIdentity = await ensureCustomerChannelIdentity({
    tenantId: input.tenantId,
    channel: 'whatsapp',
    externalId: input.fromNumber,
  });
  const conversation = await ensureConversation(
    input.fromNumber,
    input.tenantId,
    identity.role,
    'whatsapp',
    customerIdentity.customerId,
  );
  const thread = await ensureActiveThread({
    tenantId: input.tenantId,
    customerId: customerIdentity.customerId,
    channelIdentityId: customerIdentity.identityId,
    channel: 'whatsapp',
    conversationId: conversation.id,
  });
  const messageId = randomUUID();
  const queueId = await ingestConversationMessage({
    webhookProvider: input.provider,
    webhookExternalId: input.webhookExternalId,
    webhookPayload: input.webhookPayload,
    messageId,
    tenantId: input.tenantId,
    conversationId: conversation.id,
    threadId: thread.id,
    channel: 'whatsapp',
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
    content: identity.strippedMessage || input.content,
    messageType: input.messageType,
    providerMessageId: input.providerMessageId,
    providerTimestamp: input.providerTimestamp,
    raw: input.raw,
    mediaInfo: input.mediaInfo,
  });
  return { queueId, messageId };
}
