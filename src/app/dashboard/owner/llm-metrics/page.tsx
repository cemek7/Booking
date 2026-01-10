import React from 'react';
import OwnerLLMMetrics from '@/components/OwnerLLMMetrics.client';

export default function Page({ searchParams }: { searchParams?: { tenant_id?: string } }) {
  const tenantId = searchParams?.tenant_id || '';
  return (
    <div style={{ padding: 16 }}>
      <h2>Owner — LLM Metrics</h2>
  <p>Use this page to view tenant and global LLM usage. Ensure you&apos;re signed in as the tenant owner.</p>
      <OwnerLLMMetrics tenantId={tenantId} />
    </div>
  );
}
