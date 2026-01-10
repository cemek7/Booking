"use client";
import { useEffect, useRef, useState } from 'react';
import { useTenant } from '@/lib/supabase/tenant-context';
import { StaffDto } from '@/hooks/useStaff';
import { toast } from '@/components/ui/toast';

interface Props { open: boolean; onClose: () => void; staff: StaffDto[]; onLocalUpdate: (id: string, patch: Partial<StaffDto>) => void; }

export default function StaffRolesModal({ open, onClose, staff, onLocalUpdate }: Props) {
  const { tenant, role } = useTenant();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
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
  const canManage = ['owner','manager','superadmin'].includes((role||'').toLowerCase());
  const isOwner = ['owner','superadmin'].includes((role||'').toLowerCase());
  const staffTypeOptions = ['stylist','therapist','receptionist','nail_tech','colorist','barber'];

  // Get available roles based on user's role
  const getAvailableRoles = (targetStaffRole: string | undefined) => {
    if (isOwner) {
      // Owner can assign staff, receptionist, manager roles
      return ['staff', 'receptionist', 'manager', 'team_lead'];
    } else {
      // Manager can only assign staff or receptionist roles, not manager
      return ['staff', 'receptionist'];
    }
  };

  // Check if manager can edit this staff member
  const canEditStaff = (targetStaffRole: string | undefined) => {
    if (!canManage) return false;
    if (isOwner) return true;
    // Manager cannot edit other managers or team leads
    if (targetStaffRole === 'manager' || targetStaffRole === 'team_lead') return false;
    return true;
  };

  async function update(id: string, patch: { role?: string; staff_type?: string }) {
    if (!tenant?.id) { toast.error('Missing tenant'); return; }
    onLocalUpdate(id, patch); // optimistic
    setBusy(b => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/staff/${encodeURIComponent(id)}/attributes?tenant_id=${tenant.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error('Server rejected');
      toast.success('Updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setBusy(b => ({ ...b, [id]: false })); }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} className="relative bg-white w-full max-w-4xl rounded-xl shadow-xl p-6 space-y-4 ring-1 ring-black/5">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">Manage Roles & Types</h2>
          <button onClick={onClose} aria-label="Close roles modal" className="text-sm px-2 py-1 rounded hover:bg-gray-100">✕</button>
        </div>
        {!canManage && <div className="text-sm text-red-600">You don&apos;t have permission to modify roles.</div>}
        <div className="max-h-[70vh] overflow-y-auto border rounded">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th className="text-left p-2 font-medium">Name</th>
                <th className="text-left p-2 font-medium">Email</th>
                <th className="text-left p-2 font-medium">Role</th>
                <th className="text-left p-2 font-medium">Type</th>
                <th className="text-left p-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map(s => {
                const id = (s.id || s.user_id || '') as string;
                const canEdit = canEditStaff(s.role);
                const availableRoles = getAvailableRoles(s.role);
                return (
                  <tr key={id} className={!canEdit ? 'opacity-50 bg-gray-50' : ''}>
                    <td className="p-2">{s.name || s.email || id}</td>
                    <td className="p-2 text-gray-600">{s.email || '—'}</td>
                    <td className="p-2">
                      {!canEdit ? (
                        <span className="text-xs font-medium capitalize px-2 py-1 bg-yellow-100 text-yellow-800 rounded">
                          {s.role || 'staff'}
                          {s.role === 'manager' || s.role === 'team_lead' ? ' (restricted)' : ''}
                        </span>
                      ) : (
                        <select disabled={busy[id]} value={s.role || 'staff'} onChange={e => update(id,{ role: e.target.value })} className="border rounded px-2 py-1 text-xs">
                          {availableRoles.map(r => (
                            <option key={r} value={r}>{r === 'team_lead' ? 'Team Lead' : r.charAt(0).toUpperCase() + r.slice(1)}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="p-2">
                      <select disabled={!canEdit || busy[id]} value={s.staff_type || ''} onChange={e => update(id,{ staff_type: e.target.value })} className="border rounded px-2 py-1 text-xs w-full">
                        <option value="">— Select type —</option>
                        {staffTypeOptions.map(opt => (
                          <option key={opt} value={opt}>{opt.replace('_',' ')}</option>
                        ))}
                        <option value="other">Other…</option>
                      </select>
                      {s.staff_type === 'other' && (
                        <input disabled={!canEdit || busy[id]} onChange={e => update(id,{ staff_type: e.target.value })} placeholder="Enter custom type" className="mt-2 border rounded px-2 py-1 text-xs w-full" />
                      )}
                    </td>
                    <td className="p-2">
                      {busy[id] && <span className="text-xs text-gray-500">Saving…</span>}
                      {!canEdit && <span className="text-xs text-gray-500">No permission</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded-md text-sm">Done</button>
        </div>
      </div>
    </div>
  );
}