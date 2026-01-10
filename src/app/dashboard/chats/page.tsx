import { requireAuth } from '@/lib/auth/server-auth';
import ChatsList from '@/components/chat/ChatsList';

export default async function ChatsPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Customer Messages</h1>
        <p className="text-sm text-gray-600">
          {user.role === 'owner' && 'View all customer communications and team chats across your business.'}
          {user.role === 'manager' && 'Manage team communications and customer inquiries.'}
          {user.role === 'staff' && 'View your communications with customers.'}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Total Conversations</div>
          <div className="text-2xl font-bold">—</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Unread Messages</div>
          <div className="text-2xl font-bold text-orange-600">—</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Avg Response Time</div>
          <div className="text-2xl font-bold">—</div>
        </div>
        <div className="bg-white p-4 rounded border shadow-sm">
          <div className="text-xs text-gray-500 mb-1">Open Chats</div>
          <div className="text-2xl font-bold">—</div>
        </div>
      </div>

      <div className="bg-white rounded border shadow-sm p-6">
        <ChatsList />
      </div>
    </div>
  );
}
