'use client';

import React from 'react';

interface OwnerReportsProps {
  tenantId: string;
}

export default function OwnerReports({ tenantId }: OwnerReportsProps) {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Owner Reports</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Comprehensive financial and business performance reports.
      </p>
      {/* Placeholder for owner-specific report components */}
      <div className="border p-4 rounded">
        <p>Financial Summary Report (Placeholder)</p>
        <p>Business Growth Report (Placeholder)</p>
      </div>
    </div>
  );
}
