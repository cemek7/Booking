'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthHeaders } from '@/hooks/useAuthHeaders';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ArrowRight, CheckCircle2, Copy, Eye, ImagePlus, Loader2, Palette, Plus, Sparkles, Trash2, Upload } from 'lucide-react';

type ShowcaseKind = 'custom' | 'portfolio' | 'price_list' | 'catalog' | 'before_after';
type ItemType = 'image' | 'document' | 'video';

interface ShowcasePackSummary {
  id: string;
  name: string;
  template_kind: ShowcaseKind;
  description: string | null;
  intro_message: string | null;
  trigger_phrases: string[];
  fallback_cta: string;
  is_default: boolean;
  active: boolean;
  sort_order: number;
  item_count?: number;
}

interface ShowcaseItem {
  id: string;
  item_type: ItemType;
  title: string;
  caption: string | null;
  media_url: string;
  mime_type: string;
  file_name: string | null;
  file_size: number;
  cta_label: string | null;
  cta_url: string | null;
  sort_order: number;
  active: boolean;
}

interface ShowcasePackDetails extends ShowcasePackSummary {
  items: ShowcaseItem[];
}

interface PackFormState {
  name: string;
  template_kind: ShowcaseKind;
  description: string;
  intro_message: string;
  trigger_phrases: string;
  fallback_cta: string;
  is_default: boolean;
  active: boolean;
}

interface ItemFormState {
  title: string;
  caption: string;
  media_url: string;
  item_type: ItemType;
  mime_type: string;
  cta_label: string;
  cta_url: string;
  sort_order: number;
}

const TEMPLATE_PRESETS: Record<ShowcaseKind, {
  label: string;
  description: string;
  accent: string;
  starter: PackFormState;
}> = {
  portfolio: {
    label: 'Portfolio',
    description: 'Before/after work, transformations, and visual proof.',
    accent: 'from-amber-400/20 to-orange-500/20',
    starter: {
      name: 'Portfolio Pack',
      template_kind: 'portfolio',
      description: 'Visual proof for clients who want to see examples first.',
      intro_message: 'Here is a quick look at recent work so you can see the quality first.',
      trigger_phrases: 'portfolio, gallery, show me your work',
      fallback_cta: 'Reply BOOK to get started.',
      is_default: true,
      active: true,
    },
  },
  price_list: {
    label: 'Price List',
    description: 'Services, packages, and transparent pricing cards.',
    accent: 'from-emerald-400/20 to-teal-500/20',
    starter: {
      name: 'Price List Pack',
      template_kind: 'price_list',
      description: 'A clean pricing pack for service-first businesses.',
      intro_message: 'Here is our current price list so you can compare options easily.',
      trigger_phrases: 'price list, pricing, menu, rates',
      fallback_cta: 'Reply BOOK to continue.',
      is_default: true,
      active: true,
    },
  },
  catalog: {
    label: 'Catalog',
    description: 'Products, services, and quick selection cards.',
    accent: 'from-cyan-400/20 to-sky-500/20',
    starter: {
      name: 'Catalog Pack',
      template_kind: 'catalog',
      description: 'Useful for retail, menu-style offerings, and product showcases.',
      intro_message: 'Here is a curated catalog of our most requested items.',
      trigger_phrases: 'catalog, products, services',
      fallback_cta: 'Reply BOOK or ask for more details.',
      is_default: true,
      active: true,
    },
  },
  before_after: {
    label: 'Before/After',
    description: 'Transformation stories that build trust fast.',
    accent: 'from-fuchsia-400/20 to-rose-500/20',
    starter: {
      name: 'Before & After Pack',
      template_kind: 'before_after',
      description: 'Perfect for beauty, repairs, and high-trust services.',
      intro_message: 'Here are a few before-and-after examples so you can see the results.',
      trigger_phrases: 'before and after, before after, transformation',
      fallback_cta: 'Reply BOOK to book the same result.',
      is_default: true,
      active: true,
    },
  },
  custom: {
    label: 'Custom',
    description: 'Build your own pack from scratch.',
    accent: 'from-slate-400/20 to-slate-500/20',
    starter: {
      name: 'Showcase Pack',
      template_kind: 'custom',
      description: 'A flexible pack for any business use case.',
      intro_message: 'Here is a quick look at what we can show you.',
      trigger_phrases: 'showcase, show me, examples',
      fallback_cta: 'Reply BOOK to continue.',
      is_default: true,
      active: true,
    },
  },
};

function emptyPackForm(): PackFormState {
  return TEMPLATE_PRESETS.portfolio.starter;
}

function emptyItemForm(): ItemFormState {
  return {
    title: '',
    caption: '',
    media_url: '',
    item_type: 'image',
    mime_type: 'image/jpeg',
    cta_label: '',
    cta_url: '',
    sort_order: 0,
  };
}

export default function ShowcaseBuilderClient() {
  const headers = useAuthHeaders();
  const [packs, setPacks] = useState<ShowcasePackSummary[]>([]);
  const [selectedPack, setSelectedPack] = useState<ShowcasePackDetails | null>(null);
  const [packForm, setPackForm] = useState<PackFormState>(emptyPackForm());
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItemForm());
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingPack, setIsSavingPack] = useState(false);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => TEMPLATE_PRESETS[packForm.template_kind] ?? TEMPLATE_PRESETS.custom,
    [packForm.template_kind]
  );

  const loadPack = useCallback(async (packId: string, existingPacks?: ShowcasePackSummary[]) => {
    if (!headers) return;
    try {
      const res = await fetch(`/api/showcase-packs/${packId}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load showcase pack');
      setSelectedPack(data.pack as ShowcasePackDetails);
      setPackForm({
        name: data.pack.name ?? '',
        template_kind: data.pack.template_kind ?? 'custom',
        description: data.pack.description ?? '',
        intro_message: data.pack.intro_message ?? '',
        trigger_phrases: Array.isArray(data.pack.trigger_phrases) ? data.pack.trigger_phrases.join(', ') : '',
        fallback_cta: data.pack.fallback_cta ?? '',
        is_default: !!data.pack.is_default,
        active: !!data.pack.active,
      });
      setItemForm((prev) => ({ ...prev, sort_order: ((data.pack.items?.length ?? 0) + 1) * 10 }));
      if (existingPacks) {
        setPacks(existingPacks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load showcase pack');
    }
  }, [headers]);

  const loadPacks = useCallback(async () => {
    if (!headers) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/showcase-packs', { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load showcase packs');
      const nextPacks = (data.packs ?? []) as ShowcasePackSummary[];
      setPacks(nextPacks);
      if (nextPacks.length && !selectedPack) {
        await loadPack(nextPacks[0].id, nextPacks);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load showcase packs');
    } finally {
      setIsLoading(false);
    }
  }, [headers, loadPack, selectedPack]);

  useEffect(() => {
    if (!headers) return;
    void loadPacks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers]);

  useEffect(() => {
    if (!selectedPack && packs.length > 0) {
      void loadPack(packs[0].id);
    }
  }, [loadPack, packs, selectedPack]);

  const applyTemplate = (kind: ShowcaseKind) => {
    setPackForm(TEMPLATE_PRESETS[kind].starter);
  };

  const handleCreatePack = async () => {
    if (!headers) return;
    setIsSavingPack(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/showcase-packs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...packForm,
          trigger_phrases: packForm.trigger_phrases
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create showcase pack');
      setSuccess('Showcase pack created.');
      await loadPacks();
      if (data.pack?.id) {
        await loadPack(data.pack.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create showcase pack');
    } finally {
      setIsSavingPack(false);
    }
  };

  const handleUpdatePack = async () => {
    if (!headers || !selectedPack) return;
    setIsSavingPack(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/showcase-packs/${selectedPack.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ...packForm,
          trigger_phrases: packForm.trigger_phrases
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update showcase pack');
      setSuccess('Showcase pack updated.');
      await loadPacks();
      await loadPack(selectedPack.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update showcase pack');
    } finally {
      setIsSavingPack(false);
    }
  };

  const handleAddItem = async () => {
    if (!headers || !selectedPack) return;
    if (!itemForm.title.trim()) {
      setError('Item title is required');
      return;
    }
    setIsSavingItem(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append('title', itemForm.title);
      form.append('caption', itemForm.caption);
      form.append('item_type', itemForm.item_type);
      form.append('mime_type', itemForm.mime_type);
      form.append('cta_label', itemForm.cta_label);
      form.append('cta_url', itemForm.cta_url);
      form.append('sort_order', String(itemForm.sort_order));
      if (itemFile) {
        form.append('file', itemFile);
      } else {
        form.append('media_url', itemForm.media_url);
      }
      const res = await fetch(`/api/showcase-packs/${selectedPack.id}/items`, {
        method: 'POST',
        headers: {
          Authorization: headers.Authorization,
          'x-tenant-id': headers['x-tenant-id'],
        },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to add showcase item');
      setSuccess('Showcase item added.');
      setItemForm(emptyItemForm());
      setItemFile(null);
      await loadPack(selectedPack.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add showcase item');
    } finally {
      setIsSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!headers || !selectedPack) return;
    if (!confirm('Delete this showcase item?')) return;
    try {
      const res = await fetch(`/api/showcase-packs/${selectedPack.id}/items?id=${itemId}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete item');
      await loadPack(selectedPack.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  const handleDeletePack = async () => {
    if (!headers || !selectedPack) return;
    if (!confirm(`Delete "${selectedPack.name}"? This removes all items too.`)) return;
    try {
      const res = await fetch(`/api/showcase-packs/${selectedPack.id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete showcase pack');
      setSelectedPack(null);
      setPackForm(emptyPackForm());
      setItemForm(emptyItemForm());
      await loadPacks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete showcase pack');
    }
  };

  if (!headers && isLoading) {
    return <div className="p-6 text-sm text-slate-500">Loading showcase workspace...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.12),_transparent_28%),linear-gradient(135deg,_#ffffff,_#fafafa)] shadow-sm">
        <div className="flex flex-col gap-6 p-6 lg:p-8 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge variant="outline" className="w-fit rounded-full border-slate-200 bg-white px-3 py-1 text-slate-600">
              WhatsApp showcase packs
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Create a visual pack for chat</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Build a reusable gallery, price list, or before/after pack and send it in WhatsApp as a guided showcase instead of plain text.
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Templates</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">4</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Media types</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">Image, PDF, Video</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Trigger</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">Portfolio words</div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Palette className="h-5 w-5 text-amber-500" />
                Template starter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(Object.entries(TEMPLATE_PRESETS) as Array<[ShowcaseKind, typeof TEMPLATE_PRESETS[ShowcaseKind]]>).map(([kind, preset]) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => applyTemplate(kind)}
                  className={cn(
                    'group w-full rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md',
                    'border-slate-200 bg-white'
                  )}
                >
                  <div className={`mb-3 h-1.5 rounded-full bg-gradient-to-r ${preset.accent}`} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">{preset.label}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">{preset.description}</p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Saved packs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading packs...
                </div>
              ) : packs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  No packs yet. Create your first showcase pack on the right.
                </div>
              ) : (
                packs.map((pack) => (
                  <button
                    type="button"
                    key={pack.id}
                    onClick={() => void loadPack(pack.id)}
                    className={cn(
                      'w-full rounded-2xl border p-4 text-left transition hover:border-slate-300 hover:bg-slate-50',
                      selectedPack?.id === pack.id ? 'border-slate-900 bg-slate-50 shadow-sm' : 'border-slate-200 bg-white'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{pack.name}</span>
                          {pack.is_default && <Badge variant="outline">Default</Badge>}
                          {!pack.active && <Badge variant="secondary">Paused</Badge>}
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{pack.description || pack.intro_message}</p>
                      </div>
                      <div className="text-right text-xs text-slate-400">
                        <div>{pack.item_count ?? 0} items</div>
                        <div className="capitalize">{pack.template_kind.replace('_', ' ')}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-amber-500" />
                {selectedPack ? 'Edit selected pack' : 'Create your first pack'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Pack name</label>
                  <Input value={packForm.name} onChange={(e) => setPackForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Portfolio Pack" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Template type</label>
                  <select
                    className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={packForm.template_kind}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, template_kind: e.target.value as ShowcaseKind }))}
                  >
                    <option value="portfolio">Portfolio</option>
                    <option value="price_list">Price list</option>
                    <option value="catalog">Catalog</option>
                    <option value="before_after">Before / After</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Intro message</label>
                  <Textarea
                    value={packForm.intro_message}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, intro_message: e.target.value }))}
                    placeholder="Here is a quick look at our work."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Fallback CTA</label>
                  <Textarea
                    value={packForm.fallback_cta}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, fallback_cta: e.target.value }))}
                    placeholder="Reply BOOK to continue."
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Trigger phrases</label>
                  <Textarea
                    value={packForm.trigger_phrases}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, trigger_phrases: e.target.value }))}
                    placeholder="portfolio, gallery, show me your work"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">Description</label>
                  <Textarea
                    value={packForm.description}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="What this pack helps clients decide."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={packForm.is_default}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, is_default: e.target.checked }))}
                  />
                  Default pack
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={packForm.active}
                    onChange={(e) => setPackForm((prev) => ({ ...prev, active: e.target.checked }))}
                  />
                  Active
                </label>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={selectedPack ? handleUpdatePack : handleCreatePack} disabled={isSavingPack} className="gap-2">
                  {isSavingPack ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {selectedPack ? 'Save pack' : 'Create pack'}
                </Button>
                {selectedPack && (
                  <Button variant="outline" onClick={handleDeletePack} className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Delete pack
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {selectedPack ? (
            <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <ImagePlus className="h-5 w-5 text-amber-500" />
                    Pack items
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(selectedPack.items || []).length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
                      Add the first image, document, or short video to turn this pack into a chat-ready artifact.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(selectedPack.items || []).map((item) => (
                        <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                          <div className="flex flex-col gap-4 p-4 lg:flex-row">
                            <div className="relative h-28 w-full overflow-hidden rounded-xl bg-slate-100 lg:w-40">
                              {item.item_type === 'document' ? (
                                <div className="flex h-full items-center justify-center text-slate-500">
                                  <FileTextIcon />
                                </div>
                              ) : (
                                <img src={item.media_url} alt={item.title} className="h-full w-full object-cover" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
                                    <Badge variant="outline" className="capitalize">{item.item_type}</Badge>
                                    {!item.active && <Badge variant="secondary">Inactive</Badge>}
                                  </div>
                                  <p className="mt-1 text-sm leading-6 text-slate-500">{item.caption || 'No caption yet.'}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteItem(item.id)}
                                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-rose-600"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                <span className="rounded-full bg-slate-100 px-3 py-1">{item.mime_type}</span>
                                <span className="rounded-full bg-slate-100 px-3 py-1">{Math.max(1, Math.round(item.file_size / 1024))} KB</span>
                                {item.cta_label && <span className="rounded-full bg-slate-100 px-3 py-1">{item.cta_label}</span>}
                              </div>
                              {item.cta_url && (
                                <a href={item.cta_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 hover:underline">
                                  Open link
                                  <ArrowRight className="h-3.5 w-3.5" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Upload className="h-5 w-5 text-amber-500" />
                    Add media item
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Title</label>
                    <Input value={itemForm.title} onChange={(e) => setItemForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Braids transformation" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Caption</label>
                    <Textarea value={itemForm.caption} onChange={(e) => setItemForm((prev) => ({ ...prev, caption: e.target.value }))} placeholder="Short context for the client." />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">Media type</label>
                      <select
                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                        value={itemForm.item_type}
                        onChange={(e) => setItemForm((prev) => ({ ...prev, item_type: e.target.value as ItemType }))}
                      >
                        <option value="image">Image</option>
                        <option value="document">Document / PDF</option>
                        <option value="video">Video</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">MIME type</label>
                      <Input value={itemForm.mime_type} onChange={(e) => setItemForm((prev) => ({ ...prev, mime_type: e.target.value }))} placeholder="image/jpeg" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Upload file</label>
                    <Input type="file" accept="image/*,video/*,application/pdf" onChange={(e) => setItemFile(e.target.files?.[0] ?? null)} />
                    <p className="text-xs text-slate-500">Uploading a file is preferred. You can also paste a public media URL below.</p>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Or paste media URL</label>
                    <Input value={itemForm.media_url} onChange={(e) => setItemForm((prev) => ({ ...prev, media_url: e.target.value }))} placeholder="https://..." />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">CTA label</label>
                      <Input value={itemForm.cta_label} onChange={(e) => setItemForm((prev) => ({ ...prev, cta_label: e.target.value }))} placeholder="Book this look" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">CTA URL</label>
                      <Input value={itemForm.cta_url} onChange={(e) => setItemForm((prev) => ({ ...prev, cta_url: e.target.value }))} placeholder="https://wa.me/..." />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Sort order</label>
                    <Input
                      type="number"
                      value={itemForm.sort_order}
                      onChange={(e) => setItemForm((prev) => ({ ...prev, sort_order: Number(e.target.value) }))}
                    />
                  </div>

                  <Button onClick={handleAddItem} disabled={isSavingItem} className="w-full gap-2">
                    {isSavingItem ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Add to pack
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-slate-500">
                Select or create a pack to start adding media items.
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Eye className="h-5 w-5 text-amber-500" />
                WhatsApp preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-3xl border border-slate-200 bg-slate-950 p-4 text-white shadow-xl">
                <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.24em] text-slate-400">
                  <span>Showcase preview</span>
                  <span className="text-emerald-300">Native chat flow</span>
                </div>
                <div className="space-y-3">
                  <div className="max-w-xl rounded-2xl rounded-bl-md bg-slate-800 px-4 py-3 text-sm leading-6 text-slate-100">
                    {packForm.intro_message}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(selectedPack?.items?.length ? selectedPack.items : []).slice(0, 3).map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900">
                        {item.item_type === 'document' ? (
                          <div className="flex h-40 items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-300">
                            <div className="text-center">
                              <div className="mb-2 text-3xl">PDF</div>
                              <div className="text-xs">{item.file_name || item.title}</div>
                            </div>
                          </div>
                        ) : (
                          <img src={item.media_url} alt={item.title} className="h-40 w-full object-cover" />
                        )}
                        <div className="space-y-2 p-3">
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                          <p className="text-xs leading-5 text-slate-300">{item.caption || 'No caption added yet.'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-4 py-2 text-sm text-amber-200">
                    <CheckCircle2 className="h-4 w-4" />
                    {packForm.fallback_cta || selectedTemplate.starter.fallback_cta}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function FileTextIcon() {
  return <Copy className="h-7 w-7 text-slate-400" />;
}
