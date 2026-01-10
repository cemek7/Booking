"use client";
import React from 'react';
import { useLocation } from '@/lib/location-context';

interface LocationOption { id: string; name?: string }

export default function LocationPicker({ options }: { options?: LocationOption[] }) {
  const { location, setLocation } = useLocation();
  const [value, setValue] = React.useState(location?.id || '');
  const opts = options && options.length ? options : [
    { id: 'loc-default', name: 'Default' },
    { id: 'loc-1', name: 'Location 1' },
    { id: 'loc-2', name: 'Location 2' },
  ];

  React.useEffect(() => { setValue(location?.id || ''); }, [location?.id]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="text-gray-600">Location</label>
      <select
        value={value}
        onChange={(e)=>{ const id = e.target.value; setValue(id); setLocation(id ? { id, name: opts.find(o=>o.id===id)?.name } : null); }}
        className="border rounded px-2 py-1 bg-white"
        aria-label="select-location"
      >
        <option value="">Select…</option>
        {opts.map(o => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
      </select>
    </div>
  );
}
