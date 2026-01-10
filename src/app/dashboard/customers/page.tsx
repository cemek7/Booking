import CustomersList from '@/components/customers/CustomersList';

export default function CustomersPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Customers</h1>
      <p className="text-sm text-gray-600">Search and manage customers for the tenant.</p>
      <div className="mt-6">
        <CustomersList />
      </div>
    </div>
  );
}
