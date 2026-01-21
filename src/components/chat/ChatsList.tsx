"use client";
import React, { memo } from 'react';
import Link from "next/link";
import { useTenant } from "@/lib/supabase/tenant-context";
import { useQuery } from '@tanstack/react-query';
import { authFetch } from "@/lib/auth/auth-api-client";

interface Chat {
  customer_id: string;
  customer_name?: string;
  last_message?: string;
}

interface ChatListItemProps {
  chat: Chat;
}

const ChatListItem = memo<ChatListItemProps>(function ChatListItem({ chat }) {
  return (
    <li className="py-2 px-1">
      <Link
        href={`/dashboard/chats/${chat.customer_id}`}
        className="block rounded px-2 py-2 transform transition-all duration-200 hover:translate-x-1 hover:scale-[1.01] hover:shadow-md"
      >
        <div className="font-semibold">{chat.customer_name || chat.customer_id}</div>
        <div className="text-xs text-gray-500 truncate">{chat.last_message}</div>
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
          console.warn(`Chats API returned error:`, response.error.message);
          return [];
        }
        return response.data || [];
      } catch (e) {
        console.warn('ChatsList API call failed:', e);
        return [];
      }
    },
    enabled: !!tenant?.id,
  });

  if (isLoading) return <div>Loading chats...</div>;
  if (error) return <div>Error loading chats</div>;
  if (!data || data.length === 0) return <div>No chats found.</div>;

  return (
    <ul className="divide-y">
      {data.map((chat: Chat) => (
        <ChatListItem key={chat.customer_id} chat={chat} />
      ))}
    </ul>
  );
}
