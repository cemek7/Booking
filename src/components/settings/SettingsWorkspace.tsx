"use client";

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TenantProfileSection } from '@/components/settings/TenantProfileSection';
import { BusinessProfileSection } from '@/components/settings/BusinessProfileSection';
import { NotificationPreferencesSection } from '@/components/settings/NotificationPreferencesSection';
import { SecuritySettingsSection } from '@/components/settings/SecuritySettingsSection';
import { WhatsAppSyncSection } from '@/components/settings/WhatsAppSyncSection';
import { InstagramConnectSection } from '@/components/settings/InstagramConnectSection';
import { PaymentSettingsSection } from '@/components/settings/PaymentSettingsSection';
import { AgentConfigSection } from '@/components/settings/AgentConfigSection';
import type { BusinessHours } from '@/components/settings/BusinessHoursSection';
import { toast } from '@/components/ui/toast';

// Canonical settings surface. Tabs are driven by ?tab= on /dashboard/settings.
const BASE_PATH = '/dashboard/settings';

interface TabDef { key: string; label: string; description: string; }
const tabs: TabDef[] = [
  { key: 'tenant', label: 'Tenant Profile', description: 'Identity, timezone, branding.' },
  { key: 'business', label: 'Business Profile', description: 'Services catalog, pricing, durations.' },
  { key: 'agent', label: 'Agent', description: 'AI agent identity, personality, business hours, lead capture, and voice support.' },
  { key: 'notifications', label: 'Notifications', description: 'Reminder timing, channel defaults, opt-in policy.' },
  { key: 'security', label: 'Security', description: 'Roles, MFA enrollment, session & access controls.' },
  { key: 'whatsapp', label: 'Channels', description: 'Owner command channel, Instagram DM setup, and shared-number metadata.' },
  { key: 'payments', label: 'Payments', description: 'Bank account for revenue collection via Paystack split settlement.' },
];

interface ServiceDraft { id?: string; name: string; description?: string; duration?: number; price?: number; category?: string; is_active?: boolean; skills?: string[]; }
interface TenantSettings {
  displayName?: string;
  timezone?: string;
  brandingColor?: string;
  contactEmail?: string;
  locale?: string;
  ownerName?: string;
  ownerPhone?: string;
  businessNickname?: string;
  tone?: string;
  styleGuidelines?: string;
  voiceParameters?: Record<string, unknown>;
  samplePhrases?: string[];
  brandTagline?: string;
  greeting?: string;
  signature?: string;
  requireDeposit?: boolean;
  services?: ServiceDraft[];
  defaultCurrency?: string;
  depositPercent?: number;
  cancellationPolicy?: string;
  businessHours?: Record<string, { open?: string; close?: string; closed?: boolean }>;
  staffAssignmentStrategy?: 'round_robin' | 'preferred' | 'skill_based';
  allowOverbooking?: boolean;
  reminderLead?: number;
  secondReminderLead?: number;
  defaultChannels?: string[];
  optInPolicy?: 'implicit' | 'explicit';
  notifyFrom?: string;
  customReminderMessage?: string;
  bookingSources?: string[];
  notificationPreferences?: {
    newBookings?: boolean;
    cancellations?: boolean;
    dailySummary?: boolean;
    weeklySummary?: boolean;
  };
  mfaRequired?: boolean;
  sessionTimeout?: number;
  apiKeyPresent?: boolean;
  allowedEmailDomains?: string[];
  disablePublicInvites?: boolean;
  allowedInviterRoles?: Array<'owner'|'manager'|'staff'>;
  allowInvitesFromStaffPage?: boolean;
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
  preferred_language?: string;
  business_hours?: BusinessHours | null;
  capture_leads?: boolean;
  follow_up_delay_hours?: number;
  follow_up_message_template?: string;
  voice_notes_enabled?: boolean;
  voice_calls_enabled?: boolean;
  voice_stt_provider?: 'openai' | 'local';
  voice_tts_provider?: 'openai' | 'local';
  voice_character?: 'alloy' | 'nova' | 'echo' | 'shimmer' | 'onyx' | 'fable';
  reply_with_audio?: 'always' | 'when_user_uses_voice' | 'never';
  plan?: string;
}

async function fetchSettings(tenantId?: string): Promise<TenantSettings> {
  if (!tenantId) return {};
  const res = await fetch(`/api/tenants/${tenantId}/settings`);
  if (!res.ok) return {};
  return res.json();
}

async function patchSettings(tenantId: string, patch: Partial<TenantSettings>): Promise<TenantSettings> {
  const res = await fetch(`/api/tenants/${tenantId}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error('Failed to save settings');
  return res.json();
}

function SettingsWorkspaceInner() {
  const router = useRouter();
  const search = useSearchParams();
  const activeKey = search?.get('tab');
  const active = tabs.find(t => t.key === activeKey) || tabs[0];
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const qc = useQueryClient();
  const { data: settings = {}, isLoading } = useQuery<TenantSettings>({ queryKey: ['tenant-settings', tenantId], queryFn: () => fetchSettings(tenantId) });
  const mutation = useMutation({
    mutationFn: (patch: Partial<TenantSettings>) => patchSettings(tenantId!, patch),
    onMutate: async (patch) => {
      if (!tenantId) return;
      await qc.cancelQueries({ queryKey: ['tenant-settings', tenantId] });
      const prev = qc.getQueryData<TenantSettings>(['tenant-settings', tenantId]);
      qc.setQueryData(['tenant-settings', tenantId], { ...(prev || {}), ...patch });
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev && tenantId) qc.setQueryData(['tenant-settings', tenantId], ctx.prev);
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
    },
    onSuccess: () => { toast.success('Settings saved'); },
    onSettled: () => { if (tenantId) qc.invalidateQueries({ queryKey: ['tenant-settings', tenantId] }); }
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => router.push(`${BASE_PATH}?tab=${t.key}`)}
            className={`px-3 py-1 rounded border text-sm ${active.key===t.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-gray-50'}`}
            aria-current={active.key===t.key ? 'true' : 'false'}
          >{t.label}</button>
        ))}
      </div>
      <div className="p-4 border rounded bg-white space-y-4" aria-labelledby={`settings-section-${active.key}`}>
        <h2 id={`settings-section-${active.key}`} className="text-lg font-medium">{active.label}</h2>
        <p className="text-sm text-gray-600">{active.description}</p>
        {isLoading && <div className="text-sm text-gray-500">Loading settings…</div>}
        {!isLoading && tenantId && (
          <SettingsTabContent
            tab={active.key}
            settings={settings}
            onSave={(patch) => mutation.mutate(patch)}
            saving={mutation.isPending}
            tenantId={tenantId}
          />
        )}
      </div>
    </div>
  );
}

export default function SettingsWorkspace() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading settings…</div>}>
      <SettingsWorkspaceInner />
    </Suspense>
  );
}

interface SettingsTabContentProps {
  tab: string;
  settings: TenantSettings;
  saving: boolean;
  onSave: (patch: Partial<TenantSettings>) => void;
  tenantId?: string;
}

function SettingsTabContent({ tab, settings, onSave, saving, tenantId }: SettingsTabContentProps) {
  const [local, setLocal] = useState<Partial<TenantSettings>>({ ...settings });
  function handleSave() {
    if (tab === 'tenant') {
      const name = (local.displayName || '').trim();
      if (!name) { toast.error('Display name is required'); return; }
      if ((local.tone || local.styleGuidelines) && (!local.samplePhrases || local.samplePhrases.length === 0)) {
        toast.error('Add at least one sample phrase for the chosen tone/style');
        return;
      }
    }
    if (tab === 'business') {
      const services = local.services as { name?: string }[] | undefined;
      if (services && services.some(s => !s.name || !s.name.trim())) { toast.error('Service names cannot be blank'); return; }
      if (local.requireDeposit && (!local.depositPercent || local.depositPercent <= 0)) {
        toast.error('Deposit percent is required and must be > 0');
        return;
      }
      const hours = local.businessHours as Record<string, { open?: string; close?: string; closed?: boolean }> | undefined;
      if (hours) {
        for (const [day, h] of Object.entries(hours)) {
          if (h?.closed) continue;
          if ((h?.open && !h?.close) || (!h?.open && h?.close)) { toast.error(`Set both open and close for ${day}`); return; }
          if (h?.open && h?.close && h.open >= h.close) { toast.error(`${day}: open must be earlier than close`); return; }
        }
      }
    }
    onSave(local);
  }

  let content: React.ReactNode = null;
  switch (tab) {
    case 'tenant':
      content = <TenantProfileSection values={{ displayName: local.displayName, timezone: local.timezone, brandingColor: local.brandingColor, contactEmail: local.contactEmail, locale: local.locale, ownerName: local.ownerName, ownerPhone: local.ownerPhone, businessNickname: local.businessNickname, bookingSources: local.bookingSources, tone: local.tone, styleGuidelines: local.styleGuidelines, voiceParameters: local.voiceParameters, samplePhrases: local.samplePhrases, brandTagline: local.brandTagline, greeting: local.greeting, signature: local.signature }} onChange={patch=>setLocal(l=>({ ...l, ...patch }))} />;
      break;
    case 'business':
      content = <BusinessProfileSection values={{ requireDeposit: local.requireDeposit, services: (local.services as ServiceDraft[] | undefined) }} onChange={patch=>setLocal(l=>({ ...l, ...patch }))} />;
      break;
    case 'agent':
      content = <AgentConfigSection
        values={{
          displayName: local.displayName,
          greeting: local.greeting,
          signature: local.signature,
          tone: local.tone,
          styleGuidelines: local.styleGuidelines,
          voiceParameters: local.voiceParameters,
          samplePhrases: local.samplePhrases,
          preferred_language: local.preferred_language,
          business_hours: local.business_hours,
          capture_leads: local.capture_leads,
          follow_up_delay_hours: local.follow_up_delay_hours,
          follow_up_message_template: local.follow_up_message_template,
          voice_notes_enabled: local.voice_notes_enabled,
          voice_calls_enabled: local.voice_calls_enabled,
          voice_stt_provider: local.voice_stt_provider,
          voice_tts_provider: local.voice_tts_provider,
          voice_character: local.voice_character,
          reply_with_audio: local.reply_with_audio,
          plan: local.plan,
        }}
        onChange={patch=>setLocal(l=>({ ...l, ...patch } as Partial<TenantSettings>))}
        tenantId={tenantId}
      />;
      break;
    case 'notifications':
      content = <NotificationPreferencesSection values={{ reminderLead: local.reminderLead, secondReminderLead: local.secondReminderLead, defaultChannels: local.defaultChannels, optInPolicy: local.optInPolicy, notifyFrom: local.notifyFrom, customReminderMessage: local.customReminderMessage, notificationPreferences: local.notificationPreferences }} onChange={patch=>setLocal(l=>({ ...l, ...patch, optInPolicy: patch.optInPolicy as ('implicit'|'explicit') | undefined }))} />;
      break;
    case 'security':
      content = <SecuritySettingsSection
        values={{ mfaRequired: local.mfaRequired, sessionTimeout: local.sessionTimeout, apiKeyPresent: local.apiKeyPresent, allowedEmailDomains: local.allowedEmailDomains, disablePublicInvites: local.disablePublicInvites, allowedInviterRoles: local.allowedInviterRoles, allowInvitesFromStaffPage: local.allowInvitesFromStaffPage }}
        onChange={patch=>setLocal(l=>({ ...l, ...patch }))}
        onGenerateApiKey={async () => {
          if (!tenantId) throw new Error('Missing tenant');
          const res = await fetch(`/api/tenants/${tenantId}/apikey`, { method: 'POST' });
          if (!res.ok) throw new Error('API key generation failed');
          const json = await res.json();
          setLocal(l=>({ ...l, apiKeyPresent: true }));
          toast.info('Copy & store your new API key securely.');
          return json;
        }}
      />;
      break;
    case 'whatsapp':
      content = (
        <div className="space-y-4">
          <WhatsAppSyncSection
            values={{
              whatsappNumber: local.whatsappNumber,
              templateNamespace: local.templateNamespace,
              integrationStatus: local.integrationStatus,
              channelConfig: local.channelConfig,
            }}
            onChange={patch=>setLocal(l=>({ ...l, ...patch }))}
          />
          <InstagramConnectSection />
        </div>
      );
      break;
    case 'payments':
      return <div className="space-y-4"><PaymentSettingsSection tenantId={tenantId!} /></div>;
    default:
      content = <div className="text-xs text-gray-500">Unknown tab.</div>;
  }

  return (
    <div className="space-y-4">
      {content}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-3 py-1 rounded text-sm border ${saving ? 'opacity-60 cursor-not-allowed' : 'bg-indigo-600 text-white border-indigo-600'}`}
        >{saving ? 'Saving…' : 'Save Changes'}</button>
      </div>
    </div>
  );
}
