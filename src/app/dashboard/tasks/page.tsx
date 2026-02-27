import { requireAuth } from '@/lib/auth/server-auth';
import TasksClient from './TasksClient';

export default async function TasksPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);
  return <TasksClient role={user.role as 'owner' | 'manager' | 'staff'} />;
}
