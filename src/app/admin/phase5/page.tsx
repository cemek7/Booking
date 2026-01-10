import React from 'react';
import Phase5Dashboard from '@/components/Phase5Dashboard';

interface Phase5PageProps {
  params: {
    tenantId?: string;
  };
  searchParams: {
    role?: string;
  };
}

const Phase5Page: React.FC<Phase5PageProps> = ({ params, searchParams }) => {
  // In a real app, you'd get tenantId from authentication context
  const tenantId = params.tenantId || 'demo-tenant-id';
  const userRole = searchParams.role || 'admin';

  return (
    <div className="min-h-screen bg-background">
      <Phase5Dashboard tenantId={tenantId} userRole={userRole} />
    </div>
  );
};

export default Phase5Page;