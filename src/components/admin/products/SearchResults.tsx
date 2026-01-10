'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { Product, ProductListQuery } from '@/types/product-catalogue';
import ProductGrid from './ProductGrid';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import Button from '@/components/ui/button';

interface SearchResultsProps {
  searchQuery: ProductListQuery;
  viewMode: 'table' | 'grid';
  onViewModeChange: (mode: 'table' | 'grid') => void;
  onProductSelect?: (product: Product) => void;
}

export default function SearchResults({ 
  searchQuery, 
  viewMode, 
  onViewModeChange, 
  onProductSelect 
}: SearchResultsProps) {
  const { tenant } = useTenant();
  const [currentPage, setCurrentPage] = useState(searchQuery.page || 1);

  // Build query URL
  const buildQueryUrl = (query: ProductListQuery, page: number) => {
    const params = new URLSearchParams();
    
    Object.entries({ ...query, page }).forEach(([key, value]) => {
      if (value !== undefined && value !== '' && value !== 'all') {
        if (Array.isArray(value)) {
          params.append(key, value.join(','));
        } else {
          params.append(key, value.toString());
        }
      }
    });

    return `/api/products?${params.toString()}`;
  };

  // Fetch search results
  const { data: resultsData, isLoading, error } = useQuery({
    queryKey: ['product-search', tenant?.id, searchQuery, currentPage],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const url = buildQueryUrl(searchQuery, currentPage);
      const res = await fetch(url, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  const products = resultsData?.products || [];
  const pagination = resultsData?.pagination || {};
  const stats = resultsData?.stats || {};

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const formatSearchTime = (searchTime?: number) => {
    if (!searchTime) return '';
    return searchTime < 1 ? `${Math.round(searchTime * 1000)}ms` : `${searchTime.toFixed(2)}s`;
  };

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center">
        <div className="text-red-500 mb-2">
          <svg className="h-12 w-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Search Error</h3>
        <p className="text-gray-600">Failed to search products. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Results Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-4">
            <h3 className="text-lg font-medium text-gray-900">Search Results</h3>
            {!isLoading && (
              <div className="text-sm text-gray-600">
                {pagination.total_items || 0} products found
                {stats.search_time && ` in ${formatSearchTime(stats.search_time)}`}
              </div>
            )}
          </div>

          {/* View Mode Toggle */}
          <div className="flex border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => onViewModeChange('table')}
              className={`px-3 py-1 text-sm ${
                viewMode === 'table'
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Table
            </button>
            <button
              onClick={() => onViewModeChange('grid')}
              className={`px-3 py-1 text-sm ${
                viewMode === 'grid'
                  ? 'bg-primary text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Grid
            </button>
          </div>
        </div>

        {/* Search Summary */}
        {!isLoading && searchQuery.search && (
          <div className="text-sm text-gray-600">
            Showing results for "{searchQuery.search}"
            {searchQuery.category_id && ` in selected category`}
            {searchQuery.tags && searchQuery.tags.length > 0 && ` with tags: ${searchQuery.tags.join(', ')}`}
          </div>
        )}

        {/* Quick Stats */}
        {!isLoading && stats && (
          <div className="flex gap-6 mt-3 text-xs text-gray-500">
            {stats.active_count !== undefined && (
              <span>Active: {stats.active_count}</span>
            )}
            {stats.featured_count !== undefined && (
              <span>Featured: {stats.featured_count}</span>
            )}
            {stats.low_stock_count !== undefined && (
              <span>Low Stock: {stats.low_stock_count}</span>
            )}
            {stats.avg_price !== undefined && (
              <span>Avg Price: ${(stats.avg_price / 100).toFixed(2)}</span>
            )}
          </div>
        )}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="animate-pulse space-y-4">
            <div className="flex justify-between items-center">
              <div className="h-4 bg-gray-200 rounded w-32"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
            </div>
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="bg-gray-100 rounded-lg h-64"></div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded"></div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* No Results */}
      {!isLoading && products.length === 0 && (
        <div className="bg-white rounded-lg shadow-sm p-12 text-center">
          <svg className="h-16 w-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.48-.653-6.32-1.789M12 15v2m-6.32-1.789l7.08.72.72 7.08M5 6.91L8.91 3h6.18L19 6.91V17.09L15.09 21H8.91L5 17.09V6.91z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
          <p className="text-gray-600 mb-4">
            {searchQuery.search
              ? `No products match your search for "${searchQuery.search}"`
              : 'No products match your current filters'
            }
          </p>
          <div className="space-y-2 text-sm text-gray-500">
            <p>Try adjusting your search criteria:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Check spelling and try different keywords</li>
              <li>Use broader search terms</li>
              <li>Remove some filters</li>
              <li>Try searching by SKU or product category</li>
            </ul>
          </div>
        </div>
      )}

      {/* Results Display */}
      {!isLoading && products.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {viewMode === 'grid' ? (
            <div className="p-4">
              <ProductGrid 
                products={products} 
                onProductClick={onProductSelect}
              />
            </div>
          ) : (
            <SearchResultsTable 
              products={products} 
              searchQuery={searchQuery}
              onProductClick={onProductSelect}
            />
          )}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && products.length > 0 && pagination.total_pages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={pagination.total_pages}
          totalItems={pagination.total_items}
          itemsPerPage={pagination.items_per_page}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
}

interface SearchResultsTableProps {
  products: Product[];
  searchQuery: ProductListQuery;
  onProductClick?: (product: Product) => void;
}

function SearchResultsTable({ products, searchQuery, onProductClick }: SearchResultsTableProps) {
  const highlightText = (text: string, search?: string) => {
    if (!search || !text) return text;
    
    const regex = new RegExp(`(${search})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 px-1 rounded">{part}</mark>
      ) : part
    );
  };

  const getStockStatus = (product: Product) => {
    if (!product.track_inventory) return { text: 'No tracking', color: 'text-gray-500' };
    if (product.stock_quantity <= 0) return { text: 'Out of stock', color: 'text-red-600' };
    if (product.stock_quantity <= product.low_stock_threshold) return { text: 'Low stock', color: 'text-yellow-600' };
    return { text: 'In stock', color: 'text-green-600' };
  };

  return (
    <Table>
      <THead>
        <TR>
          <TH>Product</TH>
          <TH>SKU</TH>
          <TH>Category</TH>
          <TH>Price</TH>
          <TH>Stock</TH>
          <TH>Status</TH>
          <TH>Updated</TH>
        </TR>
      </THead>
      <TBody>
        {products.map((product) => {
          const stockStatus = getStockStatus(product);
          
          return (
            <TR 
              key={product.id}
              className="cursor-pointer hover:bg-gray-50"
              onClick={() => onProductClick?.(product)}
            >
              <TD>
                <div>
                  <div className="font-medium">
                    {highlightText(product.name, searchQuery.search)}
                  </div>
                  {product.short_description && (
                    <div className="text-sm text-gray-600 mt-1">
                      {highlightText(product.short_description, searchQuery.search)}
                    </div>
                  )}
                  {product.tags && product.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {product.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className={`inline-flex px-1 py-0.5 text-xs rounded ${
                            searchQuery.tags?.includes(tag)
                              ? 'bg-primary text-white'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {tag}
                        </span>
                      ))}
                      {product.tags.length > 3 && (
                        <span className="inline-flex px-1 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                          +{product.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </TD>
              <TD className="text-gray-600">
                {highlightText(product.sku || '-', searchQuery.search)}
              </TD>
              <TD className="text-gray-600">
                {product.category?.name || 'Uncategorized'}
              </TD>
              <TD>
                <span className="font-medium text-green-600">
                  ${(product.price_cents / 100).toFixed(2)}
                </span>
              </TD>
              <TD>
                {product.track_inventory ? (
                  <span className={stockStatus.color}>
                    {product.stock_quantity}
                  </span>
                ) : (
                  <span className="text-gray-500">-</span>
                )}
              </TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                    product.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </span>
                  {product.is_featured && (
                    <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                      Featured
                    </span>
                  )}
                  {product.is_digital && (
                    <span className="inline-flex px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                      Digital
                    </span>
                  )}
                </div>
              </TD>
              <TD className="text-gray-500 text-sm">
                {new Date(product.updated_at).toLocaleDateString()}
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

function Pagination({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange }: PaginationProps) {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const getPageNumbers = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    for (
      let i = Math.max(2, currentPage - delta);
      i <= Math.min(totalPages - 1, currentPage + delta);
      i++
    ) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push('...', totalPages);
    } else if (totalPages > 1) {
      rangeWithDots.push(totalPages);
    }

    return rangeWithDots;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Showing {startItem} to {endItem} of {totalItems} results
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            Previous
          </Button>

          {getPageNumbers().map((page, index) => (
            <button
              key={index}
              onClick={() => typeof page === 'number' ? onPageChange(page) : null}
              disabled={page === '...'}
              className={`px-3 py-1 text-sm rounded ${
                page === currentPage
                  ? 'bg-primary text-white'
                  : page === '...'
                  ? 'text-gray-400 cursor-default'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {page}
            </button>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}