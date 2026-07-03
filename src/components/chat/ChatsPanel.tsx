"use client";
import { useCallback, useMemo, useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import type { ChatSupportStatus } from '@/lib/chats/operations';
import { ChatSidebar } from './ChatSidebar';
import { ChatThread } from './ChatThread';
import { ChatComposer } from './ChatComposer';
import EscalationBanner from './EscalationBanner';

export default function ChatsPanel() {
  const { tenant } = useTenant();
  const {
    chats,
    activeId,
    setActiveId,
    messages,
    send,
    release,
    claim,
    assign,
    unassign,
    updateStatus,
    loading,
    reloadChats,
    outboundReadiness,
    assignees,
  } = useChatRealtime(tenant?.id);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ChatSupportStatus>('all');
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'mine' | 'unassigned'>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | 'whatsapp' | 'instagram'>('all');
  const activeChat = useMemo(() => chats.find((c) => c.id === activeId) ?? null, [chats, activeId]);
  const [chatOpsError, setChatOpsError] = useState<string | null>(null);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => {
      if (statusFilter !== 'all' && chat.status !== statusFilter) return false;
      if (assignmentFilter === 'mine' && !selectedAssigneeId) return false;
      if (assignmentFilter === 'mine' && chat.assigneeUserId !== selectedAssigneeId) return false;
      if (assignmentFilter === 'unassigned' && chat.assigneeUserId) return false;
      if (channelFilter !== 'all' && chat.channel !== channelFilter) return false;
      return true;
    });
  }, [assignmentFilter, channelFilter, chats, selectedAssigneeId, statusFilter]);
  const totalUnread = useMemo(() => filteredChats.reduce((s, c) => s + (c.unread ?? 0), 0), [filteredChats]);
  const isHumanHandling = Boolean(
    activeChat?.humanHandlingUntil && Date.parse(activeChat.humanHandlingUntil) > Date.now()
  );

  const handleSelect = useCallback((id: string) => setActiveId(id), [setActiveId]);
  const handleSend = useCallback(async (text: string) => { await send(text); }, [send]);
  const handleRelease = useCallback(async () => { await release(); }, [release]);
  const handleClaim = useCallback(async () => {
    setChatOpsError(null);
    try {
      await claim();
    } catch (error) {
      setChatOpsError(error instanceof Error ? error.message : 'Failed to claim chat');
    }
  }, [claim]);
  const handleUnassign = useCallback(async () => {
    setChatOpsError(null);
    try {
      await unassign();
    } catch (error) {
      setChatOpsError(error instanceof Error ? error.message : 'Failed to unassign chat');
    }
  }, [unassign]);
  const handleAssign = useCallback(async (assigneeUserId: string) => {
    setChatOpsError(null);
    try {
      await assign(assigneeUserId);
      setSelectedAssigneeId((current) => current || assigneeUserId);
    } catch (error) {
      setChatOpsError(error instanceof Error ? error.message : 'Failed to assign chat');
    }
  }, [assign]);
  const handleStatusChange = useCallback(async (status: ChatSupportStatus) => {
    setChatOpsError(null);
    try {
      await updateStatus(status);
    } catch (error) {
      setChatOpsError(error instanceof Error ? error.message : 'Failed to update chat status');
    }
  }, [updateStatus]);
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
          <div className="text-2xl font-bold">{loading ? '—' : filteredChats.length}</div>
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
          <div className="text-2xl font-bold">{loading ? '—' : filteredChats.filter((chat) => chat.status === 'open').length}</div>
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
          <div className="grid gap-2 border-b bg-white px-3 py-3">
            <select
              aria-label="Filter chat status"
              className="rounded border px-2 py-1 text-xs"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | ChatSupportStatus)}
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
            </select>
            <select
              aria-label="Filter chat assignment"
              className="rounded border px-2 py-1 text-xs"
              value={assignmentFilter}
              onChange={(event) => setAssignmentFilter(event.target.value as 'all' | 'mine' | 'unassigned')}
            >
              <option value="all">All assignments</option>
              <option value="mine">Assigned to selected teammate</option>
              <option value="unassigned">Unassigned</option>
            </select>
            {assignmentFilter === 'mine' ? (
              <select
                aria-label="Filter assigned teammate"
                className="rounded border px-2 py-1 text-xs"
                value={selectedAssigneeId}
                onChange={(event) => setSelectedAssigneeId(event.target.value)}
              >
                <option value="">Choose teammate</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              aria-label="Filter chat channel"
              className="rounded border px-2 py-1 text-xs"
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value as 'all' | 'whatsapp' | 'instagram')}
            >
              <option value="all">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="instagram">Instagram</option>
            </select>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3">
            <ChatSidebar chats={filteredChats} activeId={activeId} onSelect={handleSelect} filter={query} />
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
                    {activeChat ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                        {activeChat.status}
                      </span>
                    ) : null}
                  </span>
                  {activeChat ? (
                    <span className="text-[10px] text-gray-500">
                      {activeChat.assigneeLabel ? `Assigned to ${activeChat.assigneeLabel}` : 'Unassigned'}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <span className="text-sm text-gray-500">Select a chat to view messages</span>
            )}
            {activeChat ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Chat status"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  value={activeChat.status}
                  onChange={(event) => void handleStatusChange(event.target.value as ChatSupportStatus)}
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                </select>
                <button
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => void handleClaim()}
                >
                  Claim
                </button>
                <select
                  aria-label="Assign chat teammate"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                  value=""
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    if (nextValue) {
                      void handleAssign(nextValue);
                    }
                  }}
                >
                  <option value="">Assign teammate…</option>
                  {activeChat?.assigneeUserId && activeChat.assigneeLabel && !assignees.some((assignee) => assignee.id === activeChat.assigneeUserId) ? (
                    <option value={activeChat.assigneeUserId}>{activeChat.assigneeLabel}</option>
                  ) : null}
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.name}
                    </option>
                  ))}
                </select>
                <button
                  className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => void handleUnassign()}
                  disabled={!activeChat.assigneeUserId}
                >
                  Unassign
                </button>
              </div>
            ) : null}
          </div>
          {chatOpsError ? (
            <div className="border-b border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
              {chatOpsError}
            </div>
          ) : null}
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
