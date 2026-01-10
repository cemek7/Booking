"use client";
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TenantProfileSection } from '@/components/settings/TenantProfileSection';
import { BusinessProfileSection } from '@/components/settings/BusinessProfileSection';
import { NotificationPreferencesSection } from '@/components/settings/NotificationPreferencesSection';
import { SecuritySettingsSection } from '@/components/settings/SecuritySettingsSection';
import { WhatsAppSyncSection } from '@/components/settings/WhatsAppSyncSection';
import { toast } from '@/components/ui/toast';

interface TabDef { key: string; label: string; description: string; }
const tabs: TabDef[] = [
  { key: 'tenant', label: 'Tenant Profile', description: 'Identity, timezone, branding.' },
  { key: 'business', label: 'Business Profile', description: 'Services catalog, pricing, durations.' },
  { key: 'notifications', label: 'Notifications', description: 'Reminder timing, channel defaults, opt-in policy.' },
  { key: 'security', label: 'Security', description: 'Roles, MFA enrollment, session & access controls.' },
  { key: 'whatsapp', label: 'WhatsApp Sync', description: 'Integration status, template mappings, connectivity.' }
];

interface ServiceDraft { id?: string; name: string; description?: string; duration?: number; price?: number; category?: string; is_active?: boolean; skills?: string[]; }
interface TenantSettings {
  displayName?: string;
  timezone?: string;
  brandingColor?: string;
  contactEmail?: string;
  locale?: string;
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

export default function SettingsPage() {
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Settings</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => router.push(`/settings?tab=${t.key}`)}
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
      <p className="text-xs text-muted-foreground">Tabbed settings per PRD; subroutes removed from sidebar. Data persisted via GET/PATCH /tenants/:tenantId/settings.</p>
    </div>
  );
}

interface SettingsTabContentProps {
  tab: string;
  settings: TenantSettings;
  saving: boolean;
  onSave: (patch: Partial<TenantSettings>) => void;
  tenantId?: string;
}

// (unused constant removed)

function SettingsTabContent({ tab, settings, onSave, saving, tenantId }: SettingsTabContentProps) {
  const [local, setLocal] = useState<Partial<TenantSettings>>({ ...settings });
  function handleSave() {
    // validation
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
      content = <TenantProfileSection values={{ displayName: local.displayName, timezone: local.timezone, brandingColor: local.brandingColor, contactEmail: local.contactEmail, locale: local.locale, tone: local.tone, styleGuidelines: local.styleGuidelines, voiceParameters: local.voiceParameters, samplePhrases: local.samplePhrases, brandTagline: local.brandTagline, greeting: local.greeting, signature: local.signature }} onChange={patch=>setLocal(l=>({ ...l, ...patch }))} />;
      break;
    case 'business':
      content = <BusinessProfileSection values={{ requireDeposit: local.requireDeposit, services: (local.services as ServiceDraft[] | undefined) }} onChange={patch=>setLocal(l=>({ ...l, ...patch }))} />;
      break;
    case 'notifications':
      content = <NotificationPreferencesSection values={{ reminderLead: local.reminderLead, secondReminderLead: local.secondReminderLead, defaultChannels: local.defaultChannels, optInPolicy: local.optInPolicy, notifyFrom: local.notifyFrom, customReminderMessage: local.customReminderMessage }} onChange={patch=>setLocal(l=>({ ...l, ...patch, optInPolicy: patch.optInPolicy as ('implicit'|'explicit') | undefined }))} />;
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
      content = <WhatsAppSyncSection values={{ whatsappNumber: local.whatsappNumber, templateNamespace: local.templateNamespace, integrationStatus: local.integrationStatus }} onChange={patch=>setLocal(l=>({ ...l, ...patch }))} />;
      break;
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
