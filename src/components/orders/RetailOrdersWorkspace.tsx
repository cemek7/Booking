'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authGet, authPatch, authPost } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type RetailOrderStatus = 'draft' | 'pending_payment' | 'paid' | 'cancelled' | 'fulfilled';
type RetailPaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded';
type RetailFulfillmentStatus = 'unfulfilled' | 'preparing' | 'fulfilled' | 'cancelled';

type RetailOrderRow = {
  id: string;
  source_chat_id?: string | null;
  external_customer_ref?: string | null;
  status: RetailOrderStatus;
  payment_status: RetailPaymentStatus;
  fulfillment_status: RetailFulfillmentStatus;
  currency: string;
  total_cents: number;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  customer?: { name?: string | null; email?: string | null; phone?: string | null } | null;
  items?: Array<{
    id: string;
    quantity: number;
    unit_price_cents: number;
    total_price_cents: number;
    product?: { name?: string | null; category?: string | null; sku?: string | null } | null;
    variant?: { name?: string | null; sku?: string | null } | null;
  }>;
};

function money(cents?: number | null, currency = 'NGN') {
  const amount = Math.max(0, Number(cents ?? 0)) / 100;
  if (currency.toUpperCase() === 'NGN') {
    return `₦${Math.round(amount).toLocaleString()}`;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
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

function toneForStatus(status: string) {
  switch (status) {
    case 'paid':
    case 'fulfilled':
      return 'default';
    case 'pending_payment':
    case 'pending':
    case 'preparing':
      return 'secondary';
    case 'cancelled':
    case 'failed':
    case 'refunded':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function RetailOrdersWorkspace() {
  const [orders, setOrders] = useState<RetailOrderRow[]>([]);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [activeOrder, setActiveOrder] = useState<RetailOrderRow | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RetailOrderStatus>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | RetailPaymentStatus>('all');
  const [fulfillmentFilter, setFulfillmentFilter] = useState<'all' | RetailFulfillmentStatus>('all');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (paymentFilter !== 'all') params.set('payment_status', paymentFilter);
    if (fulfillmentFilter !== 'all') params.set('fulfillment_status', fulfillmentFilter);
    params.set('limit', '100');

    try {
      const response = await authGet<{ data: RetailOrderRow[] }>(`/api/retail/orders?${params.toString()}`);
      if (response.error) throw new Error(response.error.message);
      const nextOrders = response.data?.data ?? [];
      setOrders(nextOrders);
      setActiveOrderId((current) => (current && nextOrders.some((order) => order.id === current) ? current : nextOrders[0]?.id ?? null));
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : 'Failed to load retail orders');
    } finally {
      setLoading(false);
    }
  }, [fulfillmentFilter, paymentFilter, statusFilter]);

  const loadOrder = useCallback(async (orderId: string | null) => {
    if (!orderId) {
      setActiveOrder(null);
      return;
    }

    setDetailLoading(true);
    setError(null);
    try {
      const response = await authGet<{ data: RetailOrderRow }>(`/api/retail/orders/${orderId}`);
      if (response.error) throw new Error(response.error.message);
      setActiveOrder(response.data?.data ?? null);
    } catch (err) {
      setActiveOrder(null);
      setError(err instanceof Error ? err.message : 'Failed to load retail order');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  useEffect(() => {
    void loadOrder(activeOrderId);
  }, [activeOrderId, loadOrder]);

  const paymentLink = useMemo(() => {
    const payment = activeOrder?.metadata && typeof activeOrder.metadata === 'object'
      ? (activeOrder.metadata as Record<string, unknown>).payment
      : null;
    return payment && typeof payment === 'object' && typeof (payment as Record<string, unknown>).url === 'string'
      ? ((payment as Record<string, unknown>).url as string)
      : null;
  }, [activeOrder]);

  const runAction = useCallback(async (action: 'mark_paid' | 'mark_pending_payment' | 'mark_preparing' | 'mark_fulfilled' | 'mark_cancelled' | 'mark_refunded') => {
    if (!activeOrderId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPatch<{ data: RetailOrderRow }>(`/api/retail/orders/${activeOrderId}`, { action });
      if (response.error) throw new Error(response.error.message);
      await refreshOrders();
      await loadOrder(activeOrderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update retail order');
    } finally {
      setSaving(false);
    }
  }, [activeOrderId, loadOrder, refreshOrders]);

  const generatePaymentLink = useCallback(async () => {
    if (!activeOrderId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await authPost<{ data: { paymentUrl: string } }>(`/api/retail/orders/${activeOrderId}/payment-link`);
      if (response.error) throw new Error(response.error.message);
      await refreshOrders();
      await loadOrder(activeOrderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate payment link');
    } finally {
      setSaving(false);
    }
  }, [activeOrderId, loadOrder, refreshOrders]);

  const copyPaymentLink = useCallback(async () => {
    if (!paymentLink) return;
    try {
      await navigator.clipboard.writeText(paymentLink);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy payment link');
    }
  }, [paymentLink]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Retail orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Turn AI-assisted product recommendations into draft orders, send payment links, and move paid orders into fulfillment without leaving Booka.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Card><CardHeader className="pb-2"><CardDescription>Total orders</CardDescription><CardTitle>{loading ? '—' : orders.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Draft</CardDescription><CardTitle>{orders.filter((order) => order.status === 'draft').length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Pending payment</CardDescription><CardTitle>{orders.filter((order) => order.status === 'pending_payment').length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Paid</CardDescription><CardTitle>{orders.filter((order) => order.payment_status === 'paid').length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Preparing</CardDescription><CardTitle>{orders.filter((order) => order.fulfillment_status === 'preparing').length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Fulfilled</CardDescription><CardTitle>{orders.filter((order) => order.fulfillment_status === 'fulfilled').length}</CardTitle></CardHeader></Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Order queue</CardTitle>
            <CardDescription>Filter and inspect linked retail orders.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-2">
              <select className="rounded border px-2 py-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RetailOrderStatus)}>
                <option value="all">All order statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_payment">Pending payment</option>
                <option value="paid">Paid</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select className="rounded border px-2 py-2 text-sm" value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value as 'all' | RetailPaymentStatus)}>
                <option value="all">All payment states</option>
                <option value="unpaid">Unpaid</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
                <option value="refunded">Refunded</option>
              </select>
              <select className="rounded border px-2 py-2 text-sm" value={fulfillmentFilter} onChange={(e) => setFulfillmentFilter(e.target.value as 'all' | RetailFulfillmentStatus)}>
                <option value="all">All fulfillment states</option>
                <option value="unfulfilled">Unfulfilled</option>
                <option value="preparing">Preparing</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="space-y-2">
              {orders.map((order) => (
                <button
                  key={order.id}
                  onClick={() => setActiveOrderId(order.id)}
                  className={`w-full rounded-lg border px-3 py-3 text-left transition ${order.id === activeOrderId ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {order.customer?.name || order.customer?.phone || order.external_customer_ref || 'Retail order'}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{money(order.total_cents, order.currency)}</div>
                    </div>
                    <Badge variant={toneForStatus(order.status)}>{order.status}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant={toneForStatus(order.payment_status)}>{order.payment_status}</Badge>
                    <Badge variant={toneForStatus(order.fulfillment_status)}>{order.fulfillment_status}</Badge>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-500">Updated {prettyDate(order.updated_at)}</div>
                </button>
              ))}
              {!loading && orders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                  No retail orders yet. Draft orders will appear here when product recommendations are accepted in chat.
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b">
            <CardTitle className="text-base">Order detail</CardTitle>
            <CardDescription>Generate payment links and drive the order into payment and fulfillment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-6">
            {error ? <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            {detailLoading ? <div className="text-sm text-slate-500">Loading retail order…</div> : null}
            {!detailLoading && !activeOrder ? <div className="text-sm text-slate-500">Select a retail order to inspect it.</div> : null}
            {activeOrder ? (
              <>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {activeOrder.customer?.name || activeOrder.customer?.phone || activeOrder.external_customer_ref || activeOrder.id}
                    </h2>
                    <div className="mt-1 text-sm text-slate-500">
                      {activeOrder.customer?.email || activeOrder.customer?.phone || activeOrder.external_customer_ref || 'No contact email yet'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant={toneForStatus(activeOrder.status)}>{activeOrder.status}</Badge>
                      <Badge variant={toneForStatus(activeOrder.payment_status)}>{activeOrder.payment_status}</Badge>
                      <Badge variant={toneForStatus(activeOrder.fulfillment_status)}>{activeOrder.fulfillment_status}</Badge>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Order total</div>
                    <div className="text-2xl font-semibold text-slate-900">{money(activeOrder.total_cents, activeOrder.currency)}</div>
                    <div className="mt-1 text-xs text-slate-500">Updated {prettyDate(activeOrder.updated_at)}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Payment link</div>
                    <div className="mt-2 break-all text-sm text-slate-700">{paymentLink || 'No payment link generated yet.'}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => void generatePaymentLink()} disabled={saving || activeOrder.payment_status === 'paid'}>
                        Generate payment link
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void copyPaymentLink()} disabled={!paymentLink}>
                        Copy link
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Workflow</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void runAction('mark_pending_payment')} disabled={saving || activeOrder.payment_status === 'paid'}>
                        Pending payment
                      </Button>
                      <Button size="sm" onClick={() => void runAction('mark_paid')} disabled={saving || activeOrder.payment_status === 'paid'}>
                        Mark paid
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runAction('mark_preparing')} disabled={saving || activeOrder.payment_status !== 'paid'}>
                        Mark preparing
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runAction('mark_fulfilled')} disabled={saving || activeOrder.payment_status !== 'paid'}>
                        Mark fulfilled
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void runAction('mark_cancelled')} disabled={saving || activeOrder.payment_status === 'paid'}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="bg-red-600 text-white hover:bg-red-700"
                        onClick={() => void runAction('mark_refunded')}
                        disabled={saving || activeOrder.payment_status !== 'paid'}
                      >
                        Refund
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <div className="text-sm font-medium text-slate-900">Items</div>
                  <div className="mt-3 space-y-2">
                    {(activeOrder.items ?? []).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded border border-slate-200 px-3 py-2">
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {item.product?.name || 'Product'}
                            {item.variant?.name ? ` · ${item.variant.name}` : ''}
                          </div>
                          <div className="text-xs text-slate-500">
                            Qty {item.quantity}
                            {item.product?.sku ? ` · SKU ${item.product.sku}` : ''}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-slate-900">{money(item.total_price_cents, activeOrder.currency)}</div>
                      </div>
                    ))}
                    {(activeOrder.items ?? []).length === 0 ? (
                      <div className="text-sm text-slate-500">No order items recorded.</div>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Chat / customer context</div>
                    <div className="mt-2 text-sm text-slate-700">
                      <div>Source chat: {activeOrder.source_chat_id || '—'}</div>
                      <div>External ref: {activeOrder.external_customer_ref || '—'}</div>
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Notes</div>
                    <div className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{activeOrder.notes || 'No notes yet.'}</div>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
