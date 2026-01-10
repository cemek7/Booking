"use client";
import { useState, useEffect } from 'react';
import { FormSection } from './FormSection';
import { useTenant } from '@/lib/supabase/tenant-context';

export interface ServiceDraft { id?: string; name: string; description?: string; duration?: number; price?: number; category?: string; is_active?: boolean; skills?: string[]; }
export interface BusinessProfileValues {
  requireDeposit?: boolean;
  services?: ServiceDraft[];
  defaultCurrency?: string;
  depositPercent?: number;
  cancellationPolicy?: string;
  businessHours?: Record<string, { open?: string; close?: string; closed?: boolean }>;
  staffAssignmentStrategy?: 'round_robin' | 'preferred' | 'skill_based';
  allowOverbooking?: boolean;
}

export function BusinessProfileSection({ values, onChange }: { values: BusinessProfileValues; onChange: (patch: Partial<BusinessProfileValues>) => void }) {
  const [local, setLocal] = useState<BusinessProfileValues>(values);
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    async function load() {
      if (!tenantId) return;
      try {
        const res = await fetch(`/api/skills?tenant_id=${tenantId}`);
        if (!res.ok) return;
        const json = await res.json();
        const list = (json?.skills || json?.data || [])
          .map((s: { id?: string; name?: string }) => ({ id: s.id || s.name || '', name: s.name || s.id || '' }))
          .filter((x: { id: string; name: string }) => x.id && x.name);
        setSkills(list);
      } catch {}
    }
    load();
  }, [tenantId]);

  function update<K extends keyof BusinessProfileValues>(k: K, v: BusinessProfileValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }

  function addService() {
    const next = [...(local.services||[]), { name: '', description: '', duration: 30, price: 0, category: '', is_active: true }];
    update('services', next);
  }
  function editService(idx: number, patch: Partial<ServiceDraft>) {
    const list = (local.services||[]).slice();
    list[idx] = { ...list[idx], ...patch };
    update('services', list);
  }
  function removeService(idx: number) {
    const list = (local.services||[]).slice();
    list.splice(idx,1);
    update('services', list);
  }

  return (
    <div className="space-y-6">
      <FormSection title="Booking Policies" description="Govern deposits, staff assignment, and overbooking safety.">
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={!!local.requireDeposit} onChange={e=>update('requireDeposit', e.target.checked)} /> Require deposit
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium w-28">Deposit %
            <input type="number" className="border rounded px-2 py-1 text-sm" value={local.depositPercent ?? 0} onChange={e=>update('depositPercent', Math.max(0, Math.min(100, parseFloat(e.target.value)||0)))} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium w-32">Currency
            <input className="border rounded px-2 py-1 text-sm" value={local.defaultCurrency || 'NGN'} onChange={e=>update('defaultCurrency', e.target.value.toUpperCase())} placeholder="NGN" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium w-40">Assignment
            <select className="border rounded px-2 py-1 text-sm" value={local.staffAssignmentStrategy || 'round_robin'} onChange={e=>update('staffAssignmentStrategy', e.target.value as 'round_robin'|'preferred'|'skill_based')}>
              <option value="round_robin">Round robin</option>
              <option value="preferred">Preferred</option>
              <option value="skill_based">Skill-based</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={!!local.allowOverbooking} onChange={e=>update('allowOverbooking', e.target.checked)} /> Allow overbooking
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium">Cancellation Policy
          <textarea className="border rounded px-2 py-1 text-sm h-20" value={local.cancellationPolicy || ''} onChange={e=>update('cancellationPolicy', e.target.value)} placeholder="24h notice required..." />
        </label>
      </FormSection>
      <FormSection title="Business Hours" description="Set open/close times per day. Use bulk shortcuts for speed." aside={<button type="button" className="px-2 py-1 rounded border text-[11px]" onClick={()=>update('businessHours', {})}>Clear All</button>}>
        <BusinessHoursGrid value={local.businessHours || {}} onChange={(v)=>update('businessHours', v)} />
        <HoursSummary value={local.businessHours || {}} />
      </FormSection>
      <FormSection title="Services Catalog" description="Manage offerings, pricing, and required staff skills." aside={<button onClick={addService} className="px-2 py-1 rounded border text-xs" type="button">Add Service</button>}>
        {(local.services||[]).length === 0 && <div className="text-xs text-gray-500">No services defined.</div>}
        <ul className="space-y-3">
          {(local.services||[]).map((svc, i) => (
            <li key={i} className="border rounded p-3 space-y-2 bg-white/60">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="flex flex-col gap-1 text-[11px] font-medium">Name
                  <input value={svc.name} onChange={e=>editService(i,{ name: e.target.value })} placeholder="Service name" className="border rounded px-2 py-1 text-xs" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium">Category
                  <input value={svc.category||''} onChange={e=>editService(i,{ category: e.target.value })} className="border rounded px-2 py-1 text-xs" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] font-medium">Active
                  <input type="checkbox" checked={svc.is_active!==false} onChange={e=>editService(i,{ is_active: e.target.checked })} />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-[11px] font-medium">Description
                <textarea value={svc.description||''} onChange={e=>editService(i,{ description: e.target.value })} placeholder="Description" className="border rounded px-2 py-1 text-xs h-16" />
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-1 text-[11px]">Duration
                  <input type="number" value={svc.duration||0} onChange={e=>editService(i,{ duration: parseInt(e.target.value)||0 })} className="border rounded px-2 py-1 text-[11px] w-20" />
                </label>
                <label className="flex items-center gap-1 text-[11px]">Price
                  <input type="number" value={svc.price||0} onChange={e=>editService(i,{ price: parseFloat(e.target.value)||0 })} className="border rounded px-2 py-1 text-[11px] w-24" />
                </label>
                <button onClick={()=>removeService(i)} type="button" className="text-red-600 text-[11px] ml-auto">Remove</button>
              </div>
              <div className="space-y-1">
                <div className="text-[11px] font-medium">Skills</div>
                <div className="flex flex-wrap gap-1">
                  {skills.map(sk => {
                    const active = (svc.skills||[]).includes(sk.id);
                    return (
                      <button
                        key={sk.id}
                        onClick={() => {
                          const set = new Set(svc.skills||[]);
                          if (set.has(sk.id)) { set.delete(sk.id); } else { set.add(sk.id); }
                          editService(i, { skills: Array.from(set) });
                        }}
                        className={`px-2 py-0.5 rounded border text-[10px] ${active ? 'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}
                        type="button"
                      >{sk.name}</button>
                    );
                  })}
                  {skills.length===0 && <span className="text-[10px] text-gray-500">No skills loaded</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-gray-500">Catalog edits currently stored in settings JSON; future: dedicated tables.</p>
      </FormSection>
    </div>
  );
}

function BusinessHoursGrid({ value, onChange }: { value: Record<string, { open?: string; close?: string; closed?: boolean }>; onChange: (v: Record<string, { open?: string; close?: string; closed?: boolean }>) => void }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  function mutate(day: string, patch: Partial<{ open?: string; close?: string; closed?: boolean }>) {
    onChange({ ...value, [day]: { ...(value[day]||{}), ...patch } });
  }
  function applyTemplate(templateDay: string) {
    const base = value[templateDay] || {};
    const next: Record<string, { open?: string; close?: string; closed?: boolean }> = {};
    for (const d of days) next[d] = { ...base };
    onChange(next);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <button type="button" className="px-2 py-1 rounded border" onClick={()=>applyTemplate('Mon')}>Copy Mon to all</button>
        <button type="button" className="px-2 py-1 rounded border" onClick={()=>applyTemplate('Sat')}>Copy Sat to weekend</button>
      </div>
      <div className="divide-y border rounded">
        {days.map(d => {
          const v = value[d] || {};
          return (
            <div key={d} className="grid grid-cols-[60px_1fr_1fr_70px] items-center gap-2 p-2 text-[11px]">
              <span className="font-medium">{d}</span>
              <label className="flex items-center gap-1">Open
                <input type="time" className="border rounded px-1 py-0.5" value={v.open || ''} disabled={v.closed} onChange={e=>mutate(d,{ open: e.target.value })} />
              </label>
              <label className="flex items-center gap-1">Close
                <input type="time" className="border rounded px-1 py-0.5" value={v.close || ''} disabled={v.closed} onChange={e=>mutate(d,{ close: e.target.value })} />
              </label>
              <label className="flex items-center gap-1">Closed
                <input type="checkbox" checked={!!v.closed} onChange={e=>mutate(d,{ closed: e.target.checked })} />
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HoursSummary({ value }: { value: Record<string, { open?: string; close?: string; closed?: boolean }> }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const first = value['Mon'] || {};
  const uniform = days.every(d => JSON.stringify(value[d]||{}) === JSON.stringify(first||{}));
  if (uniform && first && (first.closed || (first.open && first.close))) {
    if (first.closed) return <div className="text-[11px] text-gray-600">Closed all week</div>;
    return <div className="text-[11px] text-gray-600">{first.open}–{first.close}, all week</div>;
  }
  const parts = days.map(d => {
    const v = value[d] || {};
    if (v.closed) return `${d}: closed`;
    if (v.open && v.close) return `${d}: ${v.open}–${v.close}`;
    return `${d}: —`;
  });
  return <div className="text-[11px] text-gray-600 wrap-break-word">{parts.join(' · ')}</div>;
}
