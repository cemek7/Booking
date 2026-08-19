'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/components/ui/toast';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';

type Priority = 'low' | 'medium' | 'high';
type Status = 'todo' | 'in_progress' | 'done';

interface Task {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  status: Status;
  due_date?: string;
  created_at: string;
}

interface TasksClientProps {
  /**
   * - owner/manager: full CRUD + three-state cycle (todo → in_progress → done)
   * - staff: can tick tasks done/undone (todo ↔ done), but cannot create or delete
   */
  role: 'owner' | 'manager' | 'staff';
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-600',
};

const STATUS_LABELS: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export default function TasksClient({ role }: TasksClientProps) {
  const isManager = role === 'owner' || role === 'manager';
  const headers = useAuthHeaders();

  const [activeStatus, setActiveStatus] = useState<Status | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' as Priority, due_date: '' });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  const loadTasks = useCallback(async () => {
    if (!headers) return;
    setLoadingTasks(true);
    try {
      const res = await fetch('/api/tasks', { headers });
      const data = await res.json();
      setTasks(data?.tasks ?? []);
    } catch {
      toast.error('Failed to load tasks');
    } finally {
      setLoadingTasks(false);
    }
  }, [headers]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const visible = activeStatus === 'all' ? tasks : tasks.filter((t) => t.status === activeStatus);

  async function createTask() {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    if (!headers) return;
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          priority: form.priority,
          due_date: form.due_date || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTasks((prev) => [data.task, ...prev]);
      setForm({ title: '', description: '', priority: 'medium', due_date: '' });
      setShowForm(false);
      toast.success('Task created');
    } catch {
      toast.error('Failed to create task');
    }
  }

  /** Owner/Manager: cycles todo → in_progress → done → todo */
  async function cycleStatus(id: string) {
    if (!headers) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next: Status = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: next } : t));
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, status: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: task.status } : t));
      toast.error('Failed to update task');
    }
  }

  /** Staff: marks tasks done or reverts to todo */
  async function tickTask(id: string) {
    if (!headers) return;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const next: Status = task.status === 'done' ? 'todo' : 'done';
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: next } : t));
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id, status: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next === 'done' ? 'Marked as done ✓' : 'Marked as to do');
    } catch {
      setTasks((prev) => prev.map((t) => t.id === id ? { ...t, status: task.status } : t));
      toast.error('Failed to update task');
    }
  }

  async function deleteTask(id: string) {
    if (!headers) return;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/tasks?id=${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error();
      toast.success('Task deleted');
    } catch {
      await loadTasks();
      toast.error('Failed to delete task');
    }
  }

  const counts: Record<Status | 'all', number> = {
    all: tasks.length,
    todo: tasks.filter((t) => t.status === 'todo').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    done: tasks.filter((t) => t.status === 'done').length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tasks</h1>
          <p className="text-sm text-gray-600 mt-1">
            {isManager ? 'Track and manage your team tasks.' : 'Tick tasks as you complete them.'}
          </p>
        </div>
        {isManager && (
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
          >
            + New Task
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'todo', 'in_progress', 'done'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveStatus(s)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              activeStatus === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]} ({counts[s]})
          </button>
        ))}
        {isManager && (
          <span className="ml-auto self-center text-xs text-gray-400">
            {counts.todo} open · {counts.in_progress} in progress · {counts.done} done
          </span>
        )}
      </div>

      {/* New task form — owner/manager only */}
      {isManager && showForm && (
        <div className="bg-white border rounded-xl p-5 space-y-3 shadow-sm">
          <h2 className="font-semibold text-sm">New Task</h2>
          <input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="Task title"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
            placeholder="Description (optional)"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Due date (optional)</label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={createTask}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
              Create
            </button>
            <button onClick={() => setShowForm(false)}
              className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      {loadingTasks ? (
        <div className="text-center py-12 bg-white border rounded-xl">
          <p className="text-gray-400 text-sm">Loading tasks…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-xl">
          <p className="text-gray-500 text-sm">No tasks found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((task) => (
            <div
              key={task.id}
              className={`bg-white border rounded-xl p-4 flex items-start gap-3 ${
                task.status === 'done' ? 'opacity-60' : ''
              }`}
            >
              {isManager ? (
                /* Owner/Manager: three-state cycle button */
                <button
                  onClick={() => cycleStatus(task.id)}
                  title={`Current: ${STATUS_LABELS[task.status]} — click to advance`}
                  className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    task.status === 'done'
                      ? 'bg-green-500 border-green-500 text-white'
                      : task.status === 'in_progress'
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  {task.status === 'done' && <span className="text-xs leading-none">✓</span>}
                </button>
              ) : (
                /* Staff: checkbox — three distinct visual states:
                   todo (unchecked) → click → done (checked)
                   in_progress (amber dash) → click → done (checked)
                   done (checked) → click → todo (unchecked)
                */
                <button
                  onClick={() => tickTask(task.id)}
                  title={task.status === 'done' ? 'Mark as to do' : 'Mark as done'}
                  aria-label={task.status === 'done' ? 'Mark as to do' : task.status === 'in_progress' ? 'Mark as done (in progress)' : 'Mark as done'}
                  className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                    task.status === 'done'
                      ? 'bg-green-500 border-green-500 text-white'
                      : task.status === 'in_progress'
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-300 hover:border-indigo-400 bg-white'
                  }`}
                >
                  {task.status === 'done' && <span className="text-xs leading-none">✓</span>}
                  {task.status === 'in_progress' && <span className="text-xs leading-none text-yellow-500">–</span>}
                </button>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                    {task.title}
                  </p>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${PRIORITY_COLORS[task.priority]}`}>
                    {task.priority}
                  </span>
                  <span className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-600">
                    {STATUS_LABELS[task.status]}
                  </span>
                </div>
                {task.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{task.description}</p>
                )}
                {task.due_date && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    Due {new Date(task.due_date).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Delete — owner/manager only */}
              {isManager && (
                <button
                  onClick={() => deleteTask(task.id)}
                  className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
