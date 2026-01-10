"use client";
import { useState, useEffect } from 'react';
import { FormSection } from './FormSection';
import { useTenant } from '@/lib/supabase/tenant-context';
import { toast } from '../ui/toast';
import { Role } from '@/types/roles';

type NonSuperadminRole = Exclude<Role, 'superadmin'>;

export interface SecuritySettingsValues {
  mfaRequired?: boolean;
  sessionTimeout?: number;
  roles?: Record<string,string>; // userId -> role
  apiKeyPresent?: boolean;
  allowedEmailDomains?: string[];
  disablePublicInvites?: boolean;
  allowedInviterRoles?: Array<'owner'|'manager'|'staff'>;
  allowInvitesFromStaffPage?: boolean;
}

export function SecuritySettingsSection({ values, onChange, onGenerateApiKey }: { values: SecuritySettingsValues; onChange: (patch: Partial<SecuritySettingsValues>) => void; onGenerateApiKey: () => void }) {
  const [local, setLocal] = useState<SecuritySettingsValues>(values);
  const { tenant } = useTenant();
  const tenantId = tenant?.id;
  const [users, setUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  useEffect(() => {
    async function load() {
      if (!tenantId) return;
      setLoadingUsers(true);
      try {
        const res = await fetch(`/api/staff?tenant_id=${tenantId}`);
        if (res.ok) {
          const json = await res.json();
          const list = (json.staff || []).map((u: { id: string; name: string; role: string }) => ({ id: u.id, name: u.name, role: u.role }));
          setUsers(list);
        }
      } finally { setLoadingUsers(false); }
    }
    load();
  }, [tenantId]);
  function update<K extends keyof SecuritySettingsValues>(k: K, v: SecuritySettingsValues[K]) {
    const next = { ...local, [k]: v };
    setLocal(next);
    onChange({ [k]: v });
  }

  return (
    <div className="space-y-6">
      <FormSection title="Access Controls" description="Baseline security for staff accounts.">
        <div className="flex flex-wrap gap-6 items-center">
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!!local.mfaRequired} onChange={e=>update('mfaRequired', e.target.checked)} /> Require MFA</label>
          <label className="flex items-center gap-2 text-xs font-medium">Session Timeout
            <input type="number" className="border rounded px-2 py-1 text-sm w-24" value={local.sessionTimeout || 60} onChange={e=>update('sessionTimeout', parseInt(e.target.value)||0)} />
          </label>
        </div>
      </FormSection>
      <FormSection title="API Key" description="Generate a server-to-server key for integrations." aside={<span className="text-[10px]">Store securely; you can only see it once.</span>}>
        {local.apiKeyPresent ? <div className="text-[11px] text-green-700">Key present</div> : <div className="text-[11px] text-gray-500">No key generated.</div>}
        <button
          onClick={async () => {
            try {
              await onGenerateApiKey();
              toast.success('API key generated');
            } catch (e: unknown) {
              let msg = 'API key generation failed';
              if (typeof e === 'object' && e && 'message' in e) {
                const m = (e as { message?: string }).message;
                if (m) msg = m;
              }
              toast.error(msg);
            }
          }}
          className="px-2 py-1 rounded border text-xs"
        >{local.apiKeyPresent ? 'Regenerate' : 'Generate'} API Key</button>
      </FormSection>
      <FormSection title="Invitations" description="Control who can send invites and restrict domains.">
        <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!!local.disablePublicInvites} onChange={e=>update('disablePublicInvites', e.target.checked)} /> Disable public links</label>
        <AllowedDomainsEditor values={local.allowedEmailDomains||[]} onChange={(v)=>update('allowedEmailDomains', v)} />
        <div className="space-y-1">
          <div className="text-[11px] font-medium">Who can invite</div>
          <RoleChips value={(local.allowedInviterRoles as NonSuperadminRole[]) || ['owner','manager']} onChange={(v)=>update('allowedInviterRoles', v)} />
        </div>
        <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!!local.allowInvitesFromStaffPage} onChange={e=>update('allowInvitesFromStaffPage', e.target.checked)} /> Allow invites from Staff page</label>
      </FormSection>
      <FormSection title="Role Assignment" description="Adjust staff privileges. Changes apply immediately.">
        {loadingUsers && <div className="text-[11px] text-gray-500">Loading users…</div>}
        {!loadingUsers && users.length === 0 && <div className="text-[11px] text-gray-500">No users found.</div>}
        <ul className="space-y-1">
          {users.map(u => (
            <li key={u.id} className="flex items-center gap-2 text-[11px] border rounded px-2 py-1 bg-white/60">
              <span className="flex-1 truncate" title={u.name}>{u.name}</span>
              <select
                value={u.role}
                onChange={async (e) => {
                  const newRole = e.target.value;
                  const prevRole = u.role;
                  setUsers(list => list.map(x => x.id === u.id ? { ...x, role: newRole } : x));
                  try {
                    const res = await fetch(`/api/tenant-users/${u.id}/role?tenant_id=${tenantId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) });
                    if (res.ok) {
                      toast.success('Role updated');
                    } else {
                      setUsers(list => list.map(x => x.id === u.id ? { ...x, role: prevRole } : x));
                      toast.error('Role update failed');
                    }
                  } catch {
                    setUsers(list => list.map(x => x.id === u.id ? { ...x, role: prevRole } : x));
                    toast.error('Role update error');
                  }
                }}
                className="border rounded px-1 py-0.5"
              >
                {(['owner','manager','staff'] as const).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-gray-500">Future improvement: search & filter staff list.</p>
      </FormSection>
    </div>
  );
}

function RoleChips({ value, onChange }: { value: NonSuperadminRole[]; onChange: (v: NonSuperadminRole[]) => void }) {
  const roles: NonSuperadminRole[] = ['owner', 'manager', 'staff'];
  return (
    <div className="flex gap-1 flex-wrap">
      {roles.map(r => {
        const active = value.includes(r);
        return (
          <button key={r} type="button" onClick={()=>{
            const set = new Set(value);
            if (set.has(r)) { set.delete(r); } else { set.add(r); }
            onChange(Array.from(set) as NonSuperadminRole[]);
          }} className={`px-2 py-0.5 rounded-full border text-[10px] ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>{r}</button>
        );
      })}
    </div>
  );
}

function AllowedDomainsEditor({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');
  return (
    <div className="space-y-1">
      <div className="text-[11px]">Allowed email domains (for invites)</div>
      <div className="flex gap-2">
        <input className="border rounded px-2 py-1 text-xs flex-1" placeholder="example.com" value={input} onChange={e=>setInput(e.target.value)} />
        <button className="px-2 py-1 rounded border text-[11px]" type="button" onClick={()=>{ if (input.trim()) { const set = new Set(values); set.add(input.trim().toLowerCase()); onChange(Array.from(set)); setInput(''); } }}>Add</button>
      </div>
      <div className="flex gap-1 flex-wrap">
        {values.map((d) => (
          <span key={d} className="px-2 py-0.5 rounded-full border text-[10px] flex items-center gap-1">{d}
            <button type="button" onClick={()=> onChange(values.filter(x=>x!==d))} className="text-red-600">✕</button>
          </span>
        ))}
        {values.length===0 && <span className="text-[10px] text-gray-500">No restrictions</span>}
      </div>
    </div>
  );
}
