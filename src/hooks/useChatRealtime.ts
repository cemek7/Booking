"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type ChatSummary = { id: string; subject: string; lastMessageAt?: string | null; unread?: number };
export type ChatMessage = { id: string; chatId: string; content: string; role: 'user'|'assistant'; createdAt: string };

// Database row types for type safety
interface ChatRow {
  id: string;
  last_message_at: string | null;
  session_id: string | null;
  customer_phone: string | null;
  metadata: { subject?: string } | null;
  unread_count?: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  content: string | null;
  direction: 'inbound' | 'outbound';
  created_at: string;
}

export function useChatRealtime(tenantId: string | null | undefined) {
  const supabase = getBrowserSupabase();
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const msgChannel = useRef<RealtimeChannel | null>(null);
  const chatChannel = useRef<RealtimeChannel | null>(null);

  const loadChats = useCallback(async () => {
    if (!tenantId) { setChats([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('id,last_message_at,session_id,customer_phone,metadata')
        .eq('tenant_id', tenantId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) throw error;
      const mapped: ChatSummary[] = ((data || []) as ChatRow[]).map((row) => ({
        id: row.id,
        lastMessageAt: row.last_message_at,
        subject: row.metadata?.subject || row.customer_phone || (row.session_id ? `Session ${row.session_id.slice(0,6)}` : `Chat ${String(row.id).slice(0,6)}`),
        unread: row.unread_count ?? 0,
      }));
      setChats(mapped.map(c => ({ ...c, unread: unreadMap[c.id] ?? c.unread ?? 0 })));
    } finally { setLoading(false); }
  }, [supabase, tenantId]);

  const loadMessages = useCallback(async (chatId: string | null) => {
    if (!chatId) { setMessages([]); return; }
    const { data, error } = await supabase
      .from('messages')
      .select('id,chat_id,content,direction,created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });
    if (error) return;
    const mapped: ChatMessage[] = ((data || []) as MessageRow[]).map((m) => ({
      id: m.id,
      chatId: m.chat_id,
      content: m.content || '',
      role: m.direction === 'outbound' ? 'user' : 'assistant',
      createdAt: m.created_at,
    }));
    setMessages(mapped);
  }, [supabase]);

  // Subscribe to chats list
  useEffect(() => {
    chatChannel.current?.unsubscribe();
    if (!tenantId) return;
    const ch = supabase.channel(`rt-chats-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats', filter: `tenant_id=eq.${tenantId}` }, (payload: RealtimePostgresChangesPayload<ChatRow>) => {
        const row = payload.new as ChatRow | null;
        if (!row) { loadChats(); return; }
        setChats(prev => {
          const idx = prev.findIndex(c => c.id === row.id);
          const updated: ChatSummary = {
            id: row.id,
            lastMessageAt: row.last_message_at,
            subject: row.metadata?.subject || row.customer_phone || (row.session_id ? `Session ${row.session_id.slice(0,6)}` : `Chat ${String(row.id).slice(0,6)}`),
            unread: prev[idx]?.unread ?? 0,
          };
          if (idx === -1) return [updated, ...prev];
          const next = prev.slice();
          next[idx] = { ...next[idx], ...updated };
          return next;
        });
        setUnreadMap(prev => {
          const id = row.id;
          const next = { ...prev };
          next[id] = (id === activeId) ? 0 : ((next[id] ?? 0) + 1);
          return next;
        });
      })
      .subscribe();
    chatChannel.current = ch;
    loadChats();
    return () => { ch.unsubscribe(); };
  }, [supabase, tenantId, loadChats, activeId]);

  // Subscribe to messages for active chat
  useEffect(() => {
    msgChannel.current?.unsubscribe();
    if (!activeId) return;
    const ch = supabase.channel(`rt-messages-${activeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${activeId}` }, (payload: RealtimePostgresChangesPayload<MessageRow>) => {
        const row = (payload.new || payload.old) as MessageRow | null;
        if (!row) return;
        if (payload.eventType === 'DELETE') {
          setMessages(prev => prev.filter(m => m.id !== row.id));
        } else {
          const msg: ChatMessage = {
            id: row.id,
            chatId: row.chat_id,
            content: row.content || '',
            role: row.direction === 'outbound' ? 'user' : 'assistant',
            createdAt: row.created_at || new Date().toISOString(),
          };
          setMessages(prev => {
            const idx = prev.findIndex(m => m.id === msg.id);
            if (idx >= 0) { const copy = prev.slice(); copy[idx] = msg; return copy; }
            return [...prev, msg];
          });
        }
      })
      .subscribe();
    msgChannel.current = ch;
    loadMessages(activeId);
    return () => { ch.unsubscribe(); };
  }, [supabase, activeId, loadMessages]);

  const send = useCallback(async (text: string) => {
    if (!activeId) return;
    await fetch(`/api/chats/${encodeURIComponent(activeId)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
    });
  }, [activeId]);

  // reset unread when opening a chat
  useEffect(() => {
    if (!activeId) return;
    setUnreadMap(prev => ({ ...prev, [activeId]: 0 }));
    setChats(prev => prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c));
    // notify server (best-effort)
    fetch(`/api/chats/${encodeURIComponent(activeId)}/read`, { method: 'POST' }).catch(() => {});
  }, [activeId]);

  // merge unreadMap into chats for consumers
  const chatsWithUnread = useMemo(() => chats.map(c => ({ ...c, unread: unreadMap[c.id] ?? c.unread ?? 0 })), [chats, unreadMap]);

  return useMemo(() => ({ loading, chats: chatsWithUnread, activeId, setActiveId, messages, send }), [loading, chatsWithUnread, activeId, messages, send]);
}
