import { requireAuth } from '@/lib/auth/server-auth';
import TasksClient from './TasksClient';

export default async function TasksPage() {
  const user = await requireAuth(['owner', 'manager', 'staff']);
  // Staff get read-only access; owners and managers get full CRUD
  const canEdit = ['owner', 'manager'].includes(user.role);
  return <TasksClient canEdit={canEdit} />;
}
