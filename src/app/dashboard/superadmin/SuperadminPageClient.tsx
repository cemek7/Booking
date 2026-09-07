'use client';
import SuperAdminDashboard from '@/components/SuperAdminDashboard';

interface SuperadminPageClientProps {
  user: { id: string; email: string; role: string };
}

export default function SuperadminPageClient(_props: SuperadminPageClientProps) {
  void _props;
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
      <SuperAdminDashboard />
    </div>
  );
}
