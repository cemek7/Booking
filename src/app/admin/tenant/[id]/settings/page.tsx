import TenantSettings from '@/components/TenantSettings';

type Props = {
  params: { id: string };
};

export default function Page({ params }: Props) {
  const tenantId = params.id;
  return (
    <div className="max-w-3xl mx-auto py-6">
      <h1 className="text-2xl font-bold">Tenant Settings</h1>
      <div className="mt-4">
        <TenantSettings tenantId={tenantId} />
      </div>
    </div>
  );
}
