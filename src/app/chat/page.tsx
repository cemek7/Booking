"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { ChatThread } from '@/components/chat/ChatThread';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useChatRealtime } from '@/hooks/useChatRealtime';

// WhatsApp-style full height two-pane layout (sidebar + thread)
export default function ChatPage() {
  const { tenant } = useTenant();
  const { chats, activeId, setActiveId, messages, send, loading } = useChatRealtime(tenant?.id);
  const [query, setQuery] = useState('');
  const searchParams = useSearchParams();
  const phoneParam = useMemo(() => searchParams?.get('phone') || null, [searchParams]);
  const chatParam = useMemo(() => searchParams?.get('chat') || null, [searchParams]);

  const handleSelect = useCallback((id: string) => { setActiveId(id); }, [setActiveId]);
  const handleSend = useCallback(async (text: string) => { await send(text); }, [send]);

  // When arriving with ?chat=, prioritize selecting that chat id
  useEffect(() => {
    if (!activeId && chatParam) {
      setActiveId(chatParam);
    }
  }, [chatParam, activeId, setActiveId]);

  // When arriving with ?phone=, attempt to select matching chat when chats list loads (if no ?chat=)
  useEffect(() => {
    if (!phoneParam || chatParam || activeId) return;
    const p = phoneParam.replace(/\s+/g, '').toLowerCase();
    const match = chats.find(c => (c.subject || '').replace(/\s+/g, '').toLowerCase().includes(p));
    if (match) setActiveId(match.id);
  }, [phoneParam, chatParam, chats, activeId, setActiveId]);

  return (
    <div className="flex h-[calc(100vh-4rem)] w-full overflow-hidden rounded-lg border bg-white">
      {/* Sidebar */}
      <div className={`flex flex-col w-[320px] border-r bg-gray-50 ${activeId ? 'hidden' : 'flex'} lg:flex`}>
        <div className="p-3 border-b flex items-center justify-between gap-2">
          <h2 className="font-semibold text-sm">Chats</h2>
          <button
            className="px-3 py-1.5 text-xs rounded border bg-white hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            type="button"
          >New</button>
        </div>
        <div className="p-3 border-b">
          <input
            placeholder="Search chats"
            className="w-full border rounded px-2 py-1 text-xs bg-white"
            aria-label="Search chats"
            value={query}
            onChange={(e)=>setQuery(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <ChatSidebar chats={chats} activeId={activeId} onSelect={handleSelect} filter={query} />
        </div>
      </div>
      {/* Thread */}
      <div className={`flex flex-col flex-1 bg-gray-100 ${activeId ? 'flex' : 'hidden'} lg:flex`}>
        <div className="p-3 border-b bg-white flex items-center justify-between">
          {activeId ? (
            <div className="flex items-center gap-2">
              <button className="lg:hidden text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50" onClick={()=>setActiveId(null)} aria-label="Back to chats">Back</button>
              <div className="h-8 w-8 rounded-full bg-indigo-200 flex items-center justify-center text-[11px] font-medium text-indigo-700" aria-label="chat-avatar">{activeId.slice(0,2).toUpperCase()}</div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold truncate max-w-56" aria-label="chat-subject">{chats.find(c=>c.id===activeId)?.subject || 'Chat'}</span>
                <span className="text-[10px] text-gray-500">{loading ? 'Loading…' : 'Active'}</span>
              </div>
            </div>
          ) : (
            <span className="text-sm text-gray-500">Select a chat</span>
          )}
          <div className="flex items-center gap-2">
            <button className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50" type="button">Info</button>
            <button className="text-[11px] px-2 py-1 rounded border bg-white hover:bg-red-50" type="button">Close</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
          <ChatThread messages={messages.filter(m => m.chatId === activeId)} activeChatId={activeId} />
        </div>
        <div className="border-t bg-white p-2">
          <ChatComposer onSend={handleSend} disabled={!activeId} />
        </div>
      </div>
    </div>
  );
}
