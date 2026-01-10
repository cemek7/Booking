"use client";
import { useState } from 'react';
import { FormSection } from './FormSection';
import { useTenant } from '@/lib/supabase/tenant-context';
import { toast } from '../ui/toast';

export interface WhatsAppSyncValues {
  whatsappNumber?: string;
  templateNamespace?: string;
  integrationStatus?: string;
}

export function WhatsAppSyncSection({ values, onChange }: { values: WhatsAppSyncValues; onChange: (patch: Partial<WhatsAppSyncValues>) => void }) {
  const [local, setLocal] = useState<WhatsAppSyncValues>(values);
  function update<K extends keyof WhatsAppSyncValues>(k: K, v: WhatsAppSyncValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  return (
    <div className="space-y-6">
      <FormSection title="WhatsApp Connection" description="Link your business number and manage integration lifecycle." aside={<span className="text-[10px]">Status: {local.integrationStatus || 'unknown'}</span>}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium">Business Number
            <input className="border rounded px-2 py-1 text-sm" value={local.whatsappNumber||''} onChange={e=>update('whatsappNumber', e.target.value)} placeholder="+234..." />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">Template Namespace
            <input className="border rounded px-2 py-1 text-sm" value={local.templateNamespace||''} onChange={e=>update('templateNamespace', e.target.value)} placeholder="your_namespace" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <button
            onClick={async ()=>{
              if (!tenantId) { toast.error('Missing tenant'); return; }
              try {
                const res = await fetch(`/api/tenants/${tenantId}/whatsapp/connect`, { method: 'POST' });
                if (!res.ok) throw new Error('Connect failed');
                update('integrationStatus', 'pending');
                toast.success('Connecting… we will notify when ready');
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Connect failed');
              }
            }}
            className="px-3 py-1 rounded border">Connect</button>
          <button onClick={()=>update('integrationStatus','checking')} className="px-3 py-1 rounded border">Check Status</button>
          <button onClick={()=>update('integrationStatus','disconnected')} className="px-3 py-1 rounded border">Disconnect</button>
        </div>
        <p className="text-[10px] text-gray-500">Connection provisioning occurs asynchronously; you can refresh or check status anytime.</p>
      </FormSection>
    </div>
  );
}
