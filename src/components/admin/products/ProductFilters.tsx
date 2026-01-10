'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductListQuery } from '@/types/product-catalogue';
import Button from '@/components/ui/button';
import { authFetch } from '@/lib/auth/auth-api-client';

interface ProductFiltersProps {
  filters: ProductListQuery;
  onFilterChange: (filters: Partial<ProductListQuery>) => void;
}

export default function ProductFilters({ filters, onFilterChange }: ProductFiltersProps) {
  const { tenant } = useTenant();
  const [localFilters, setLocalFilters] = useState(filters);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fetch categories for filter dropdown
  const { data: categoriesData } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return { categories: [] };
      
      const response = await authFetch('/api/categories');
      
      if (response.error) throw new Error('Failed to fetch categories');
      return response.data;
    },
    enabled: !!tenant?.id,
  });

  const categories = categoriesData?.categories || [];

  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleInputChange = (key: keyof ProductListQuery, value: any) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
  };

  const applyFilters = () => {
    onFilterChange(localFilters);
  };

  const resetFilters = () => {
    const resetFilters: ProductListQuery = {
      page: 1,
      limit: 20,
      sort: 'created_at',
      order: 'desc',
      status: 'all',
      include_variants: true,
      include_stock_info: true,
    };
    setLocalFilters(resetFilters);
    onFilterChange(resetFilters);
  };

  const hasActiveFilters = () => {
    return (
      localFilters.search ||
      localFilters.category_id ||
      localFilters.status !== 'all' ||
      localFilters.price_min ||
      localFilters.price_max ||
      (localFilters.tags && localFilters.tags.length > 0)
    );
  };

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      {/* Basic Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {/* Search */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Search
          </label>
          <input
            type="text"
            placeholder="Search products..."
            value={localFilters.search || ''}
            onChange={(e) => handleInputChange('search', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Category Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Category
          </label>
          <select
            value={localFilters.category_id || ''}
            onChange={(e) => handleInputChange('category_id', e.target.value || undefined)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Categories</option>
            {categories.map((category: any) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Status
          </label>
          <select
            value={localFilters.status || 'all'}
            onChange={(e) => handleInputChange('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="all">All Products</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="featured">Featured</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
          </select>
        </div>

        {/* Sort */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Sort By
          </label>
          <select
            value={`${localFilters.sort}-${localFilters.order}`}
            onChange={(e) => {
              const [sort, order] = e.target.value.split('-');
              handleInputChange('sort', sort);
              handleInputChange('order', order);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="created_at-desc">Newest First</option>
            <option value="created_at-asc">Oldest First</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="price_cents-asc">Price Low-High</option>
            <option value="price_cents-desc">Price High-Low</option>
            <option value="stock_quantity-asc">Stock Low-High</option>
            <option value="stock_quantity-desc">Stock High-Low</option>
            <option value="upsell_priority-desc">Upsell Priority</option>
          </select>
        </div>

        {/* Advanced Toggle */}
        <div className="flex items-end">
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full"
          >
            {showAdvanced ? '➖' : '➕'} Advanced
          </Button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="border-t pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Price Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Price ($)
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={localFilters.price_min ? (localFilters.price_min / 100) : ''}
                onChange={(e) => handleInputChange('price_min', e.target.value ? parseInt(e.target.value) * 100 : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Price ($)
              </label>
              <input
                type="number"
                placeholder="999.00"
                value={localFilters.price_max ? (localFilters.price_max / 100) : ''}
                onChange={(e) => handleInputChange('price_max', e.target.value ? parseInt(e.target.value) * 100 : undefined)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tags
              </label>
              <input
                type="text"
                placeholder="hair, color, treatment"
                value={localFilters.tags?.join(', ') || ''}
                onChange={(e) => {
                  const tags = e.target.value
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(tag => tag.length > 0);
                  handleInputChange('tags', tags.length > 0 ? tags : undefined);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Results per page */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Per Page
              </label>
              <select
                value={localFilters.limit || 20}
                onChange={(e) => handleInputChange('limit', parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          {/* Include Options */}
          <div className="mt-4 flex gap-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={localFilters.include_variants || false}
                onChange={(e) => handleInputChange('include_variants', e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm">Include Variants</span>
            </label>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={localFilters.include_stock_info || false}
                onChange={(e) => handleInputChange('include_stock_info', e.target.checked)}
                className="mr-2"
              />
              <span className="text-sm">Include Stock Info</span>
            </label>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4 border-t">
        <div className="flex items-center gap-2">
          {hasActiveFilters() && (
            <span className="text-sm text-gray-600">
              🔍 {hasActiveFilters() ? 'Filters applied' : 'No filters'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {hasActiveFilters() && (
            <Button variant="outline" onClick={resetFilters}>
              Clear All
            </Button>
          )}
          <Button onClick={applyFilters}>
            Apply Filters
          </Button>
        </div>
      </div>
    </div>
  );
}