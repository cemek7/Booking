import { requireAuth } from '@/lib/auth/server-auth';
import ProductsList from '@/components/admin/products/ProductsList';

export default async function ProductsPage() {
  await requireAuth(['owner', 'manager']);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-gray-600">Manage your product catalog and inventory.</p>
        </div>
      </div>
      <div className="mt-6">
        <ProductsList />
      </div>
    </div>
  );
}