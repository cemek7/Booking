"use client";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getSupabaseBrowserClientAsync } from '@/lib/supabase/client';
import type { ChatMessage as Message } from '@/components/chat/ChatThread';
import { messageSendSchema } from '@/lib/validation';
import { authFetch } from '@/lib/auth/auth-api-client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

// Database row type for public.messages (keyed by reservation_id).
interface MessageRow {
  id: string;
  reservation_id: string;
  direction: 'inbound' | 'outbound' | null;
  content: string | null;
  chat_id: string | null;
  from_number: string | null;
  created_at: string;
}

// Map a raw messages row to the ChatThread ChatMessage shape.
function rowToChatMessage(row: MessageRow): Message {
  const inbound = (row.direction ?? 'inbound') === 'inbound';
  return {
    id: row.id,
    chatId: row.chat_id ?? '',
    author: row.from_number ?? (inbound ? 'Customer' : 'You'),
    role: inbound ? 'user' : 'assistant',
    content: row.content ?? '',
    createdAt: row.created_at,
  } as unknown as Message;
}

async function fetchMessages(bookingId: string): Promise<Message[]> {
  const res = await authFetch<{ messages: Message[] }>(`/api/bookings/${bookingId}/messages`);
  if (res.error) throw new Error(res.error.message || 'Failed messages fetch');
  return res.data?.messages || [];
}

export function useMessages(bookingId: string) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['messages', bookingId], queryFn: () => fetchMessages(bookingId), enabled: !!bookingId });
  useEffect(() => {
    if (!bookingId) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    // Sync client returns a realtime-less proxy under runtime config; use async.
    let activeSb: Awaited<ReturnType<typeof getSupabaseBrowserClientAsync>> | null = null;
    (async () => {
      try {
        const sb = await getSupabaseBrowserClientAsync();
        if (cancelled) return;
        activeSb = sb;
        channel = sb.channel(`public:messages:reservation:${bookingId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `reservation_id=eq.${bookingId}` }, (payload: RealtimePostgresChangesPayload<MessageRow>) => {
            const newMsg = payload.new as MessageRow | null;
            if (newMsg) {
              qc.setQueryData<Message[]>(['messages', bookingId], (old) => {
                const arr = old || [];
                if (arr.some(m => m.id === newMsg.id)) return arr; // already present
                return [...arr, rowToChatMessage(newMsg)];
              });
            }
          })
          .subscribe();
      } catch { /* ignore subscription errors */ }
    })();
    return () => { cancelled = true; try { channel && activeSb?.removeChannel?.(channel); } catch { /* ignore */ } };
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
      const res = await authFetch(`/api/bookings/${bookingId}/messages`, { method: 'POST', body: payload });
      if (res.error) throw new Error(res.error.message || 'Failed send message');
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['messages', bookingId] })
  });
}
