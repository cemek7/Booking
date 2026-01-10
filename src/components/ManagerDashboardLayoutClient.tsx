'use client';

import React from 'react';
import UnifiedDashboardNav from '@/components/UnifiedDashboardNav';

export default function ManagerDashboardLayoutClient({ children }: { children: React.ReactNode }) {
  
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6 min-h-screen">
      <aside className="hidden lg:block sticky top-6 self-start h-fit max-h-[calc(100vh-2rem)] overflow-y-auto">
        <div className="pr-2">
          <UnifiedDashboardNav 
            userRole="manager"
          />
        </div>
      </aside>
      <div>
        {children}
      </div>
    </div>
  );
}