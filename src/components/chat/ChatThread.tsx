"use client";
import React, { useEffect, useRef } from 'react';

export interface ChatMessage {
  id: string;
  chatId: string;
  author: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface ChatThreadProps {
  messages: ChatMessage[];
  activeChatId?: string | null;
  loading?: boolean;
}

export function ChatThread({ messages, activeChatId, loading }: ChatThreadProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  if (!activeChatId) {
    return <div className="text-sm text-gray-500 p-4">Select a thread to begin.</div>;
  }
  return (
    <div className="space-y-3 p-1">
      {messages.length === 0 && !loading && (
        <p className="text-xs text-gray-500">No messages yet. Say hello!</p>
      )}
      {messages.map(m => (
        <div
          key={m.id}
          className={`rounded-lg px-3 py-2 text-sm max-w-[85%] shadow-sm ${m.role === 'user' ? 'bg-indigo-600 text-white ml-auto' : 'bg-gray-100 text-gray-900'}`}
          aria-label={`${m.role} message`}
        >
          <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
          <div className={`mt-1 text-[10px] ${m.role === 'user' ? 'text-indigo-100' : 'text-gray-500'}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      ))}
      {loading && <div className="text-xs text-gray-400 animate-pulse">Loading…</div>}
      <div ref={endRef} />
    </div>
  );
}

export default ChatThread;
