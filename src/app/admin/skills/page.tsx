import SkillManager from '@/components/SkillManager.client';

export default function SkillsAdminPage({ searchParams }: { searchParams?: Record<string,string|undefined> }) {
  const tenantId = typeof searchParams?.tenant_id === 'string' ? searchParams!.tenant_id : (typeof window !== 'undefined' ? (JSON.parse(localStorage.getItem('current_tenant')||'{}')?.id || '') : '');
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4">Skills & Assignments</h2>
      {tenantId ? <SkillManager tenantId={tenantId} /> : <div className="text-sm text-gray-500">No tenant selected.</div>}
    </div>
  );
}
