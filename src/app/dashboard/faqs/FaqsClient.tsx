'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { toast } from '@/components/ui/toast';

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category?: string;
  is_active: boolean;
  sort_order: number;
}

interface FaqFormData {
  question: string;
  answer: string;
  category: string;
}

const emptyForm: FaqFormData = { question: '', answer: '', category: '' };

export default function FaqsPage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FAQ | null>(null);
  const [form, setForm] = useState<FaqFormData>(emptyForm);

  const { data, isLoading } = useQuery({
    queryKey: ['faqs', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return [];
      const res = await fetch('/api/faqs', {
        headers: { 'X-Tenant-ID': tenant.id },
      });
      if (!res.ok) throw new Error('Failed to fetch FAQs');
      const json = await res.json();
      return json.data as FAQ[];
    },
    enabled: !!tenant?.id,
  });

  const faqs = data ?? [];

  const createMutation = useMutation({
    mutationFn: async (payload: FaqFormData) => {
      const res = await fetch('/api/faqs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant!.id },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to create FAQ');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs', tenant?.id] });
      setForm(emptyForm);
      setShowForm(false);
      toast.success('FAQ created');
    },
    onError: () => toast.error('Failed to create FAQ'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<FaqFormData & { is_active: boolean }> }) => {
      const res = await fetch(`/api/faqs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': tenant!.id },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to update FAQ');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs', tenant?.id] });
      setEditing(null);
      setForm(emptyForm);
      toast.success('FAQ updated');
    },
    onError: () => toast.error('Failed to update FAQ'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/faqs/${id}`, {
        method: 'DELETE',
        headers: { 'X-Tenant-ID': tenant!.id },
      });
      if (!res.ok) throw new Error('Failed to delete FAQ');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faqs', tenant?.id] });
      toast.success('FAQ deleted');
    },
    onError: () => toast.error('Failed to delete FAQ'),
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(faq: FAQ) {
    setEditing(faq);
    setForm({ question: faq.question, answer: faq.answer, category: faq.category ?? '' });
    setShowForm(true);
  }

  function handleSubmit() {
    if (!form.question.trim() || !form.answer.trim()) {
      toast.error('Question and answer are required');
      return;
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: form });
    } else {
      createMutation.mutate(form);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">FAQ Knowledge Base</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage FAQs that power your AI agent and appear on your public booking page.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700"
        >
          + Add FAQ
        </button>
      </div>

      {/* FAQ form */}
      {showForm && (
        <div className="bg-white border rounded-xl p-5 space-y-4 shadow-sm">
          <h2 className="font-semibold text-sm">{editing ? 'Edit FAQ' : 'New FAQ'}</h2>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Question</label>
            <input
              value={form.question}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. What is your cancellation policy?"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Answer</label>
            <textarea
              value={form.answer}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
              rows={3}
              className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
              placeholder="Provide a clear and helpful answer..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category (optional)</label>
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Pricing, Policies, Services"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : editing ? 'Update' : 'Create'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm); }}
              className="px-4 py-2 border text-sm rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* FAQ list */}
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading FAQs…</p>
      ) : faqs.length === 0 ? (
        <div className="text-center py-12 bg-white border rounded-xl">
          <p className="text-gray-500 text-sm">No FAQs yet.</p>
          <p className="text-gray-400 text-xs mt-1">Add FAQs to help your AI agent answer customer questions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {faqs.map((faq) => (
            <div key={faq.id} className="bg-white border rounded-xl p-4 space-y-1">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900">{faq.question}</p>
                    {faq.category && (
                      <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full">
                        {faq.category}
                      </span>
                    )}
                    {!faq.is_active && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{faq.answer}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(faq)}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => updateMutation.mutate({ id: faq.id, payload: { is_active: !faq.is_active } })}
                    className="text-xs text-gray-500 hover:underline"
                  >
                    {faq.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(faq.id)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
