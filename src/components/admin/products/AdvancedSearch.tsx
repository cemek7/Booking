'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductListQuery } from '@/types/product-catalogue';
import Button from '@/components/ui/button';
import { authFetch } from '@/lib/auth/auth-api-client';

interface AdvancedSearchProps {
  onSearch: (query: ProductListQuery) => void;
  initialQuery?: Partial<ProductListQuery>;
  onClear: () => void;
}

interface SearchHistoryItem {
  id: string;
  query: string;
  filters: Partial<ProductListQuery>;
  timestamp: Date;
  resultCount: number;
}

export default function AdvancedSearch({ onSearch, initialQuery, onClear }: AdvancedSearchProps) {
  const { tenant } = useTenant();
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  
  const [searchQuery, setSearchQuery] = useState<ProductListQuery>({
    search: initialQuery?.search || '',
    category_id: initialQuery?.category_id || undefined,
    status: initialQuery?.status || 'all',
    tags: initialQuery?.tags || undefined,
    price_min: initialQuery?.price_min || undefined,
    price_max: initialQuery?.price_max || undefined,
    sort: initialQuery?.sort || 'created_at',
    order: initialQuery?.order || 'desc',
    page: 1,
    limit: 20,
    stock_status: initialQuery?.stock_status || undefined,
    is_featured: initialQuery?.is_featured || undefined,
    is_digital: initialQuery?.is_digital || undefined,
  });

  // Load search history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('product-search-history');
    if (savedHistory) {
      try {
        const history = JSON.parse(savedHistory).map((item: any) => ({
          ...item,
          timestamp: new Date(item.timestamp),
        }));
        setSearchHistory(history);
      } catch (error) {
        console.error('Failed to parse search history:', error);
      }
    }
  }, []);

  // Fetch categories for dropdown
  const { data: categoriesData } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return { categories: [] };
      
      const response = await authFetch('/api/categories?is_active=true');
      
      if (response.error) throw new Error('Failed to fetch categories');
      return response.data;
    },
    enabled: !!tenant?.id,
  });

  // Fetch popular tags
  const { data: tagsData } = useQuery({
    queryKey: ['popular-tags', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return { tags: [] };
      
      const response = await authFetch('/api/products/tags');
      
      if (response.error) return { tags: [] };
      return response.data;
    },
    enabled: !!tenant?.id,
  });

  const categories = categoriesData?.categories || [];
  const popularTags = tagsData?.tags || [];

  const handleSearch = () => {
    // Clean up the query - remove empty values
    const cleanQuery = Object.entries(searchQuery).reduce((acc, [key, value]) => {
      if (value !== undefined && value !== '' && value !== 'all') {
        acc[key as keyof ProductListQuery] = value;
      }
      return acc;
    }, {} as any);

    // Reset page to 1 for new searches
    cleanQuery.page = 1;

    onSearch(cleanQuery);

    // Save to search history if there's actually a search term or filters
    if (cleanQuery.search || Object.keys(cleanQuery).length > 3) {
      const historyItem: SearchHistoryItem = {
        id: Date.now().toString(),
        query: cleanQuery.search || 'Advanced Filter',
        filters: cleanQuery,
        timestamp: new Date(),
        resultCount: 0, // Will be updated when results come back
      };

      const newHistory = [historyItem, ...searchHistory.slice(0, 9)]; // Keep last 10 searches
      setSearchHistory(newHistory);
      localStorage.setItem('product-search-history', JSON.stringify(newHistory));
    }
  };

  const handleClear = () => {
    setSearchQuery({
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
      stock_status: undefined,
      is_featured: undefined,
      is_digital: undefined,
    });
    onClear();
  };

  const handleHistoryClick = (historyItem: SearchHistoryItem) => {
    setSearchQuery({ ...historyItem.filters } as ProductListQuery);
    onSearch(historyItem.filters as ProductListQuery);
  };

  const clearSearchHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem('product-search-history');
  };

  const handleTagToggle = (tag: string) => {
    const currentTags = searchQuery.tags || [];
    const newTags = currentTags.includes(tag)
      ? currentTags.filter(t => t !== tag)
      : [...currentTags, tag];
    
    setSearchQuery(prev => ({
      ...prev,
      tags: newTags.length > 0 ? newTags : undefined,
    }));
  };

  const hasActiveFilters = Object.entries(searchQuery).some(([key, value]) => {
    if (key === 'page' || key === 'limit' || key === 'sort' || key === 'order') return false;
    if (key === 'status' && value === 'all') return false;
    return value !== undefined && value !== '' && (Array.isArray(value) ? value.length > 0 : true);
  });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      {/* Search Bar */}
      <div className="p-4">
        <div className="flex gap-3 items-center">
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                placeholder="Search products by name, SKU, description..."
                value={searchQuery.search}
                onChange={(e) => setSearchQuery(prev => ({ ...prev, search: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>
          
          <Button onClick={handleSearch} className="bg-primary text-white px-6">
            Search
          </Button>
          
          <Button
            variant="outline"
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-4"
          >
            {isExpanded ? 'Simple' : 'Advanced'}
          </Button>
          
          {hasActiveFilters && (
            <Button
              variant="outline"
              onClick={handleClear}
              className="px-4 text-gray-600"
            >
              Clear All
            </Button>
          )}
        </div>

        {/* Active Filters Summary */}
        {hasActiveFilters && !isExpanded && (
          <div className="mt-3 flex flex-wrap gap-2">
            {searchQuery.search && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                Search: "{searchQuery.search}"
              </span>
            )}
            {searchQuery.category_id && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                Category: {categories.find(c => c.id === searchQuery.category_id)?.name}
              </span>
            )}
            {searchQuery.tags && searchQuery.tags.length > 0 && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800">
                Tags: {searchQuery.tags.join(', ')}
              </span>
            )}
            {(searchQuery.price_min || searchQuery.price_max) && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-yellow-100 text-yellow-800">
                Price: ${searchQuery.price_min || 0} - ${searchQuery.price_max || '∞'}
              </span>
            )}
            {searchQuery.stock_status && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-red-100 text-red-800">
                Stock: {searchQuery.stock_status.replace('_', ' ')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Advanced Filters */}
      {isExpanded && (
        <div className="border-t border-gray-200 p-4 bg-gray-50">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {/* Category Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select
                value={searchQuery.category_id || ''}
                onChange={(e) => setSearchQuery(prev => ({ 
                  ...prev, 
                  category_id: e.target.value || undefined 
                }))}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={searchQuery.status}
                onChange={(e) => setSearchQuery(prev => ({ ...prev, status: e.target.value as any }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All Products</option>
                <option value="active">Active Only</option>
                <option value="inactive">Inactive Only</option>
              </select>
            </div>

            {/* Stock Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stock Status</label>
              <select
                value={searchQuery.stock_status || ''}
                onChange={(e) => setSearchQuery(prev => ({ 
                  ...prev, 
                  stock_status: e.target.value || undefined 
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Stock Levels</option>
                <option value="in_stock">In Stock</option>
                <option value="low_stock">Low Stock</option>
                <option value="out_of_stock">Out of Stock</option>
                <option value="no_tracking">No Tracking</option>
              </select>
            </div>

            {/* Price Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={searchQuery.price_min || ''}
                onChange={(e) => setSearchQuery(prev => ({ 
                  ...prev, 
                  price_min: e.target.value ? parseFloat(e.target.value) : undefined 
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={searchQuery.price_max || ''}
                onChange={(e) => setSearchQuery(prev => ({ 
                  ...prev, 
                  price_max: e.target.value ? parseFloat(e.target.value) : undefined 
                }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="999.99"
              />
            </div>

            {/* Sort Options */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
              <div className="flex gap-2">
                <select
                  value={searchQuery.sort}
                  onChange={(e) => setSearchQuery(prev => ({ ...prev, sort: e.target.value as any }))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="created_at">Date Created</option>
                  <option value="updated_at">Last Updated</option>
                  <option value="name">Name</option>
                  <option value="price_cents">Price</option>
                  <option value="stock_quantity">Stock Level</option>
                </select>
                
                <select
                  value={searchQuery.order}
                  onChange={(e) => setSearchQuery(prev => ({ ...prev, order: e.target.value as 'asc' | 'desc' }))}
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            </div>
          </div>

          {/* Product Type Toggles */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Product Type</label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={searchQuery.is_featured}
                  onChange={(e) => setSearchQuery(prev => ({ 
                    ...prev, 
                    is_featured: e.target.checked ? true : undefined 
                  }))}
                  className="mr-2"
                />
                <span className="text-sm">Featured Only</span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={searchQuery.is_digital}
                  onChange={(e) => setSearchQuery(prev => ({ 
                    ...prev, 
                    is_digital: e.target.checked ? true : undefined 
                  }))}
                  className="mr-2"
                />
                <span className="text-sm">Digital Products Only</span>
              </label>
            </div>
          </div>

          {/* Popular Tags */}
          {popularTags.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Popular Tags</label>
              <div className="flex flex-wrap gap-2">
                {popularTags.slice(0, 15).map((tag: string) => {
                  const isSelected = searchQuery.tags?.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => handleTagToggle(tag)}
                      className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search History */}
          {searchHistory.length > 0 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">Recent Searches</label>
                <button
                  onClick={clearSearchHistory}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear History
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleHistoryClick(item)}
                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                  >
                    {item.query} ({item.timestamp.toLocaleDateString()})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-300">
            <Button variant="outline" onClick={handleClear}>
              Clear All Filters
            </Button>
            <Button onClick={handleSearch} className="bg-primary text-white">
              Apply Filters
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}