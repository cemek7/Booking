'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authGet, authPatch } from '@/lib/auth/auth-api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Input from '@/components/ui/input';

type Platform = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'twitter' | 'x';

interface ListeningConfig {
  businessName: string;
  handles: string[];
  keywords: string[];
  platforms: Platform[];
  enabled: boolean;
  lastPolledAt: string | null;
}

const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'x', label: 'X' },
];

function toList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function prettyDate(value: string | null) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function ListeningConfigForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [handles, setHandles] = useState('');
  const [keywords, setKeywords] = useState('');
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram']);
  const [enabled, setEnabled] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authGet<{ config: ListeningConfig }>('/api/listening/config');
      if (response.error) throw new Error(response.error.message);
      const config = response.data?.config;
      if (!config) throw new Error('Missing listening config response');
      setBusinessName(config.businessName);
      setHandles(config.handles.join(', '));
      setKeywords(config.keywords.join(', '));
      setPlatforms(config.platforms.length ? config.platforms : ['instagram']);
      setEnabled(config.enabled);
      setLastPolledAt(config.lastPolledAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load listening config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedLabels = useMemo(
    () => PLATFORM_OPTIONS.filter((option) => platforms.includes(option.value)).map((option) => option.label),
    [platforms]
  );

  const togglePlatform = (platform: Platform) => {
    setPlatforms((current) => {
      if (current.includes(platform)) {
        const next = current.filter((item) => item !== platform);
        return next.length ? next : current;
      }
      return [...current, platform];
    });
  };

  const save = async () => {
    if (!businessName.trim()) {
      setError('Business name is required');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authPatch<{ config: ListeningConfig }>('/api/listening/config', {
        businessName: businessName.trim(),
        handles: toList(handles),
        keywords: toList(keywords),
        platforms,
        enabled,
      });
      if (response.error) throw new Error(response.error.message);
      const config = response.data?.config;
      if (config) {
        setLastPolledAt(config.lastPolledAt);
      }
      setMessage('Listening configuration saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save listening config');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Listening configuration</h3>
          <p className="mt-1 text-xs text-slate-500">
            Define how Booka should look for mentions of this business across public social platforms.
          </p>
        </div>
        <Badge variant={enabled ? 'default' : 'outline'}>{enabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>

      {loading ? <div className="mt-4 text-sm text-slate-500">Loading configuration…</div> : null}
      {error ? <div className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div> : null}
      {message ? <div className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</div> : null}

      {!loading ? (
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Business name</label>
            <Input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder="Glow Salon" />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Handles</label>
            <Input
              value={handles}
              onChange={(event) => setHandles(event.target.value)}
              placeholder="@glowsalon, @glowlagos"
            />
            <p className="mt-1 text-xs text-slate-500">Comma-separated. Include the @ if the platform uses one.</p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-700">Keywords</label>
            <Input
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder="balayage, lagos salon, glow salon ikeja"
            />
            <p className="mt-1 text-xs text-slate-500">Comma-separated phrases that reduce false positives.</p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-slate-700">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {PLATFORM_OPTIONS.map((option) => {
                const active = platforms.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => togglePlatform(option.value)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      active
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Selected: {selectedLabels.length ? selectedLabels.join(', ') : 'None'}
            </p>
          </div>

          <label className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <div>
              <div className="text-sm font-medium text-slate-900">Enable social listening</div>
              <div className="text-xs text-slate-500">When enabled, the cron job will poll for new mentions using the configured provider.</div>
            </div>
          </label>

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">Last polled: {prettyDate(lastPolledAt)}</div>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save configuration'}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
