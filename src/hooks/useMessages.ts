"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import type { Message } from '@/components/chat/ChatThread';
import { messageSendSchema } from '@/lib/validation';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// Database row type for messages
interface MessageRow {
  id: string;
  booking_id: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  content: string | null;
  text: string | null;
  created_at: string;
}

async function fetchMessages(bookingId: string): Promise<Message[]> {
  const res = await fetch(`/api/bookings/${bookingId}/messages`);
  if (!res.ok) throw new Error('Failed messages fetch');
  const json = await res.json();
  return json.messages || [];
}

export function useMessages(bookingId: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['messages', bookingId], queryFn: () => fetchMessages(bookingId), enabled: !!bookingId });
  useEffect(() => {
    if (!bookingId) return;
    let channel: RealtimeChannel | null = null;
    try {
      const sb = getBrowserSupabase();
      if (sb?.channel) {
        channel = sb.channel(`public:messages:booking:${bookingId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` }, (payload: RealtimePostgresChangesPayload<MessageRow>) => {
            const newMsg = payload.new as MessageRow | null;
            if (newMsg) {
              qc.setQueryData<Message[]>(['messages', bookingId], (old) => {
                const arr = old || [];
                if (arr.some(m => m.id === newMsg.id)) return arr; // already present
                return [...arr, {
                  id: newMsg.id,
                  bookingId: newMsg.booking_id,
                  direction: newMsg.direction || 'inbound',
                  channel: newMsg.channel || 'app',
                  text: newMsg.content || newMsg.text || '',
                  status: 'sent',
                  createdAt: newMsg.created_at,
                }];
              });
            }
          })
          .subscribe();
      }
    } catch { /* ignore subscription errors */ }
    return () => { try { channel && getBrowserSupabase()?.removeChannel?.(channel); } catch { /* ignore */ } };
  }, [bookingId, qc]);
  return q;
}

interface Attachment {
  url: string;
  type: string;
  name?: string;
}

interface SendMessagePayload {
  channel: string;
  text: string;
  attachments?: Attachment[];
}

export function useSendMessage(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SendMessagePayload) => {
      const parsed = messageSendSchema.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid message');
      const res = await fetch(`/api/bookings/${bookingId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed send message');
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', bookingId] })
  });
}
