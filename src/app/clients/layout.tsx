import React from 'react';
import Sidebar from '@/components/ui/sidebar';

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-6">
      <aside className="hidden lg:block sticky top-4 self-start max-h-[calc(100vh-2rem)]">
        <div className="h-full overflow-y-auto overflow-x-hidden">
          <Sidebar />
        </div>
      </aside>
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}
