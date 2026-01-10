'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ProductListQuery } from '@/types/product-catalogue';
import AdvancedSearch from '@/components/admin/products/AdvancedSearch';
import SearchResults from '@/components/admin/products/SearchResults';

export default function ProductSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  
  // Initialize search query from URL params
  const initialQuery: Partial<ProductListQuery> = {
    search: searchParams.get('search') || undefined,
    category_id: searchParams.get('category_id') || undefined,
    status: (searchParams.get('status') as any) || 'all',
    tags: searchParams.get('tags')?.split(',').filter(Boolean) || undefined,
    price_min: searchParams.get('price_min') ? parseFloat(searchParams.get('price_min')!) : undefined,
    price_max: searchParams.get('price_max') ? parseFloat(searchParams.get('price_max')!) : undefined,
    sort: (searchParams.get('sort') as any) || 'created_at',
    order: (searchParams.get('order') as 'asc' | 'desc') || 'desc',
    page: parseInt(searchParams.get('page') || '1'),
    limit: parseInt(searchParams.get('limit') || '20'),
  };

  const [currentQuery, setCurrentQuery] = useState<ProductListQuery>(initialQuery as ProductListQuery);
  const [hasSearched, setHasSearched] = useState(() => {
    // Check if we have any search parameters
    return Array.from(searchParams.keys()).some(key => 
      ['search', 'category_id', 'tags', 'price_min', 'price_max'].includes(key)
    );
  });

  const handleSearch = (query: ProductListQuery) => {
    setCurrentQuery(query);
    setHasSearched(true);

    // Update URL with search parameters
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== 'all') {
        if (Array.isArray(value)) {
          params.set(key, value.join(','));
        } else {
          params.set(key, value.toString());
        }
      }
    });

    router.push(`/dashboard/products/search?${params.toString()}`);
  };

  const handleClear = () => {
    const clearedQuery: ProductListQuery = {
      search: '',
      category_id: undefined,
      status: 'all',
      tags: undefined,
      price_min: undefined,
      price_max: undefined,
      sort: 'created_at',
      order: 'desc',
      page: 1,
      limit: 20,
    };

    setCurrentQuery(clearedQuery);
    setHasSearched(false);
    router.push('/dashboard/products/search');
  };

  const handleProductSelect = (product: any) => {
    router.push(`/dashboard/products/${product.id}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Product Search</h1>
              <p className="text-gray-600 mt-1">Advanced search and filtering for all products</p>
            </div>
            
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/dashboard/products')}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                ← Back to Products
              </button>
            </div>
          </div>
        </div>

        {/* Search Interface */}
        <div className="mb-6">
          <AdvancedSearch
            onSearch={handleSearch}
            initialQuery={initialQuery}
            onClear={handleClear}
          />
        </div>

        {/* Search Results */}
        {hasSearched ? (
          <SearchResults
            searchQuery={currentQuery}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onProductSelect={handleProductSelect}
          />
        ) : (
          <div className="bg-white rounded-lg shadow-sm p-12 text-center">
            <div className="mx-auto max-w-md">
              <svg className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <h3 className="text-lg font-medium text-gray-900 mb-2">Search Your Products</h3>
              <p className="text-gray-500 mb-6">
                Use the search bar above to find products by name, description, SKU, or use advanced filters to narrow down results.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Quick Tips</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Search by product name or SKU</li>
                    <li>• Filter by category or price range</li>
                    <li>• Use tags to find specific items</li>
                    <li>• Sort by price, date, or stock</li>
                  </ul>
                </div>
                
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h4 className="font-medium text-gray-900 mb-2">Search Examples</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• "hair color" - Find hair coloring products</li>
                    <li>• "wig" - Show all wig products</li>
                    <li>• "treatment" - Beauty treatment products</li>
                    <li>• "shampoo" - Hair care essentials</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}