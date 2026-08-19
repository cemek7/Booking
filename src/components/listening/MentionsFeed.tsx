'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { authGet, authPost } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Input from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface Mention {
  id: string;
  platform: string;
  author?: string | null;
  content?: string | null;
  url?: string | null;
  status: string;
}

export default function MentionsFeed() {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [convertForm, setConvertForm] = useState({ phone: '', name: '', email: '', notes: '' });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await authGet<{ mentions: Mention[] }>('/api/listening/mentions?status=new');
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setMentions(response.data?.mentions ?? []);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = useCallback(async (id: string, status: 'engaged' | 'dismissed') => {
    setBusyId(id);
    setError(null);
    try {
      const response = await authPost(`/api/listening/mentions/${id}`, { status });
      if (response.error) throw new Error(response.error.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update mention');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const convert = useCallback(async (id: string) => {
    if (!convertForm.phone.trim()) {
      setError('Phone is required to convert a mention to a lead');
      return;
    }

    setBusyId(id);
    setError(null);
    try {
      const response = await authPost(`/api/listening/mentions/${id}/convert`, {
        phone: convertForm.phone.trim(),
        name: convertForm.name.trim() || undefined,
        email: convertForm.email.trim() || undefined,
        notes: convertForm.notes.trim() || undefined,
      });
      if (response.error) throw new Error(response.error.message);
      setConvertId(null);
      setConvertForm({ phone: '', name: '', email: '', notes: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert mention');
    } finally {
      setBusyId(null);
    }
  }, [convertForm, load]);

  return (
    <section className="rounded-lg border border-[#e7e3d7] bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#10211a]">Social mentions</h3>
          <p className="mt-1 text-xs text-slate-500">New mentions that may need engagement or lead follow-up.</p>
        </div>
        <Badge variant="outline">{mentions.length} new</Badge>
      </div>

      {error ? <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}

      <ul className="mt-3 space-y-3">
        {mentions.map((mention) => (
          <li key={mention.id} className="rounded border border-[#e7e3d7] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-[#3a4a43]">
                  {mention.platform}
                  {mention.author ? ` · ${mention.author}` : ''}
                </p>
                <p className="mt-1 text-sm text-[#10211a]">{mention.content}</p>
                {mention.url ? (
                  <a href={mention.url} className="mt-2 inline-block text-xs underline" target="_blank" rel="noopener noreferrer">
                    View post
                  </a>
                ) : null}
              </div>
              <Badge variant="outline">{mention.status}</Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busyId === mention.id} onClick={() => void setStatus(mention.id, 'engaged')}>
                Mark engaged
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={busyId === mention.id} onClick={() => void setStatus(mention.id, 'dismissed')}>
                Dismiss
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={busyId === mention.id}
                onClick={() => setConvertId((current) => (current === mention.id ? null : mention.id))}
              >
                Convert to lead
              </Button>
            </div>

            {convertId === mention.id ? (
              <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Input
                  placeholder="Phone number"
                  value={convertForm.phone}
                  onChange={(event) => setConvertForm((current) => ({ ...current, phone: event.target.value }))}
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <Input
                    placeholder="Name (optional)"
                    value={convertForm.name}
                    onChange={(event) => setConvertForm((current) => ({ ...current, name: event.target.value }))}
                  />
                  <Input
                    placeholder="Email (optional)"
                    value={convertForm.email}
                    onChange={(event) => setConvertForm((current) => ({ ...current, email: event.target.value }))}
                  />
                </div>
                <Textarea
                  placeholder="Notes"
                  value={convertForm.notes}
                  onChange={(event) => setConvertForm((current) => ({ ...current, notes: event.target.value }))}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={busyId === mention.id} onClick={() => void convert(mention.id)}>
                    Save lead
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busyId === mention.id}
                    onClick={() => {
                      setConvertId(null);
                      setConvertForm({ phone: '', name: '', email: '', notes: '' });
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {mentions.length === 0 ? (
        <div className="mt-4 rounded border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
          No new mentions right now.
        </div>
      ) : null}
    </section>
  );
}
