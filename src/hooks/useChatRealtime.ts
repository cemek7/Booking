"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { getChatSupportState, type ChatChannel, type ChatSupportStatus } from '@/lib/chats/operations';

export type ChatSummary = {
  id: string;
  subject: string;
  customerPhone?: string | null;
  channel: ChatChannel;
  lastMessageAt?: string | null;
  unread?: number;
  humanHandlingUntil?: string | null;
  status: ChatSupportStatus;
  assigneeUserId?: string | null;
  assigneeLabel?: string | null;
};
export type OutboundReadinessSummary = {
  allowed: boolean;
  mode:
    | 'reply_window'
    | 'consented_followup'
    | 'blocked_instagram_window'
    | 'blocked_consent_required';
  reason: string;
  lastInboundAt: string | null;
};
export type ChatMessage = { id: string; chatId: string; author: string; content: string; role: 'user'|'assistant'; createdAt: string };

// Database row types for type safety
interface ChatRow {
  id: string;
  last_message_at: string | null;
  session_id: string | null;
  customer_phone: string | null;
  metadata: {
    subject?: string;
    channel?: ChatChannel;
    support?: {
      status?: ChatSupportStatus;
      assigneeUserId?: string | null;
      assigneeLabel?: string | null;
    } | null;
  } | null;
  unread_count?: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  content: string | null;
  direction: 'inbound' | 'outbound';
  created_at: string;
}

interface ConversationRow {
  external_id: string | null;
  channel: 'whatsapp' | 'instagram';
  flow_data: { human_handling_until?: string } | null;
}

export function useChatRealtime(tenantId: string | null | undefined) {
  const supabase = getSupabaseBrowserClient();
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [outboundReadiness, setOutboundReadiness] = useState<OutboundReadinessSummary | null>(null);
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const msgChannel = useRef<RealtimeChannel | null>(null);
  const chatChannel = useRef<RealtimeChannel | null>(null);

  const loadChats = useCallback(async () => {
    if (!tenantId) { setChats([]); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('id,last_message_at,session_id,customer_phone,metadata,unread_count')
        .eq('tenant_id', tenantId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(50);
      if (error) { setChats([]); return; }

      const rows = (data || []) as ChatRow[];
      const identities = rows
        .map((row) => ({
          externalId: row.customer_phone,
          channel: row.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
        }))
        .filter((identity): identity is { externalId: string; channel: 'whatsapp' | 'instagram' } => Boolean(identity.externalId));

      const humanHandlingByKey = new Map<string, string>();
      if (identities.length > 0) {
        const externalIds = [...new Set(identities.map((identity) => identity.externalId))];
        const { data: conversations } = await supabase
          .from('whatsapp_conversations')
          .select('external_id,channel,flow_data')
          .eq('tenant_id', tenantId)
          .in('external_id', externalIds);

        for (const conversation of (conversations || []) as ConversationRow[]) {
          const until = conversation.flow_data?.human_handling_until;
          if (typeof conversation.external_id === 'string' && typeof until === 'string') {
            humanHandlingByKey.set(`${conversation.channel}:${conversation.external_id}`, until);
          }
        }
      }

      const mapped: ChatSummary[] = rows.map((row) => ({
        ...getChatSupportState(row.metadata ?? null),
        id: row.id,
        customerPhone: row.customer_phone,
        lastMessageAt: row.last_message_at,
        subject: row.metadata?.subject || row.customer_phone || (row.session_id ? `Session ${row.session_id.slice(0,6)}` : `Chat ${String(row.id).slice(0,6)}`),
        channel: row.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
        unread: row.unread_count ?? 0,
        humanHandlingUntil: row.customer_phone
          ? humanHandlingByKey.get(`${row.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp'}:${row.customer_phone}`) ?? null
          : null,
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
      author: m.direction === 'outbound' ? 'You' : 'Customer',
      content: m.content || '',
      role: m.direction === 'outbound' ? 'user' : 'assistant',
      createdAt: m.created_at,
    }));
    setMessages(mapped);
  }, [supabase]);

  const loadOutboundReadiness = useCallback(async (chatId: string | null) => {
    if (!chatId) {
      setOutboundReadiness(null);
      return;
    }

    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/outbound-readiness`);
      if (!response.ok) {
        setOutboundReadiness(null);
        return;
      }

      const payload = (await response.json()) as { readiness?: OutboundReadinessSummary };
      setOutboundReadiness(payload.readiness ?? null);
    } catch {
      setOutboundReadiness(null);
    }
  }, []);

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
            ...getChatSupportState(row.metadata ?? null),
            id: row.id,
            customerPhone: row.customer_phone,
            lastMessageAt: row.last_message_at,
            subject: row.metadata?.subject || row.customer_phone || (row.session_id ? `Session ${row.session_id.slice(0,6)}` : `Chat ${String(row.id).slice(0,6)}`),
            channel: row.metadata?.channel === 'instagram' ? 'instagram' : 'whatsapp',
            unread: prev[idx]?.unread ?? 0,
            humanHandlingUntil: prev[idx]?.humanHandlingUntil ?? null,
          };
          if (idx === -1) return [updated, ...prev];
          const next = prev.slice();
          next[idx] = { ...next[idx], ...updated };
          return next;
        });
        setUnreadMap(prev => {
          const id = row.id;
          const next = { ...prev };
          next[id] = id === activeId ? 0 : (row.unread_count ?? next[id] ?? 0);
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
            author: row.direction === 'outbound' ? 'You' : 'Customer',
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
    void loadOutboundReadiness(activeId);
    return () => { ch.unsubscribe(); };
  }, [supabase, activeId, loadMessages, loadOutboundReadiness]);

  const send = useCallback(async (text: string) => {
    if (!activeId) return;
    const response = await fetch(`/api/chats/${encodeURIComponent(activeId)}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      throw new Error(payload?.message || payload?.error || 'Failed to send message');
    }
    await loadChats();
    await loadOutboundReadiness(activeId);
  }, [activeId, loadChats]);

  const release = useCallback(async () => {
    if (!activeId) return;
    const response = await fetch(`/api/chats/${encodeURIComponent(activeId)}/release`, { method: 'POST' });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      throw new Error(payload?.message || payload?.error || 'Failed to release chat to AI');
    }
    await loadChats();
  }, [activeId, loadChats]);

  const updateChatState = useCallback(async (payload: Record<string, unknown>) => {
    if (!activeId) return;
    const response = await fetch(`/api/chats/${encodeURIComponent(activeId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string; error?: string } | null;
      throw new Error(data?.message || data?.error || 'Failed to update chat');
    }
    await loadChats();
  }, [activeId, loadChats]);

  const claim = useCallback(async () => {
    await updateChatState({ action: 'claim' });
  }, [updateChatState]);

  const unassign = useCallback(async () => {
    await updateChatState({ action: 'unassign' });
  }, [updateChatState]);

  const updateStatus = useCallback(async (status: ChatSupportStatus) => {
    await updateChatState({ action: 'status', status });
  }, [updateChatState]);

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

  return useMemo(
    () => ({
      loading,
      chats: chatsWithUnread,
      activeId,
      setActiveId,
      messages,
      send,
      release,
      claim,
      unassign,
      updateStatus,
      reloadChats: loadChats,
      outboundReadiness,
    }),
    [loading, chatsWithUnread, activeId, messages, send, release, claim, unassign, updateStatus, loadChats, outboundReadiness]
  );
}
