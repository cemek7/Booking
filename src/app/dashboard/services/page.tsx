import ServicesList from '@/components/services/ServicesList';

export default function ServicesPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Services</h1>
      <p className="text-sm text-gray-600">Manage services offered by the tenant.</p>
      <div className="mt-6">
        <ServicesList />
      </div>
    </div>
  );
}
