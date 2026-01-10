"use client";
import { useState } from 'react';

export interface ChatSummary {
  id: string; subject: string; lastMessageAt?: string; unread?: number;
}

interface ChatSidebarProps {
  chats: ChatSummary[];
  activeId?: string | null;
  onSelect?: (id: string) => void;
  filter?: string;
}

export function ChatSidebar({ chats, activeId, onSelect, filter }: ChatSidebarProps) {
  const list = chats.filter(c => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return c.subject.toLowerCase().includes(q);
  });
  return (
    <div className="space-y-3">
      <ul className="space-y-1" aria-label="Chat threads">
        {list.map(c => (
          <li key={c.id}>
            <button
              onClick={()=>onSelect?.(c.id)}
              className={`w-full text-left rounded px-2 py-2 text-sm hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition ${c.id===activeId?'bg-indigo-100':'bg-white border'}`}
              aria-current={c.id===activeId? 'true': undefined}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium truncate max-w-40" title={c.subject}>{c.subject}</span>
                {c.unread ? <span className="ml-2 inline-flex items-center justify-center text-xs px-2 py-0.5 rounded-full bg-indigo-600 text-white" aria-label={`${c.unread} unread messages`}>{c.unread}</span> : null}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">
                {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </div>
            </button>
          </li>
        ))}
        {list.length === 0 && (
          <li className="text-xs text-gray-500 px-2">No chats found.</li>
        )}
      </ul>
    </div>
  );
}
