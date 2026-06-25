"use client";
import React, { memo } from 'react';
import Link from "next/link";
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery } from '@tanstack/react-query';
import { authFetch } from "@/lib/auth/auth-api-client";

interface Chat {
  id: string;
  subject?: string;
  last_message_at?: string | null;
  unread?: number;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const ChatListItem = memo<{ chat: Chat }>(function ChatListItem({ chat }) {
  return (
    <li>
      <Link
        href="/dashboard/chats"
        className="flex items-center justify-between gap-2 px-2 py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{chat.subject || 'Chat'}</div>
          <div className="text-xs text-gray-400">{relativeTime(chat.last_message_at)}</div>
        </div>
        {(chat.unread ?? 0) > 0 && (
          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold">
            {chat.unread}
          </span>
        )}
      </Link>
    </li>
  );
});

export default function ChatsList() {
  const { tenant } = useTenant();
  const { data, isLoading, error } = useQuery({
    queryKey: ['chats', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      try {
        const response = await authFetch(`/api/chats?tenant_id=${tenant.id}`);
        if (response.error) {
          console.warn('Chats API returned error:', response.error.message);
          return [];
        }
        return (response.data as Chat[]) || [];
      } catch (e) {
        console.warn('ChatsList fetch failed:', e);
        return [];
      }
    },
    enabled: !!tenant?.id,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-xs text-red-500">Could not load conversations.</p>;
  if (!data || data.length === 0) {
    return <p className="text-xs text-gray-400">No conversations yet.</p>;
  }

  return (
    <ul className="space-y-0.5">
      {data.map((chat: Chat) => (
        <ChatListItem key={chat.id} chat={chat} />
      ))}
    </ul>
  );
}
