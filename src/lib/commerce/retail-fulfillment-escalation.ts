import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { setHumanHandlingUntilReleased } from '@/lib/whatsapp/v2/humanTakeover';
import {
  toSafeFulfillmentSummary,
  type RetailOrderFulfillmentContext,
} from './retail-fulfillment';

export type RetailFulfillmentEscalationReason =
  | 'fulfillment_not_configured'
  | 'delivery_fee_requires_human'
  | 'third_party_arrangement_required';

type RetailOrderEscalationRow = {
  id: string;
  tenantId: string;
  externalCustomerRef: string | null;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
};

type RetailEscalationThread = {
  id: string;
  channel: 'whatsapp' | 'instagram';
  humanHandlingMode: 'timed' | 'until_released' | null;
};

export type RetailFulfillmentEscalation = {
  id: string;
  status?: string;
};

export interface RetailFulfillmentEscalationStore {
  loadOrder(tenantId: string, orderId: string): Promise<RetailOrderEscalationRow | null>;
  loadThread(tenantId: string, threadId: string): Promise<RetailEscalationThread | null>;
  findExisting(tenantId: string, orderId: string): Promise<RetailFulfillmentEscalation | null>;
  insert(payload: Record<string, unknown>): Promise<RetailFulfillmentEscalation>;
  holdThreadUntilReleased(input: {
    tenantId: string;
    threadId: string;
    externalId: string;
    channel: 'whatsapp' | 'instagram';
  }): Promise<void>;
}

function defaultStore(): RetailFulfillmentEscalationStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadOrder(tenantId, orderId) {
      const { data, error } = await admin.from('retail_orders')
        .select('id, tenant_id, external_customer_ref, status, payment_status, fulfillment_status')
        .eq('tenant_id', tenantId)
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id),
        tenantId: String(data.tenant_id),
        externalCustomerRef: typeof data.external_customer_ref === 'string'
          ? data.external_customer_ref
          : null,
        status: String(data.status),
        paymentStatus: String(data.payment_status),
        fulfillmentStatus: String(data.fulfillment_status),
      };
    },
    async loadThread(tenantId, threadId) {
      const { data, error } = await admin.from('conversation_threads')
        .select('id, channel, human_handling_mode')
        .eq('tenant_id', tenantId)
        .eq('id', threadId)
        .maybeSingle();
      if (error) throw error;
      if (!data || (data.channel !== 'whatsapp' && data.channel !== 'instagram')) return null;
      return {
        id: String(data.id),
        channel: data.channel,
        humanHandlingMode: data.human_handling_mode === 'timed'
          || data.human_handling_mode === 'until_released'
          ? data.human_handling_mode
          : null,
      };
    },
    async findExisting(tenantId, orderId) {
      const { data, error } = await admin.from('escalation_queue')
        .select('id, status')
        .eq('tenant_id', tenantId)
        .eq('retail_order_id', orderId)
        .eq('reason_code', 'retail_fulfillment')
        .maybeSingle();
      if (error) throw error;
      return data as RetailFulfillmentEscalation | null;
    },
    async insert(payload) {
      const { data, error } = await admin.from('escalation_queue')
        .insert(payload)
        .select('id, status')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Retail fulfillment escalation was not created');
      return data as RetailFulfillmentEscalation;
    },
    async holdThreadUntilReleased(input) {
      await setHumanHandlingUntilReleased(input);
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

async function ensureThreadHold(
  store: RetailFulfillmentEscalationStore,
  input: {
    tenantId: string;
    externalId: string;
    thread: RetailEscalationThread | null;
  },
): Promise<void> {
  if (!input.thread || input.thread.humanHandlingMode === 'until_released') return;
  await store.holdThreadUntilReleased({
    tenantId: input.tenantId,
    threadId: input.thread.id,
    externalId: input.externalId,
    channel: input.thread.channel,
  });
}

export async function createRetailFulfillmentEscalation(
  input: {
    tenantId: string;
    orderId: string;
    reasonCode: RetailFulfillmentEscalationReason;
    context: RetailOrderFulfillmentContext;
  },
  store: RetailFulfillmentEscalationStore = defaultStore(),
): Promise<RetailFulfillmentEscalation> {
  const order = await store.loadOrder(input.tenantId, input.orderId);
  if (!order || order.id !== input.orderId || order.tenantId !== input.tenantId) {
    throw new Error('Retail order was not found in the tenant');
  }

  const threadId = input.context.conversationThreadId;
  const thread = threadId ? await store.loadThread(input.tenantId, threadId) : null;
  if (threadId && (!thread || thread.id !== threadId)) {
    throw new Error('Conversation thread was not found in the tenant');
  }

  const existing = await store.findExisting(input.tenantId, input.orderId);
  const externalId = order.externalCustomerRef ?? `retail-order:${order.id}`;
  if (existing) {
    await ensureThreadHold(store, { tenantId: input.tenantId, externalId, thread });
    return existing;
  }

  let escalation: RetailFulfillmentEscalation;
  try {
    escalation = await store.insert({
      tenant_id: input.tenantId,
      retail_order_id: input.orderId,
      reason_code: 'retail_fulfillment',
      customer_phone: externalId,
      session_id: `retail-order:${input.orderId}`,
      conversation_thread_id: thread?.id ?? null,
      reason: 'Delivery arrangement needs a teammate',
      status: 'pending',
      conversation_snapshot: {
        retailOrderId: order.id,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        fulfillment: toSafeFulfillmentSummary(input.context),
        reasonCode: input.reasonCode,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const replay = await store.findExisting(input.tenantId, input.orderId);
    if (!replay) throw error;
    await ensureThreadHold(store, { tenantId: input.tenantId, externalId, thread });
    return replay;
  }

  await ensureThreadHold(store, { tenantId: input.tenantId, externalId, thread });

  return escalation;
}
