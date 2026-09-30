import { z } from 'zod';

import { createSupabaseAdminClient } from '@/lib/supabase/server';
import { clearHumanHandling } from '@/lib/whatsapp/v2/humanTakeover';
import { createRetailOrderPaymentLink } from './retail-orders';
import {
  RetailFulfillmentMethodSchema,
  RetailFulfillmentProviderSchema,
  RetailOrderFulfillmentContextSchema,
  emptyRetailOrderFulfillmentContext,
  type RetailOrderFulfillmentContext,
} from './retail-fulfillment';

export const RetailFulfillmentConfirmationSchema = z.object({
  method: RetailFulfillmentMethodSchema,
  provider: RetailFulfillmentProviderSchema.nullable().optional(),
  deliveryFeeCents: z.number().int().min(0).max(100_000_000),
  note: z.string().trim().max(500).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.method === 'third_party_manual' && !value.provider) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'A delivery provider is required' });
  }
  if (value.method !== 'third_party_manual' && value.provider) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'Provider is only valid for third-party delivery' });
  }
  if (value.method === 'customer_pickup' && value.deliveryFeeCents !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deliveryFeeCents'], message: 'Customer pickup cannot have a delivery fee' });
  }
});

type ConfirmationOrder = {
  id: string;
  tenantId: string;
  externalCustomerRef: string | null;
  paymentStatus: string;
  subtotalCents: number;
  discountCents: number;
  metadata: Record<string, unknown>;
};

type ConfirmationThread = { id: string; channel: 'whatsapp' | 'instagram' };

export interface RetailFulfillmentConfirmationStore {
  loadOrder(tenantId: string, orderId: string): Promise<ConfirmationOrder | null>;
  updateOrder(input: {
    tenantId: string;
    orderId: string;
    deliveryFeeCents: number;
    totalCents: number;
    context: RetailOrderFulfillmentContext;
  }): Promise<void>;
  createOrReusePaymentLink(input: {
    tenantId: string;
    orderId: string;
    actorUserId: string;
  }): Promise<{ paymentUrl: string; reference: string; totalCents: number }>;
  resolveEscalation(tenantId: string, orderId: string): Promise<void>;
  loadThread(tenantId: string, threadId: string): Promise<ConfirmationThread | null>;
  releaseThread(input: {
    tenantId: string;
    threadId: string;
    externalId: string;
    channel: 'whatsapp' | 'instagram';
  }): Promise<void>;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function defaultStore(): RetailFulfillmentConfirmationStore {
  const admin = createSupabaseAdminClient();
  return {
    async loadOrder(tenantId, orderId) {
      const { data, error } = await admin.from('retail_orders')
        .select('id, tenant_id, external_customer_ref, payment_status, subtotal_cents, discount_cents, metadata')
        .eq('tenant_id', tenantId)
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id),
        tenantId: String(data.tenant_id),
        externalCustomerRef: typeof data.external_customer_ref === 'string' ? data.external_customer_ref : null,
        paymentStatus: String(data.payment_status),
        subtotalCents: Number(data.subtotal_cents ?? 0),
        discountCents: Number(data.discount_cents ?? 0),
        metadata: asObject(data.metadata),
      };
    },
    async updateOrder(input) {
      const order = await this.loadOrder(input.tenantId, input.orderId);
      if (!order) throw new Error('Retail order was not found in the tenant');
      const { error } = await admin.from('retail_orders').update({
        delivery_fee_cents: input.deliveryFeeCents,
        total_cents: input.totalCents,
        metadata: { ...order.metadata, retailFulfillment: input.context },
        updated_at: new Date().toISOString(),
      }).eq('tenant_id', input.tenantId).eq('id', input.orderId);
      if (error) throw error;
    },
    async createOrReusePaymentLink(input) {
      return createRetailOrderPaymentLink(input);
    },
    async resolveEscalation(tenantId, orderId) {
      const { error } = await admin.from('escalation_queue').update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
      }).eq('tenant_id', tenantId)
        .eq('retail_order_id', orderId)
        .eq('reason_code', 'retail_fulfillment')
        .in('status', ['pending', 'claimed']);
      if (error) throw error;
    },
    async loadThread(tenantId, threadId) {
      const { data, error } = await admin.from('conversation_threads')
        .select('id, channel')
        .eq('tenant_id', tenantId)
        .eq('id', threadId)
        .maybeSingle();
      if (error) throw error;
      if (!data || (data.channel !== 'whatsapp' && data.channel !== 'instagram')) return null;
      return { id: String(data.id), channel: data.channel };
    },
    async releaseThread(input) {
      await clearHumanHandling(input);
    },
  };
}

export async function confirmRetailOrderFulfillment(
  input: {
    tenantId: string;
    orderId: string;
    actorUserId: string;
    method: z.infer<typeof RetailFulfillmentMethodSchema>;
    provider: z.infer<typeof RetailFulfillmentProviderSchema> | null;
    deliveryFeeCents: number;
    note: string | null;
  },
  store: RetailFulfillmentConfirmationStore = defaultStore(),
) {
  const parsed = RetailFulfillmentConfirmationSchema.parse({
    method: input.method,
    provider: input.provider,
    deliveryFeeCents: input.deliveryFeeCents,
    note: input.note,
  });
  const order = await store.loadOrder(input.tenantId, input.orderId);
  if (!order || order.id !== input.orderId || order.tenantId !== input.tenantId) {
    throw new Error('Retail order was not found in the tenant');
  }

  const contextResult = RetailOrderFulfillmentContextSchema.safeParse(order.metadata.retailFulfillment);
  const currentContext = contextResult.success
    ? contextResult.data
    : emptyRetailOrderFulfillmentContext();
  if (parsed.method !== 'customer_pickup' && !currentContext.deliveryAddress) {
    throw new Error('A delivery address is required before confirming delivery');
  }
  const thread = currentContext.conversationThreadId
    ? await store.loadThread(input.tenantId, currentContext.conversationThreadId)
    : null;
  if (currentContext.conversationThreadId && (!thread || thread.id !== currentContext.conversationThreadId)) {
    throw new Error('Conversation thread was not found in the tenant');
  }

  const deliveryFeeCents = parsed.method === 'customer_pickup' ? 0 : parsed.deliveryFeeCents;
  const totalCents = Math.max(0, order.subtotalCents + deliveryFeeCents - order.discountCents);
  const context: RetailOrderFulfillmentContext = {
    ...currentContext,
    method: parsed.method,
    provider: parsed.method === 'third_party_manual' ? parsed.provider ?? null : null,
    feeStatus: parsed.method === 'customer_pickup' ? 'not_required' : 'confirmed',
    deliveryFeeCents,
    arrangementStatus: 'arranged',
    arrangementNote: parsed.note?.trim() || null,
  };

  await store.updateOrder({
    tenantId: input.tenantId,
    orderId: input.orderId,
    deliveryFeeCents,
    totalCents,
    context,
  });

  const payment = order.paymentStatus === 'paid'
    ? null
    : await store.createOrReusePaymentLink({
        tenantId: input.tenantId,
        orderId: input.orderId,
        actorUserId: input.actorUserId,
      });

  await store.resolveEscalation(input.tenantId, input.orderId);

  if (thread) {
    await store.releaseThread({
      tenantId: input.tenantId,
      threadId: thread.id,
      externalId: order.externalCustomerRef ?? `retail-order:${order.id}`,
      channel: thread.channel,
    });
  }

  return {
    orderId: order.id,
    totalCents,
    deliveryFeeCents,
    paymentUrl: payment?.paymentUrl ?? null,
    paymentReference: payment?.reference ?? null,
  };
}
