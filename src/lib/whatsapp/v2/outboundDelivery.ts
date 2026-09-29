import { createSupabaseAdminClient } from '@/lib/supabase/server';
import type { ProviderSendResult } from '@/lib/whatsapp/providers/types';
import type { ConvChannel } from './conversationState';

export type OutboundDeliveryStatus = 'pending' | 'sent' | 'failed' | 'delivery_unknown';

export interface OutboundDeliveryRow {
  id: string;
  tenantId: string;
  threadId: string;
  idempotencyKey: string;
  channel: ConvChannel;
  from: string;
  to: string;
  content: string;
  deliveryStatus: OutboundDeliveryStatus;
  providerMessageId: string | null;
  chatId?: string | null;
}

type OutboundIntent = Omit<OutboundDeliveryRow, 'id' | 'deliveryStatus' | 'providerMessageId'>;

export interface OutboundDeliveryStore {
  reserve(input: OutboundIntent): Promise<{ claimed: boolean; row: OutboundDeliveryRow }>;
  restartFailed(input: Pick<OutboundIntent, 'tenantId' | 'idempotencyKey'>): Promise<boolean>;
  update(input: Pick<OutboundIntent, 'tenantId' | 'idempotencyKey'> & {
    deliveryStatus: OutboundDeliveryStatus;
    providerMessageId?: string | null;
  }): Promise<void>;
}

export interface OutboundDeliveryResult {
  status: Exclude<OutboundDeliveryStatus, 'pending'>;
  providerMessageId?: string;
  reason?: string;
  replayed: boolean;
}

function mapRow(row: Record<string, unknown>): OutboundDeliveryRow {
  return {
    id: String(row.id ?? ''),
    tenantId: String(row.tenant_id ?? ''),
    threadId: String(row.conversation_thread_id ?? ''),
    idempotencyKey: String(row.idempotency_key ?? ''),
    channel: row.channel === 'instagram' ? 'instagram' : 'whatsapp',
    from: String(row.from_number ?? ''),
    to: String(row.to_number ?? ''),
    content: String(row.content ?? ''),
    deliveryStatus: row.delivery_status as OutboundDeliveryStatus,
    providerMessageId: typeof row.provider_message_id === 'string' ? row.provider_message_id : null,
    chatId: typeof row.chat_id === 'string' ? row.chat_id : null,
  };
}

function defaultStore(): OutboundDeliveryStore {
  const admin = createSupabaseAdminClient();
  const find = async (input: Pick<OutboundIntent, 'tenantId' | 'idempotencyKey'>) => {
    const { data, error } = await admin.from('messages').select('*')
      .eq('tenant_id', input.tenantId)
      .eq('idempotency_key', input.idempotencyKey)
      .single();
    if (error || !data) throw error ?? new Error('Outbound intent disappeared after reservation');
    return mapRow(data as Record<string, unknown>);
  };

  return {
    async reserve(input) {
      const { data, error } = await admin.from('messages').insert({
        tenant_id: input.tenantId,
        chat_id: input.chatId ?? null,
        conversation_thread_id: input.threadId,
        from_number: input.from,
        to_number: input.to,
        content: input.content,
        direction: 'outbound',
        message_type: 'text',
        channel: input.channel,
        delivery_status: 'pending',
        idempotency_key: input.idempotencyKey,
        timestamp: new Date().toISOString(),
      }).select('*').single();
      if (!error && data) return { claimed: true, row: mapRow(data as Record<string, unknown>) };
      if (error?.code !== '23505') throw error ?? new Error('Unable to persist outbound intent');
      return { claimed: false, row: await find(input) };
    },

    async restartFailed(input) {
      const { data, error } = await admin.from('messages').update({
        delivery_status: 'pending',
        provider_message_id: null,
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey)
        .eq('delivery_status', 'failed')
        .select('id')
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async update(input) {
      const { error } = await admin.from('messages').update({
        delivery_status: input.deliveryStatus,
        provider_message_id: input.providerMessageId ?? null,
        evolution_message_id: input.providerMessageId ?? null,
      }).eq('tenant_id', input.tenantId)
        .eq('idempotency_key', input.idempotencyKey);
      if (error) throw error;
    },
  };
}

export async function sendOutboundOnce(input: OutboundIntent & {
  send: () => Promise<ProviderSendResult>;
  store?: OutboundDeliveryStore;
}): Promise<OutboundDeliveryResult> {
  const store = input.store ?? defaultStore();
  const reservation = await store.reserve(input);

  if (!reservation.claimed) {
    if (
      reservation.row.threadId !== input.threadId
      || reservation.row.channel !== input.channel
      || reservation.row.to !== input.to
      || reservation.row.content !== input.content
    ) {
      throw new Error('Outbound delivery idempotency collision');
    }
    if (reservation.row.deliveryStatus === 'sent') {
      return {
        status: 'sent',
        providerMessageId: reservation.row.providerMessageId ?? undefined,
        replayed: true,
      };
    }
    if (reservation.row.deliveryStatus === 'pending' || reservation.row.deliveryStatus === 'delivery_unknown') {
      return { status: 'delivery_unknown', replayed: true };
    }
    if (!await store.restartFailed(input)) {
      return { status: 'delivery_unknown', replayed: true };
    }
  }

  let providerResult: ProviderSendResult;
  try {
    providerResult = await input.send();
  } catch (error) {
    await store.update({ ...input, deliveryStatus: 'delivery_unknown' });
    return {
      status: 'delivery_unknown',
      reason: error instanceof Error ? error.message : String(error),
      replayed: false,
    };
  }

  if (!providerResult.success) {
    if (providerResult.reason === 'wallet_exhausted') {
      // The metering wrapper has already sent its funded-by-Booka human-handoff
      // message. Treat that alternate response as the completed delivery so a
      // queue replay cannot emit it twice.
      await store.update({ ...input, deliveryStatus: 'sent' });
      return { status: 'sent', reason: providerResult.reason, replayed: false };
    }
    await store.update({ ...input, deliveryStatus: 'failed' });
    return { status: 'failed', reason: providerResult.reason, replayed: false };
  }

  await store.update({
    ...input,
    deliveryStatus: 'sent',
    providerMessageId: providerResult.messageId ?? null,
  });
  return {
    status: 'sent',
    providerMessageId: providerResult.messageId,
    replayed: false,
  };
}
