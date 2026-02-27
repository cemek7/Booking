'use client';

import { useState } from 'react';
import { toast } from '@/components/ui/toast';

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

const SAMPLE_TASKS: Task[] = [
  { id: '1', title: 'Follow up with client', priority: 'high', status: 'todo', created_at: new Date().toISOString() },
  { id: '2', title: 'Update service pricing', priority: 'medium', status: 'in_progress', created_at: new Date().toISOString() },
  { id: '3', title: 'Send booking reminders', priority: 'low', status: 'done', created_at: new Date().toISOString() },
];

export default function TasksClient() {
  const [activeStatus, setActiveStatus] = useState<Status | 'all'>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', priority: 'medium' as Priority, due_date: '' });
  const [tasks, setTasks] = useState<Task[]>(SAMPLE_TASKS);

  const visible = activeStatus === 'all' ? tasks : tasks.filter((t) => t.status === activeStatus);

  function createTask() {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    const newTask: Task = {
      id: Date.now().toString(),
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      priority: form.priority,
      status: 'todo',
      due_date: form.due_date || undefined,
      created_at: new Date().toISOString(),
    };
    setTasks((prev) => [newTask, ...prev]);
    setForm({ title: '', description: '', priority: 'medium', due_date: '' });
    setShowForm(false);
    toast.success('Task created');
  }

  function toggleStatus(id: string) {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const next: Status = t.status === 'todo' ? 'in_progress' : t.status === 'in_progress' ? 'done' : 'todo';
        return { ...t, status: next };
      })
    );
  }

  function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    toast.success('Task deleted');
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
          <p className="text-sm text-gray-600 mt-1">Track and manage your team tasks.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          + New Task
        </button>
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
      </div>

      {/* New task form */}
      {showForm && (
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
      {visible.length === 0 ? (
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
              <button
                onClick={() => toggleStatus(task.id)}
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
              <button
                onClick={() => deleteTask(task.id)}
                className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
