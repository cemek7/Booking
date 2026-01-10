"use client";
import { useState } from 'react';
import CustomersList from '@/components/customers/CustomersList';
import Modal from '@/components/ui/modal';
import CustomerForm from '@/components/customers/CustomerForm';
import { useTenant } from '@/lib/supabase/tenant-context';

export default function ClientsPage() {
  const [query, setQuery] = useState('');
  const [openNew, setOpenNew] = useState(false);
  const { tenant } = useTenant();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or phone"
            className="border rounded px-3 py-1 text-sm bg-white"
            aria-label="search-clients"
          />
          <button className="px-3 py-1 rounded bg-indigo-600 text-white text-sm" onClick={()=>setOpenNew(true)}>New Client</button>
        </div>
      </div>

      <div className="bg-white border rounded p-3">
        <CustomersList filter={query} />
      </div>

      <Modal open={openNew} onClose={() => setOpenNew(false)}>
        <div className="w-[360px] max-w-[90vw]">
          <h3 className="text-base font-semibold mb-3">Create Client</h3>
          <CustomerForm
            onSuccess={() => {
              setOpenNew(false);
              try { window.dispatchEvent(new CustomEvent('customers:refresh')); } catch {}
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
