"use client";
import React, { useState } from 'react';
import type { BookingEvent } from '../Calendar';
import { bookingCreateSchema } from '@/lib/validation';

export interface ComposerContext {
  prefill?: Partial<BookingEvent>;
  customerId?: string;
  tenantId: string;
  locationId?: string;
}
export interface BookingComposerProps {
  context: ComposerContext;
  onComplete: (booking: BookingEvent) => void;
  onCancel?: () => void;
  uiConfig?: { primaryColor?: string; compact?: boolean };
}

const steps = [
  'customer', // confirm or enter customer name
  'service',  // service selection
  'staff',    // staff selection (optional)
  'datetime', // start/end or duration
  'confirm'   // final confirmation
] as const;

type Step = typeof steps[number];

export const BookingComposer: React.FC<BookingComposerProps> = ({ context, onComplete, onCancel, uiConfig }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [serviceId, setServiceId] = useState(context.prefill?.serviceId || '');
  const [staffId, setStaffId] = useState(context.prefill?.staffId || '');
  const [customerName, setCustomerName] = useState(context.prefill?.customer?.name || '');
  const [start, setStart] = useState(context.prefill?.start || '');
  const [end, setEnd] = useState(context.prefill?.end || '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[stepIndex];

  function next() { if (stepIndex < steps.length - 1) setStepIndex(i => i + 1); }
  function prev() { if (stepIndex > 0) setStepIndex(i => i - 1); }

  async function finalize() {
    setPending(true); setError(null);
    try {
      // Validate fields
      const payload = {
        customerId: context.customerId,
        customerName,
        serviceId,
        staffId,
        start,
        end,
        metadata: { tenantId: context.tenantId, locationId: context.locationId }
      };
      const parsed = bookingCreateSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message || 'Invalid input');
      }
      // Call consolidated bookings endpoint
      const endpoint = `/api/bookings`;
      const body = {
        tenant_id: context.tenantId,
        customer_name: customerName,
        service_id: serviceId,
        staff_id: staffId || null,
        start_at: new Date(start).toISOString(),
        end_at: new Date(end).toISOString(),
      };
      const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!resp.ok) {
        if (resp.status === 409) throw new Error('Conflict: overlapping booking');
        throw new Error('Failed to create booking');
      }
      const data = await resp.json().catch(()=>({}));
      const booking: BookingEvent = {
        id: data.id || `temp_${Date.now()}`,
        start: body.start_at,
        end: body.end_at,
        status: data.status || 'requested',
        serviceId,
        staffId: staffId || undefined,
        customer: { id: data.customer_id || context.customerId || 'cust_temp', name: customerName },
        metadata: { tenantId: context.tenantId, locationId: context.locationId }
      };
      onComplete(booking);
    } catch (e: any) {
      setError(e.message || 'Failed to create booking');
    } finally { setPending(false); }
  }

  const primary = uiConfig?.primaryColor || '#2563eb';

  return (
    <div className={`border rounded p-4 bg-white ${uiConfig?.compact ? 'text-sm' : ''}`} aria-label="booking-composer">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Booking Composer</h3>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
      <div className="mb-4 flex gap-1 flex-wrap" aria-label="composer-steps">
        {steps.map((s,i) => (
          <span key={s} className={`px-2 py-1 rounded text-xs ${i===stepIndex ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{s}</span>
        ))}
      </div>
      {error && <div className="mb-2 text-red-600 text-sm" role="alert">{error}</div>}
      {step === 'customer' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium">Customer Name
            <input value={customerName} onChange={e=>setCustomerName(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <button disabled={!customerName} onClick={next} style={{ background: primary }} className="px-3 py-1 text-white rounded">Next</button>
        </div>
      )}
      {step === 'service' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium">Service Id
            <input value={serviceId} onChange={e=>setServiceId(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <div className="flex gap-2">
            <button onClick={prev} className="px-3 py-1 border rounded">Back</button>
            <button disabled={!serviceId} onClick={next} style={{ background: primary }} className="px-3 py-1 text-white rounded">Next</button>
          </div>
        </div>
      )}
      {step === 'staff' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium">Staff Id (optional)
            <input value={staffId} onChange={e=>setStaffId(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <div className="flex gap-2">
            <button onClick={prev} className="px-3 py-1 border rounded">Back</button>
            <button onClick={next} style={{ background: primary }} className="px-3 py-1 text-white rounded">Next</button>
          </div>
        </div>
      )}
      {step === 'datetime' && (
        <div className="space-y-2">
          <label className="block text-xs font-medium">Start
            <input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <label className="block text-xs font-medium">End
            <input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} className="mt-1 w-full border rounded px-2 py-1" />
          </label>
          <div className="flex gap-2">
            <button onClick={prev} className="px-3 py-1 border rounded">Back</button>
            <button disabled={!start || !end} onClick={next} style={{ background: primary }} className="px-3 py-1 text-white rounded">Next</button>
          </div>
        </div>
      )}
      {step === 'confirm' && (
        <div className="space-y-3">
          <div className="text-xs bg-gray-50 p-2 rounded" aria-label="summary-box">
            <div><strong>Customer:</strong> {customerName}</div>
            <div><strong>Service:</strong> {serviceId}</div>
            <div><strong>Staff:</strong> {staffId || 'Unassigned'}</div>
            <div><strong>Start:</strong> {start || '—'}</div>
            <div><strong>End:</strong> {end || '—'}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={prev} className="px-3 py-1 border rounded">Back</button>
            <button disabled={pending} onClick={finalize} style={{ background: primary }} className="px-3 py-1 text-white rounded">{pending ? 'Creating…' : 'Create Booking'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookingComposer;
