"use client";
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { useTenant } from '@/lib/supabase/tenant-context';

interface Props { open: boolean; onClose: () => void; }

export default function StaffInviteModal({ open, onClose }: Props) {
  const { tenant, role } = useTenant();
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'manager'>('staff');
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const lastActive = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    const el = dialogRef.current;
    const focusables = el?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusables?.[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab' && focusables && focusables.length > 0) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; (lastActive.current as HTMLElement | null)?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const canInvite = ['owner','manager','superadmin'].includes((role||'').toLowerCase());
  const isOwner = ['owner','superadmin'].includes((role||'').toLowerCase());
  const canInviteManager = isOwner;

  async function onSendInvite() {
    if (!tenant?.id) { toast.error('Missing tenant'); return; }
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { toast.error('Enter a valid email'); return; }
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
      // If token absent we rely on cookie session fallback; just continue.
    setLoading(true);
    try {
        const headers: Record<string,string> = { 'Content-Type':'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`/api/tenants/${tenant.id}/invites`, { method: 'POST', headers, body: JSON.stringify({ email: value, role: inviteRole }) });
      if (!res.ok) { const err = await res.json().catch(()=>({})); toast.error(err?.error || 'Invite failed'); return; }
      const json = await res.json();
      toast.success(`Invite created for ${inviteRole}: ${json.url}`);
      setEmail('');
      setInviteRole('staff');
      onClose();
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} className="relative bg-white w-full max-w-md rounded-xl shadow-xl p-6 space-y-4 ring-1 ring-black/5">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Invite Staff</h2>
          <button onClick={onClose} aria-label="Close invite modal" className="text-sm px-2 py-1 rounded hover:bg-gray-100">✕</button>
        </div>
        {!canInvite && <div className="text-sm text-red-600">You don&apos;t have permission to invite staff.</div>}
        <fieldset disabled={!canInvite || loading} className={!canInvite? 'opacity-60 pointer-events-none':''}>
          <label className="block text-sm font-medium">Staff email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full border rounded px-3 py-2 text-sm" placeholder="name@example.com" />
          
          {canInviteManager && (
            <>
              <label className="block text-sm font-medium mt-3">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'staff' | 'manager')} className="mt-1 w-full border rounded px-3 py-2 text-sm">
                <option value="staff">Staff Member</option>
                <option value="manager">Manager (can manage team)</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Managers can invite and manage staff under them.</p>
            </>
          )}
          
          <div className="mt-4 flex gap-2">
            <button onClick={onSendInvite} className="px-4 py-2 bg-indigo-600 text-white rounded-md disabled:opacity-60" disabled={loading}>{loading? 'Sending…':'Send Invite'}</button>
            <button onClick={onClose} className="px-4 py-2 border rounded-md">Cancel</button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}