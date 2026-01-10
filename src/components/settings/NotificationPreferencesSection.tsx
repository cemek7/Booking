"use client";
import { useState } from 'react';
import { FormSection } from './FormSection';

export interface NotificationPreferencesValues {
  reminderLead?: number; // minutes
  secondReminderLead?: number; // minutes
  defaultChannels?: string[];
  optInPolicy?: string;
  notifyFrom?: string;
  customReminderMessage?: string;
}

const CHANNELS = ['whatsapp','email','sms'];

export function NotificationPreferencesSection({ values, onChange }: { values: NotificationPreferencesValues; onChange: (patch: Partial<NotificationPreferencesValues>) => void }) {
  const [local, setLocal] = useState<NotificationPreferencesValues>(values);
  function update<K extends keyof NotificationPreferencesValues>(k: K, v: NotificationPreferencesValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }

  function toggleChannel(ch: string) {
    const set = new Set(local.defaultChannels||[]);
    if (set.has(ch)) { set.delete(ch); } else { set.add(ch); }
    update('defaultChannels', Array.from(set));
  }

  return (
    <div className="space-y-6">
      <FormSection title="Timing" description="Configure when reminders are sent.">
        <div className="flex flex-wrap gap-6 items-end">
          <label className="flex flex-col gap-1 text-xs font-medium w-40">Lead (minutes)
            <input type="number" className="border rounded px-2 py-1 text-sm" value={local.reminderLead || 120} onChange={e=>update('reminderLead', parseInt(e.target.value)||0)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium w-56">Second Reminder (minutes before)
            <input type="number" className="border rounded px-2 py-1 text-sm" value={local.secondReminderLead || 0} onChange={e=>update('secondReminderLead', parseInt(e.target.value)||0)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium w-48">Opt-in Policy
            <select className="border rounded px-2 py-1 text-sm" value={local.optInPolicy||'implicit'} onChange={e=>update('optInPolicy', e.target.value)}>
              <option value="implicit">Implicit (existing customers)</option>
              <option value="explicit">Explicit consent required</option>
            </select>
          </label>
        </div>
      </FormSection>
      <FormSection title="Channels" description="Default delivery media used for new reminders.">
        <div className="flex gap-2 flex-wrap">
          {CHANNELS.map(ch => {
            const active = (local.defaultChannels||[]).includes(ch);
            return (
              <button key={ch} onClick={()=>toggleChannel(ch)} type="button" className={`px-3 py-1 rounded text-[11px] border ${active? 'bg-indigo-600 text-white border-indigo-600':'bg-white'}`}>{ch}</button>
            );
          })}
        </div>
      </FormSection>
      <FormSection title="Content" description="Customize sender identity & reminder wording.">
        <label className="flex flex-col gap-1 text-xs font-medium">Sender Email
          <input type="email" className="border rounded px-2 py-1 text-sm" value={local.notifyFrom || ''} onChange={e=>update('notifyFrom', e.target.value)} placeholder="noreply@yourbrand.com" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">Custom Reminder Message
          <textarea className="border rounded px-2 py-1 text-sm h-28" value={local.customReminderMessage || ''} onChange={e=>update('customReminderMessage', e.target.value)} placeholder="Hi {name}, your {service} is at {time} on {date}. Reply 1 to confirm or 2 to reschedule." />
        </label>
        <p className="text-[10px] text-gray-500">Use placeholders: {`{name}`}, {`{service}`}, {`{time}`}, {`{date}`}</p>
      </FormSection>
    </div>
  );
}
