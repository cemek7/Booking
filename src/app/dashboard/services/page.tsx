export const dynamic = 'force-dynamic';
import ServicesList from '@/components/services/ServicesList';

export default function ServicesPage() {
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 shadow-sm">
        <div className="p-6 lg:p-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Services</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Manage services offered by the tenant with a table layout that keeps the full catalog readable.
          </p>
        </div>
      </div>
      <div>
        <ServicesList />
      </div>
    </div>
  );
}
