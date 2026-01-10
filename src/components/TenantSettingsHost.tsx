"use client";

import dynamic from 'next/dynamic';
import React from 'react';

// Client-side host that dynamically imports the real TenantSettingsClient
// with SSR disabled. Putting this in a dedicated client component keeps
// the server page free of ssr:false calls (which are not allowed in Server
// Components) while still deferring the heavy client bundle.
const TenantSettings = dynamic(() => import('./TenantSettingsClient'), {
  ssr: false,
  loading: () => <div className="p-4 border rounded bg-white max-w-2xl">Loading…</div>,
});

export default function TenantSettingsHost() {
  return <TenantSettings />;
}
