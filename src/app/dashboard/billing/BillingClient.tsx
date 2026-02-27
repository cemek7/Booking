'use client';

import { useState } from 'react';

interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: 'paid' | 'pending' | 'failed';
  description: string;
}

const SAMPLE_INVOICES: Invoice[] = [
  { id: 'INV-001', date: '2025-02-01', amount: 9900, status: 'paid', description: 'Pro Plan — February 2025' },
  { id: 'INV-002', date: '2025-01-01', amount: 9900, status: 'paid', description: 'Pro Plan — January 2025' },
  { id: 'INV-003', date: '2024-12-01', amount: 9900, status: 'paid', description: 'Pro Plan — December 2024' },
];

const STATUS_COLORS = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-600',
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', maximumFractionDigits: 0,
  }).format(amount / 100);
}

export default function BillingClient() {
  const [activeTab, setActiveTab] = useState<'overview' | 'invoices' | 'payment'>('overview');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-gray-600 mt-1">Manage your subscription, invoices, and payment methods.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['overview', 'invoices', 'payment'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-indigo-600 border-b-2 border-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'payment' ? 'Payment Methods' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Current Plan</p>
                <h2 className="text-xl font-bold text-gray-900 mt-1">Pro</h2>
                <p className="text-sm text-gray-600 mt-1">₦9,900 / month · Renews March 1, 2025</p>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">Active</span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t text-center">
              <div>
                <p className="text-lg font-bold text-gray-900">∞</p>
                <p className="text-xs text-gray-500">Bookings</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">10</p>
                <p className="text-xs text-gray-500">Staff seats</p>
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">5</p>
                <p className="text-xs text-gray-500">Locations</p>
              </div>
            </div>
            <button className="mt-4 w-full py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">
              Upgrade Plan
            </button>
          </div>

          <div className="bg-white border rounded-xl p-5">
            <h3 className="font-semibold text-sm mb-3">This Month&apos;s Usage</h3>
            <div className="space-y-3">
              {[
                { label: 'Bookings', used: 34, limit: 'Unlimited' as const },
                { label: 'Staff seats', used: 3, limit: 10 },
                { label: 'SMS sent', used: 47, limit: 200 },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs text-gray-600 mb-1">
                    <span>{item.label}</span>
                    <span>{item.used} {typeof item.limit === 'number' ? `/ ${item.limit}` : `(${item.limit})`}</span>
                  </div>
                  {typeof item.limit === 'number' && (
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-indigo-500 h-1.5 rounded-full"
                        style={{ width: `${Math.min((item.used / item.limit) * 100, 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Invoices */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {SAMPLE_INVOICES.map((inv) => (
            <div key={inv.id} className="bg-white border rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{inv.description}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {inv.id} · {new Date(inv.date).toLocaleDateString('en-NG', { year: 'numeric', month: 'long', day: 'numeric' })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${STATUS_COLORS[inv.status]}`}>
                  {inv.status}
                </span>
                <span className="text-sm font-semibold text-gray-900">{formatCurrency(inv.amount)}</span>
                <button className="text-xs text-indigo-600 hover:underline">Download</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Payment methods */}
      {activeTab === 'payment' && (
        <div className="space-y-4">
          <div className="bg-white border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-7 bg-gray-100 rounded flex items-center justify-center text-xs font-bold text-gray-600">
              VISA
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">•••• •••• •••• 4242</p>
              <p className="text-xs text-gray-500">Expires 12/27</p>
            </div>
            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Default</span>
          </div>
          <button className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
            + Add payment method
          </button>
        </div>
      )}
    </div>
  );
}
