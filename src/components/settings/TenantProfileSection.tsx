"use client";
import { useState } from 'react';
import { FormSection } from './FormSection';

export interface TenantProfileValues {
  displayName?: string;
  timezone?: string;
  brandingColor?: string;
  contactEmail?: string;
  locale?: string;
  tone?: string;
  styleGuidelines?: string;
  voiceParameters?: Record<string, unknown> | undefined;
  samplePhrases?: string[];
  brandTagline?: string;
  greeting?: string;
  signature?: string;
}

export function TenantProfileSection({ values, onChange }: { values: TenantProfileValues; onChange: (patch: Partial<TenantProfileValues>) => void }) {
  const [local, setLocal] = useState<TenantProfileValues>(values);
  function update<K extends keyof TenantProfileValues>(k: K, v: TenantProfileValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }
  const [phraseInput, setPhraseInput] = useState('');
  function addPhrase() {
    const list = [...(local.samplePhrases||[])];
    if (phraseInput.trim()) list.push(phraseInput.trim());
    update('samplePhrases', list);
    setPhraseInput('');
  }
  function removePhrase(idx: number) {
    const list = [...(local.samplePhrases||[])];
    list.splice(idx,1);
    update('samplePhrases', list);
  }
  function handleVoiceParameters(raw: string) {
    if (!raw.trim()) { update('voiceParameters', undefined); return; }
    try {
      const parsed = JSON.parse(raw);
      update('voiceParameters', parsed);
    } catch {
      // leave invalid JSON in local state (not persisted) by storing a marker
    }
  }
  // Common timezone suggestions; free-form still allowed.
  const tzHints = ['UTC','Africa/Lagos','Europe/London','America/New_York','America/Los_Angeles','Asia/Dubai','Asia/Kolkata'];

  return (
    <div className="space-y-6">
      <FormSection title="Brand Identity" description="Core display info & localization for your tenant.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">Display Name
            <input className="border rounded px-2 py-1 text-sm" value={local.displayName || ''} onChange={e=>update('displayName', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Brand Tagline
            <input className="border rounded px-2 py-1 text-sm" value={local.brandTagline || ''} onChange={e=>update('brandTagline', e.target.value)} placeholder="e.g. Beauty that fits your day" />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs font-medium">Timezone
            <input list="tz-hints" className="border rounded px-2 py-1 text-sm" value={local.timezone || ''} onChange={e=>update('timezone', e.target.value)} placeholder="Africa/Lagos" />
            <datalist id="tz-hints">{tzHints.map(t=> <option key={t} value={t} />)}</datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Locale
            <input className="border rounded px-2 py-1 text-sm" value={local.locale || ''} onChange={e=>update('locale', e.target.value)} placeholder="en-US" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Brand Color
            <input type="color" className="border rounded px-2 py-1 text-sm h-9" value={local.brandingColor || '#4f46e5'} onChange={e=>update('brandingColor', e.target.value)} />
          </label>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">Contact Email
            <input className="border rounded px-2 py-1 text-sm" value={local.contactEmail || ''} onChange={e=>update('contactEmail', e.target.value)} placeholder="support@example.com" />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium">Greeting
              <input className="border rounded px-2 py-1 text-sm" value={local.greeting || ''} onChange={e=>update('greeting', e.target.value)} placeholder="Hi {name}, thanks for reaching out!" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">Signature
              <input className="border rounded px-2 py-1 text-sm" value={local.signature || ''} onChange={e=>update('signature', e.target.value)} placeholder="– Team" />
            </label>
          </div>
        </div>
      </FormSection>
      <FormSection title="LLM Tone & Guidance" description="Provide examples & style rules so automated replies match your brand voice." aside={<span className="text-[10px] leading-tight">JSON parsed on blur; phrases help fine-tune prompts.</span>}>
        <label className="flex flex-col gap-1 text-xs font-medium">Tone / Voice Adjectives
          <input className="border rounded px-2 py-1 text-sm" value={local.tone || ''} onChange={e=>update('tone', e.target.value)} placeholder="friendly, concise, professional" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Style Guidelines
          <textarea className="border rounded px-2 py-1 text-sm h-24" value={local.styleGuidelines || ''} onChange={e=>update('styleGuidelines', e.target.value)} placeholder="Do: keep replies under 2 sentences..." />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Voice Parameters (JSON)
          <textarea className="border rounded px-2 py-1 text-xs h-28" defaultValue={local.voiceParameters ? JSON.stringify(local.voiceParameters, null, 2) : ''} onBlur={e=>handleVoiceParameters(e.target.value)} placeholder='{"formality":"medium","emoji":false}' />
        </label>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input className="border rounded px-2 py-1 text-xs flex-1" value={phraseInput} onChange={e=>setPhraseInput(e.target.value)} placeholder="Add sample phrase" />
            <button type="button" onClick={addPhrase} className="px-2 py-1 rounded border text-[11px]">Add</button>
          </div>
          <ul className="space-y-1 max-h-36 overflow-auto">
            {(local.samplePhrases||[]).map((p,i)=> (
              <li key={i} className="flex items-center gap-2 text-[11px] bg-white/60 border rounded px-2 py-1">
                <span className="flex-1 truncate" title={p}>{p}</span>
                <button type="button" onClick={()=>removePhrase(i)} className="text-red-600">✕</button>
              </li>
            ))}
            {(local.samplePhrases||[]).length === 0 && <li className="text-[11px] text-gray-500">No phrases added.</li>}
          </ul>
        </div>
      </FormSection>
    </div>
  );
}
