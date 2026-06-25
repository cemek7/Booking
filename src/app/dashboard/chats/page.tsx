export const dynamic = 'force-dynamic';
import { requireAuth } from '@/lib/auth/server-auth';
import ChatsPanel from '@/components/chat/ChatsPanel';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function ChatsPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm">
        <div className="p-6 lg:p-8">
          <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600">
            Messages
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">Customer Messages</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            {user.role === 'owner' && 'View all customer communications across your business.'}
            {user.role === 'manager' && 'Manage team communications and customer inquiries.'}
            {user.role === 'staff' && 'View your communications with customers.'}
          </p>
        </div>
      </div>
      <Card className="p-0">
        <CardContent className="p-5">
          <ChatsPanel />
        </CardContent>
      </Card>
    </div>
  );
}
