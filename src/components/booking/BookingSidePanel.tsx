"use client";
import React from 'react';
import type { BookingEvent } from '../Calendar';
import { ChatThread } from '../chat/ChatThread';
import { ChatComposer } from '../chat/ChatComposer';
import { useBookingActions } from '@/hooks/useBookingActions';
import { useMessages, useSendMessage } from '@/hooks/useMessages';
import { useState, useEffect } from 'react';

export interface BookingSidePanelProps {
  booking: BookingEvent;
  onClose: () => void;
  onUpdate: (patch: Partial<BookingEvent>) => Promise<void>;
  onAction?: (action: 'confirm'|'cancel'|'reschedule'|'mark_paid', payload?: any) => Promise<void>;
  locationId?: string;
}

export const BookingSidePanel: React.FC<BookingSidePanelProps> = ({ booking, onClose, onUpdate, onAction, locationId }) => {
  const actions = useBookingActions(booking.id, locationId);
  const { data: messages, isLoading: messagesLoading, error: messagesError } = useMessages(booking.id);
  const sendMessage = useSendMessage(booking.id);
  const [pendingMessages, setPendingMessages] = useState<any[]>([]);

  // Clear pending if fresh server messages contain a matching text (basic heuristic)
  useEffect(() => {
    if (!messages || messages.length === 0 || pendingMessages.length === 0) return;
    setPendingMessages(pm => pm.filter(p => !messages.some(m => m.text === p.text && m.createdAt !== p.createdAt)));
  }, [messages, pendingMessages]);
  const runAction = async (a: 'confirm'|'cancel'|'reschedule'|'mark_paid') => {
    if (onAction) return onAction(a);
    return actions.mutateAsync({ action: a });
  };
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l shadow-lg flex flex-col" aria-label="booking-side-panel">
      <div className="p-4 flex items-center justify-between border-b">
        <h3 className="font-semibold">Booking {booking.id}</h3>
        <button onClick={onClose} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
      </div>
      <div className="p-4 space-y-2 text-xs overflow-y-auto flex-1" aria-label="booking-details">
        <div><strong>Status:</strong> {booking.status}</div>
        <div><strong>Customer:</strong> {booking.customer.name || booking.customer.id}</div>
        <div><strong>Service:</strong> {booking.serviceId}</div>
        <div><strong>Staff:</strong> {booking.staffId || 'Unassigned'}</div>
        <div><strong>Start:</strong> {booking.start}</div>
        <div><strong>End:</strong> {booking.end}</div>
      </div>
      <div className="p-3 border-t space-y-2" aria-label="booking-actions">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={()=>runAction('confirm')} disabled={actions.isPending} className="px-2 py-1 text-xs bg-green-600 text-white rounded disabled:opacity-50">Confirm</button>
          <button onClick={()=>runAction('cancel')} disabled={actions.isPending} className="px-2 py-1 text-xs bg-red-600 text-white rounded disabled:opacity-50">Cancel</button>
          <button onClick={()=>runAction('reschedule')} disabled={actions.isPending} className="px-2 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50">Reschedule</button>
          <button onClick={()=>runAction('mark_paid')} disabled={actions.isPending} className="px-2 py-1 text-xs bg-indigo-600 text-white rounded disabled:opacity-50">Mark Paid</button>
        </div>
        <div className="border rounded p-2 h-48 flex flex-col" aria-label="chat-section">
          <div className="flex-1 overflow-y-auto">
            {messagesLoading && <div className="text-xs text-gray-500">Loading chat…</div>}
            {messagesError && <div className="text-xs text-red-600">Failed to load messages.</div>}
            {!messagesLoading && !messagesError && (
              <ChatThread
                messages={[...(messages || []), ...pendingMessages]}
                bookingId={booking.id}
                onSend={async () => ({ id: `tmp_${Date.now()}`, bookingId: booking.id, direction: 'outbound', channel: 'app', text: '', status: 'pending', createdAt: new Date().toISOString() })}
              />
            )}
          </div>
          <div className="mt-2">
            <ChatComposer onSend={async (m) => {
              const optimistic = { id: `tmp_${Date.now()}`, bookingId: booking.id, direction: 'outbound', channel: 'app', text: m.text, status: 'pending', createdAt: new Date().toISOString() };
              setPendingMessages(p => [...p, optimistic]);
              try {
                await sendMessage.mutateAsync({ channel: 'app', text: m.text, attachments: m.attachments });
              } catch (err) {
                // Mark failed
                setPendingMessages(p => p.map(msg => msg.id === optimistic.id ? { ...msg, status: 'failed' } : msg));
              }
              return optimistic;
            }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookingSidePanel;
