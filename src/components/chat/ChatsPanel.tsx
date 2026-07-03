"use client";
import { useCallback, useMemo, useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { ChatSidebar } from './ChatSidebar';
import { ChatThread } from './ChatThread';
import { ChatComposer } from './ChatComposer';
import EscalationBanner from './EscalationBanner';

export default function ChatsPanel() {
  const { tenant } = useTenant();
  const { chats, activeId, setActiveId, messages, send, release, loading, reloadChats, outboundReadiness } = useChatRealtime(tenant?.id);
  const [query, setQuery] = useState('');
  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);

  const totalUnread = useMemo(() => chats.reduce((s, c) => s + (c.unread ?? 0), 0), [chats]);
  const isHumanHandling = Boolean(
    activeChat?.humanHandlingUntil && Date.parse(activeChat.humanHandlingUntil) > Date.now()
  );

  const handleSelect = useCallback((id: string) => setActiveId(id), [setActiveId]);
  const handleSend = useCallback(async (text: string) => { await send(text); }, [send]);
  const handleRelease = useCallback(async () => { await release(); }, [release]);
  const handleOpenCustomer = useCallback((customerPhone: string) => {
    const matched = chats.find((chat) => chat.customerPhone === customerPhone);
    if (matched) {
      setActiveId(matched.id);
      void reloadChats();
    }
  }, [chats, reloadChats, setActiveId]);

  return (
    <>
      {/* Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Total Conversations</div>
          <div className="text-2xl font-bold">{loading ? '—' : chats.length}</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Unread Messages</div>
          <div className="text-2xl font-bold text-orange-600">{loading ? '—' : totalUnread}</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Avg Response Time</div>
          <div className="text-2xl font-bold">—</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Open Chats</div>
          <div className="text-2xl font-bold">{loading ? '—' : chats.length}</div>
        </div>
      </div>

      {/* Two-pane chat UI */}
      <div className="flex h-[calc(100vh-18rem)] w-full overflow-hidden rounded-lg border bg-white">
        {/* Sidebar */}
        <div className={`flex flex-col w-[320px] border-r bg-gray-50 ${activeId ? 'hidden' : 'flex'} lg:flex`}>
          <div className="p-3 border-b">
            <h2 className="font-semibold text-sm">Chats</h2>
          </div>
          <div className="border-b bg-white px-3 py-2">
            <EscalationBanner onOpenCustomer={handleOpenCustomer} onClaimed={reloadChats} />
          </div>
          <div className="p-3 border-b">
            <input
              placeholder="Search chats"
              className="w-full border rounded px-2 py-1 text-xs bg-white"
              aria-label="Search chats"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
                <button
                  className="lg:hidden text-[11px] px-2 py-1 rounded border bg-white hover:bg-gray-50"
                  onClick={() => setActiveId(null)}
                  aria-label="Back to chats"
                >
                  Back
                </button>
                <div className="h-8 w-8 rounded-full bg-indigo-200 flex items-center justify-center text-[11px] font-medium text-indigo-700">
                  {activeId.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold truncate max-w-56">
                    {activeChat?.subject || 'Chat'}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] text-gray-500">
                    <span>{loading ? 'Loading…' : 'Active'}</span>
                    {activeChat ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          activeChat.channel === 'instagram'
                            ? 'bg-pink-100 text-pink-700'
                            : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {activeChat.channel === 'instagram' ? 'Instagram' : 'WhatsApp'}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            ) : (
              <span className="text-sm text-gray-500">Select a chat to view messages</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4" aria-live="polite">
            <ChatThread
              messages={messages.filter((m) => m.chatId === activeId)}
              activeChatId={activeId}
              loading={loading && !!activeId}
              channel={activeChat?.channel}
            />
          </div>
          <div className="border-t bg-white">
            <ChatComposer
              chatId={activeId}
              onSend={handleSend}
              onRelease={handleRelease}
              disabled={!activeId}
              channel={activeChat?.channel}
              humanHandling={isHumanHandling}
              outboundReadiness={outboundReadiness}
            />
          </div>
        </div>
      </div>
    </>
  );
}
