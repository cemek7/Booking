"use client";
import { useState } from 'react';
import { FormSection } from './FormSection';

export interface WhatsAppSyncValues {
  whatsappNumber?: string;
  templateNamespace?: string;
  integrationStatus?: string;
  channelConfig?: {
    whatsapp?: {
      status?: string;
      mode?: 'shared_booka_number' | 'dedicated_number';
      ownerCommandPhone?: string;
      sendBookingAlerts?: boolean;
      sendDailySummary?: boolean;
      sendWeeklySummary?: boolean;
      sendCancellationAlerts?: boolean;
    };
    instagram?: {
      handle?: string;
      profileUrl?: string;
      dmGoal?: 'bookings' | 'lead_capture' | 'support';
      useDmReplies?: boolean;
    };
  };
}

export function WhatsAppSyncSection({ values, onChange }: { values: WhatsAppSyncValues; onChange: (patch: Partial<WhatsAppSyncValues>) => void }) {
  const [local, setLocal] = useState<WhatsAppSyncValues>(values);
  function update<K extends keyof WhatsAppSyncValues>(k: K, v: WhatsAppSyncValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }
  function updateInstagram(
    patch: Partial<NonNullable<NonNullable<WhatsAppSyncValues['channelConfig']>['instagram']>>
  ) {
    const next = {
      ...(local.channelConfig || {}),
      instagram: {
        handle: '',
        profileUrl: '',
        dmGoal: 'bookings' as const,
        useDmReplies: true,
        ...(local.channelConfig?.instagram || {}),
        ...patch,
      },
    };
    setLocal((prev) => ({ ...prev, channelConfig: next }));
    onChange({ channelConfig: next });
  }
  function updateWhatsApp(
    patch: Partial<NonNullable<NonNullable<WhatsAppSyncValues['channelConfig']>['whatsapp']>>
  ) {
    const next = {
      ...(local.channelConfig || {}),
      whatsapp: {
        mode: 'shared_booka_number' as const,
        sendBookingAlerts: true,
        sendDailySummary: true,
        sendWeeklySummary: false,
        sendCancellationAlerts: true,
        ...(local.channelConfig?.whatsapp || {}),
        ...patch,
      },
    };
    setLocal((prev) => ({ ...prev, channelConfig: next }));
    onChange({ channelConfig: next });
  }
  return (
    <div className="space-y-6">
      <FormSection title="Owner Command Channel" description="Register the owner WhatsApp number Booka uses for alerts, summaries, and human escalations." aside={<span className="text-[10px]">Mode: {local.channelConfig?.whatsapp?.mode || 'shared_booka_number'}</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">Shared Booka Number
            <input className="border rounded px-2 py-1 text-sm" value={local.whatsappNumber||''} onChange={e=>update('whatsappNumber', e.target.value)} placeholder="Optional display/reference number" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Owner WhatsApp
            <input className="border rounded px-2 py-1 text-sm" value={local.channelConfig?.whatsapp?.ownerCommandPhone || ''} onChange={e=>updateWhatsApp({ ownerCommandPhone: e.target.value })} placeholder="+2348012345678" />
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-[11px]">
          <label className="flex items-center gap-2 rounded border px-3 py-2">
            <input type="checkbox" checked={local.channelConfig?.whatsapp?.sendBookingAlerts ?? true} onChange={e=>updateWhatsApp({ sendBookingAlerts: e.target.checked })} />
            <span>Send new booking alerts</span>
          </label>
          <label className="flex items-center gap-2 rounded border px-3 py-2">
            <input type="checkbox" checked={local.channelConfig?.whatsapp?.sendCancellationAlerts ?? true} onChange={e=>updateWhatsApp({ sendCancellationAlerts: e.target.checked })} />
            <span>Send cancellation alerts</span>
          </label>
          <label className="flex items-center gap-2 rounded border px-3 py-2">
            <input type="checkbox" checked={local.channelConfig?.whatsapp?.sendDailySummary ?? true} onChange={e=>updateWhatsApp({ sendDailySummary: e.target.checked })} />
            <span>Send daily summary</span>
          </label>
          <label className="flex items-center gap-2 rounded border px-3 py-2">
            <input type="checkbox" checked={local.channelConfig?.whatsapp?.sendWeeklySummary ?? false} onChange={e=>updateWhatsApp({ sendWeeklySummary: e.target.checked })} />
            <span>Send weekly summary</span>
          </label>
        </div>
        <p className="text-[10px] text-gray-500">This is not QR pairing. Customers chat with Booka on the shared number; Booka sends owner notifications and command prompts to this WhatsApp number.</p>
      </FormSection>

      <FormSection
        title="Instagram DM Setup"
        description="Store the Instagram details Booka should use for inbound DMs and lead handling."
        aside={<span className="text-[10px]">Goal: {local.channelConfig?.instagram?.dmGoal || 'bookings'}</span>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Instagram Handle
            <input
              className="border rounded px-2 py-1 text-sm"
              value={local.channelConfig?.instagram?.handle || ''}
              onChange={(e) => updateInstagram({ handle: e.target.value })}
              placeholder="@yourbusiness"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Profile URL
            <input
              className="border rounded px-2 py-1 text-sm"
              value={local.channelConfig?.instagram?.profileUrl || ''}
              onChange={(e) => updateInstagram({ profileUrl: e.target.value })}
              placeholder="https://instagram.com/yourbusiness"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            Primary DM Goal
            <select
              className="border rounded px-2 py-1 text-sm"
              value={local.channelConfig?.instagram?.dmGoal || 'bookings'}
              onChange={(e) => updateInstagram({ dmGoal: e.target.value as 'bookings' | 'lead_capture' | 'support' })}
            >
              <option value="bookings">Drive bookings</option>
              <option value="lead_capture">Capture leads</option>
              <option value="support">Handle support</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={local.channelConfig?.instagram?.useDmReplies ?? true}
              onChange={(e) => updateInstagram({ useDmReplies: e.target.checked })}
            />
            Use Booka for Instagram DM replies
          </label>
        </div>
        <p className="text-[10px] text-gray-500">
          Instagram is best used for inbound discovery and DM lead capture. Booka can route qualified conversations into booking and follow-up flows.
        </p>
      </FormSection>
    </div>
  );
}
