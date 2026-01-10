"use client";
import React from 'react';

export type CustomerRow = {
  id: number;
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  created_at?: string;
  totalBookings?: number;
  lastBookingAt?: string | null;
  status?: string;
};

export default function CustomerProfileCard({ customer, onEdit, onNewBooking, onMessage, lifetimeSpend, recent }: { customer: CustomerRow; onEdit?: (id: number) => void; onNewBooking?: (id: number) => void; onMessage?: (id: number) => void; lifetimeSpend?: number; recent?: Array<{ id: string; start_at?: string; status?: string; total?: number }> }) {
  const initials = (customer.name || String(customer.id))
    .split(' ')
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="w-[360px] max-w-[90vw]">
      <div className="flex items-center gap-3 mb-3">
        <div className="h-12 w-12 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-semibold">
          {initials}
        </div>
        <div>
          <div className="text-base font-semibold">{customer.name || 'Unnamed Client'}</div>
          <div className="text-[11px] text-gray-500">ID: {customer.id}</div>
          {customer.status && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] ml-1 mt-1 ${customer.status === 'vip' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-700'}`}>{customer.status.toUpperCase()}</span>
          )}
        </div>
      </div>

      <div className="space-y-2 text-sm">
        {customer.phone && (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Phone</span>
            <span className="font-medium">{customer.phone}</span>
          </div>
        )}
        {customer.email && (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Email</span>
            <span className="font-medium">{customer.email}</span>
          </div>
        )}
        {customer.notes && (
          <div>
            <div className="text-gray-600 mb-1">Notes</div>
            <div className="text-gray-800 text-[13px] whitespace-pre-wrap">{customer.notes}</div>
          </div>
        )}
        {customer.created_at && (
          <div className="text-[11px] text-gray-500">Joined {new Date(customer.created_at).toLocaleDateString()}</div>
        )}
        {(customer.totalBookings != null) && (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Total bookings</span>
            <span className="font-medium">{customer.totalBookings}</span>
          </div>
        )}
        {customer.lastBookingAt && (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Last booking</span>
            <span className="font-medium">{new Date(customer.lastBookingAt).toLocaleString()}</span>
          </div>
        )}
        {typeof lifetimeSpend === 'number' && (
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Lifetime spend</span>
            <span className="font-medium">₦{(lifetimeSpend || 0).toLocaleString()}</span>
          </div>
        )}
        {recent && recent.length > 0 && (
          <div className="pt-2">
            <div className="text-gray-600 mb-1">Recent bookings</div>
            <ul className="space-y-1 text-[13px]">
              {recent.map(r => (
                <li key={r.id} className="flex items-center justify-between">
                  <span>#{String(r.id).slice(0,6)} · {r.status || 'pending'}</span>
                  <span>{r.start_at ? new Date(r.start_at).toLocaleDateString() : ''} · ₦{(r.total || 0).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          className="px-3 py-1.5 text-xs rounded border bg-white hover:bg-gray-50"
          onClick={() => onEdit?.(customer.id)}
        >Edit</button>
        <button className="px-3 py-1.5 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => onNewBooking?.(customer.id)}>New Booking</button>
        <button className="px-3 py-1.5 text-xs rounded border bg-white hover:bg-gray-50" onClick={() => onMessage?.(customer.id)}>Message</button>
      </div>
    </div>
  );
}
