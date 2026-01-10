"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  // Optional seed: one service
  const [serviceName, setServiceName] = useState('');
  const [serviceDuration, setServiceDuration] = useState<string>('');
  const [servicePrice, setServicePrice] = useState<string>('');
  // Optional seed: one staff
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<'owner'|'staff'>('staff');
  const [loading, setLoading] = useState(false);

  async function startOnboarding() {
    const n = name.trim();
    if (!n) { toast.error('Business name is required'); return; }
    setLoading(true);
    try {
      const services = [] as Array<{ name: string; duration?: number; price?: number }>;
      const sName = serviceName.trim();
      if (sName) {
        const dur = Number(serviceDuration);
        const price = Number(servicePrice);
        services.push({ name: sName, duration: Number.isFinite(dur) ? Math.max(0, Math.floor(dur)) : undefined, price: Number.isFinite(price) ? price : undefined });
      }

      const staff = [] as Array<{ name?: string; email?: string; role?: 'owner'|'staff' }>;
      const stName = staffName.trim();
      const stEmail = staffEmail.trim();
      if (stName || stEmail) {
        staff.push({ name: stName || undefined, email: stEmail || undefined, role: staffRole });
      }

      const payload: { 
        name: string; 
        timezone?: string; 
        services?: Array<{ name: string; duration?: number; price?: number }>; 
        staff?: Array<{ name?: string; email?: string; role: string }> 
      } = { name: n, timezone: timezone || undefined };
      if (services.length) payload.services = services;
      if (staff.length) payload.staff = staff;

      const res = await fetch('/api/onboarding/tenant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(()=>({}));
        toast.error(err?.error || 'Failed to create tenant');
        return;
      }
      const json = await res.json();
      if (json?.tenantId) {
        try { if (typeof window !== 'undefined') localStorage.setItem('current_tenant', JSON.stringify({ id: json.tenantId })); } catch {}
        if (services.length || staff.length) {
          const seeded: string[] = [];
          if (services.length) seeded.push(`${services.length} service${services.length>1?'s':''}`);
          if (staff.length) seeded.push(`${staff.length} staff member${staff.length>1?'s':''}`);
          toast.success(`Tenant created — seeded ${seeded.join(' & ')}`);
        } else {
          toast.success('Tenant created');
        }
        router.replace('/dashboard');
      } else {
        toast.info('Created in dev mode');
        router.replace('/dashboard');
      }
    } catch {
      toast.error('Network error');
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border rounded-xl p-6 space-y-4">
        <h1 className="text-xl font-semibold">Welcome to Booka</h1>
        <p className="text-sm text-gray-600">Let’s set up your business to get started.</p>
        <label className="block text-sm font-medium">Business Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Glow Salon" />
        <label className="block text-sm font-medium">Timezone (optional)</label>
        <input value={timezone} onChange={e=>setTimezone(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Africa/Lagos" />
        <div className="pt-2 border-t mt-4">
          <h2 className="text-sm font-semibold mb-2">Add your first service (optional)</h2>
          <label className="block text-sm">Service Name</label>
          <input value={serviceName} onChange={e=>setServiceName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Haircut" />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div>
              <label className="block text-sm">Duration (mins)</label>
              <input value={serviceDuration} onChange={e=>setServiceDuration(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" inputMode="numeric" placeholder="45" />
            </div>
            <div>
              <label className="block text-sm">Price</label>
              <input value={servicePrice} onChange={e=>setServicePrice(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" inputMode="decimal" placeholder="5000" />
            </div>
          </div>
        </div>
        <div className="pt-2 border-t mt-4">
          <h2 className="text-sm font-semibold mb-2">Add a staff member (optional)</h2>
          <label className="block text-sm">Name</label>
          <input value={staffName} onChange={e=>setStaffName(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. Adaeze" />
          <label className="block text-sm mt-2">Email</label>
          <input value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. staff@example.com" />
          <label className="block text-sm mt-2">Role</label>
          <select value={staffRole} onChange={e=>setStaffRole(e.target.value as 'staff' | 'owner')} className="w-full border rounded px-3 py-2 text-sm">
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div className="pt-2">
          <button disabled={loading} onClick={startOnboarding} className="px-4 py-2 bg-indigo-600 text-white rounded disabled:opacity-60">{loading ? 'Creating…' : 'Create Tenant'}</button>
        </div>
        <p className="text-xs text-gray-500">You can change details later in Settings.</p>
      </div>
    </div>
  );
}
