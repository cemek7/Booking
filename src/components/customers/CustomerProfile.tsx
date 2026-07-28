'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { useTenantCurrency } from '@/hooks/useTenantCurrency';

interface Reservation {
  id: string;
  start_at?: string;
  status?: string;
  total?: number;
  service_name?: string;
}

interface CustomerDetail {
  id: number;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  status?: string;
  created_at?: string;
  totalBookings?: number;
  lifetimeSpend?: number;
  lastBookingAt?: string | null;
  recent?: Reservation[];
}

interface CustomerProfileProps {
  customerId: number;
  onNewBooking?: (id: number) => void;
  onMessage?: (id: number) => void;
}

export default function CustomerProfile({ customerId, onNewBooking, onMessage }: CustomerProfileProps) {
  const headers = useAuthHeaders();
  const { format: formatMoney } = useTenantCurrency();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!headers) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?id=${customerId}`, { headers });
      if (!res.ok) throw new Error('Failed to load customer');
      const data = await res.json();
      setCustomer(data.customer ?? data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [headers, customerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-12 w-12 rounded-full bg-gray-200" />
        <div className="h-4 w-32 bg-gray-200 rounded" />
        <div className="h-4 w-48 bg-gray-200 rounded" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-6 text-sm text-red-600">
        {error ?? 'Customer not found'}
      </div>
    );
  }

  const initials = (customer.name || String(customer.id))
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const statusBadge = customer.status === 'vip'
    ? 'bg-yellow-100 text-yellow-800'
    : 'bg-gray-100 text-gray-600';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-lg font-bold">
          {initials}
        </div>
        <div>
          <div className="text-xl font-semibold">{customer.name || 'Unnamed Client'}</div>
          {customer.status && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${statusBadge}`}>
              {customer.status.toUpperCase()}
            </span>
          )}
        </div>
        <div className="ml-auto flex gap-2">
          {onNewBooking && (
            <button
              onClick={() => onNewBooking(customer.id)}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              New Booking
            </button>
          )}
          {onMessage && (
            <button
              onClick={() => onMessage(customer.id)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Message
            </button>
          )}
        </div>
      </div>

      {/* Contact Info */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
        {customer.phone && (
          <div className="flex justify-between">
            <span className="text-gray-500">Phone</span>
            <span className="font-medium">{customer.phone}</span>
          </div>
        )}
        {customer.email && (
          <div className="flex justify-between">
            <span className="text-gray-500">Email</span>
            <span className="font-medium">{customer.email}</span>
          </div>
        )}
        {customer.created_at && (
          <div className="flex justify-between">
            <span className="text-gray-500">Customer since</span>
            <span className="font-medium">{new Date(customer.created_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-indigo-600">{customer.totalBookings ?? 0}</div>
          <div className="text-xs text-gray-500 mt-1">Total Bookings</div>
        </div>
        <div className="bg-white border rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-green-600">
            ${(customer.lifetimeSpend ?? 0).toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 mt-1">Lifetime Spend</div>
        </div>
        <div className="bg-white border rounded-xl p-3 text-center">
          <div className="text-sm font-semibold text-gray-700">
            {customer.lastBookingAt
              ? new Date(customer.lastBookingAt).toLocaleDateString()
              : 'Never'}
          </div>
          <div className="text-xs text-gray-500 mt-1">Last Booking</div>
        </div>
      </div>

      {/* Notes */}
      {customer.notes && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Notes</div>
          <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{customer.notes}</p>
        </div>
      )}

      {/* Recent bookings */}
      {(customer.recent ?? []).length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent Bookings</div>
          <div className="space-y-2">
            {(customer.recent ?? []).map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-white border rounded-lg px-3 py-2">
                <div>
                  <div className="font-medium">{r.service_name || 'Booking'}</div>
                  {r.start_at && (
                    <div className="text-xs text-gray-400">{new Date(r.start_at).toLocaleString()}</div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {r.total != null && (
                    <span className="text-green-600 font-medium">{formatMoney(Number(r.total) || 0)}</span>
                  )}
                  {r.status && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.status === 'confirmed' ? 'bg-green-100 text-green-700'
                      : r.status === 'cancelled' ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>
                      {r.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
