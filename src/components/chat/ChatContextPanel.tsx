'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { authGet } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ChatJourneyType } from '@/lib/chats/operations';

type LeadSummary = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  intent?: string | null;
  status?: string | null;
  stage?: string | null;
  follow_up_at?: string | null;
  qualified_at?: string | null;
  last_contacted_at?: string | null;
  notes?: string | null;
};

type RetailOrderSummary = {
  id: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  currency: string;
  total_cents: number;
  metadata?: Record<string, unknown> | null;
  items?: Array<{
    id: string;
    quantity: number;
    product?: { name?: string | null } | null;
    variant?: { name?: string | null } | null;
  }>;
};

interface ChatContextPanelProps {
  journeyType: ChatJourneyType;
  journeyStage?: string | null;
  leadId?: string | null;
  orderId?: string | null;
  cartItemCount?: number;
  orderTotalCents?: number | null;
}

function money(cents?: number | null, currency = 'NGN') {
  const amount = Math.max(0, Number(cents ?? 0)) / 100;
  if (currency.toUpperCase() === 'NGN') {
    return `₦${Math.round(amount).toLocaleString()}`;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

function prettyDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function ChatContextPanel(props: ChatContextPanelProps) {
  const [lead, setLead] = useState<LeadSummary | null>(null);
  const [order, setOrder] = useState<RetailOrderSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!props.leadId && !props.orderId) {
        setLead(null);
        setOrder(null);
        return;
      }

      setLoading(true);
      try {
        const [leadResponse, orderResponse] = await Promise.all([
          props.leadId ? authGet<{ data: LeadSummary }>(`/api/leads/${props.leadId}`) : Promise.resolve(null),
          props.orderId ? authGet<{ data: RetailOrderSummary }>(`/api/retail/orders/${props.orderId}`) : Promise.resolve(null),
        ]);

        if (cancelled) return;

        setLead(leadResponse?.data?.data ?? null);
        setOrder(orderResponse?.data?.data ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [props.leadId, props.orderId]);

  const paymentLink = useMemo(() => {
    const payment = order?.metadata && typeof order.metadata === 'object'
      ? (order.metadata as Record<string, unknown>).payment
      : null;
    return payment && typeof payment === 'object' && typeof (payment as Record<string, unknown>).url === 'string'
      ? ((payment as Record<string, unknown>).url as string)
      : null;
  }, [order]);

  return (
    <aside className="hidden xl:flex xl:w-[340px] xl:flex-col xl:border-l xl:bg-white">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">Linked context</div>
        <div className="mt-1 text-xs text-slate-500">
          {props.journeyStage ? `${props.journeyType} · ${props.journeyStage}` : props.journeyType}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {loading ? <div className="text-sm text-slate-500">Loading lead and order context…</div> : null}

        {lead ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Lead</div>
                <div className="mt-1 text-sm text-slate-700">{lead.name || lead.phone || lead.email || lead.id}</div>
              </div>
              <Badge variant="outline">{lead.status || 'new'}</Badge>
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              <div>Intent: {lead.intent || '—'}</div>
              <div>Stage: {lead.stage || '—'}</div>
              <div>Qualified: {prettyDate(lead.qualified_at)}</div>
              <div>Follow-up: {prettyDate(lead.follow_up_at)}</div>
            </div>
            {lead.notes ? <div className="mt-3 text-xs text-slate-600 whitespace-pre-wrap">{lead.notes}</div> : null}
            <div className="mt-3">
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/leads">Open leads workspace</Link>
              </Button>
            </div>
          </div>
        ) : null}

        {(order || props.orderId || props.journeyType === 'retail') ? (
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Retail order</div>
                <div className="mt-1 text-sm text-slate-700">
                  {order ? money(order.total_cents, order.currency) : props.orderTotalCents ? money(props.orderTotalCents) : 'Draft order'}
                </div>
              </div>
              {order ? <Badge variant="outline">{order.status}</Badge> : null}
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-500">
              <div>Payment: {order?.payment_status || 'not created yet'}</div>
              <div>Fulfillment: {order?.fulfillment_status || 'unfulfilled'}</div>
              <div>Items: {order?.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || props.cartItemCount || 0}</div>
            </div>
            {paymentLink ? (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 break-all">
                Payment link ready: {paymentLink}
              </div>
            ) : null}
            {order?.items?.length ? (
              <div className="mt-3 space-y-1 text-xs text-slate-600">
                {order.items.slice(0, 4).map((item) => (
                  <div key={item.id}>
                    {item.product?.name || 'Product'}
                    {item.variant?.name ? ` · ${item.variant.name}` : ''}
                    {` × ${item.quantity}`}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3">
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/orders">Open orders workspace</Link>
              </Button>
            </div>
          </div>
        ) : (
          !loading ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-sm text-slate-500">
              No linked lead or retail order yet for this conversation.
            </div>
          ) : null
        )}
      </div>
    </aside>
  );
}
