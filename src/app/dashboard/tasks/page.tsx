import { requireAuth } from '@/lib/auth/server-auth';
import TasksClient from './TasksClient';

export default async function TasksPage() {
  await requireAuth(['owner', 'manager', 'staff']);
  return <TasksClient />;
}
