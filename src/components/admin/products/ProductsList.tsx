'use client';

import React, { memo, useCallback } from 'react';
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from "@/lib/supabase/tenant-context";
import { Product, ProductListQuery, PRODUCT_ROLE_PERMISSIONS, ProductPermissions } from '@/types/product-catalogue';
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Button from "@/components/ui/button";
import { toast } from '@/components/ui/toast';
import ProductFilters from './ProductFilters';
import ProductGrid from './ProductGrid';
import CreateProductModal from './CreateProductModal';

interface ProductTableRowProps {
  product: Product;
  permissions: ProductPermissions;
  onEdit: (productId: string) => void;
  onDelete: (productId: string, productName: string) => void;
  formatPrice: (priceInCents: number, currency?: string) => string;
  getStockStatus: (product: Product) => { text: string; color: string };
  isDeleting: boolean;
}

const ProductTableRow = memo<ProductTableRowProps>(function ProductTableRow({
  product,
  permissions,
  onEdit,
  onDelete,
  formatPrice,
  getStockStatus,
  isDeleting,
}) {
  const stockStatus = getStockStatus(product);

  const handleEdit = useCallback(() => {
    onEdit(product.id);
  }, [onEdit, product.id]);

  const handleDelete = useCallback(() => {
    onDelete(product.id, product.name);
  }, [onDelete, product.id, product.name]);

  return (
    <TR>
      <TD>
        <div className="flex items-center gap-3">
          {product.images?.length > 0 ? (
            <img
              src={product.images[0]}
              alt={product.name}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div className="h-10 w-10 rounded-lg bg-gray-200 flex items-center justify-center">
              📦
            </div>
          )}
          <div>
            <div className="font-medium">{product.name}</div>
            <div className="text-sm text-gray-500">
              {product.sku && `SKU: ${product.sku}`}
            </div>
          </div>
        </div>
      </TD>
      <TD>
        {product.category?.name || <span className="text-gray-400">Uncategorized</span>}
      </TD>
      <TD>
        <div>
          {formatPrice(product.price_cents, product.currency)}
          {permissions.can_view_cost_prices && product.cost_price_cents > 0 && (
            <div className="text-sm text-gray-500">
              Cost: {formatPrice(product.cost_price_cents, product.currency)}
            </div>
          )}
        </div>
      </TD>
      <TD>
        {product.track_inventory ? (
          <div>
            <span className={stockStatus.color}>
              {product.stock_quantity} units
            </span>
            <div className="text-xs text-gray-500">
              {stockStatus.text}
            </div>
          </div>
        ) : (
          <span className="text-gray-500">Not tracked</span>
        )}
      </TD>
      <TD>
        <div className="flex items-center gap-1">
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
            product.is_active
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {product.is_active ? '🟢 Active' : '⚪ Inactive'}
          </span>
          {product.is_featured && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              ⭐ Featured
            </span>
          )}
        </div>
      </TD>
      <TD>
        <div className="flex items-center gap-2">
          {permissions.can_edit_products && (
            <button
              onClick={handleEdit}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              ✏️ Edit
            </button>
          )}
          {permissions.can_delete_products && (
            <button
              onClick={handleDelete}
              className="text-red-600 hover:text-red-800 text-sm"
              disabled={isDeleting}
            >
              🗑️ Delete
            </button>
          )}
        </div>
      </TD>
    </TR>
  );
});

export default function ProductsList() {
  const { tenant, role } = useTenant();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filters, setFilters] = useState<ProductListQuery>({
    page: 1,
    limit: 20,
    sort: 'created_at',
    order: 'desc',
    status: 'all',
    include_variants: true,
    include_stock_info: true,
  });

  // Get user permissions
  const permissions = PRODUCT_ROLE_PERMISSIONS[role || 'staff'];

  // Fetch products
  const { data: productsData, error, isLoading, refetch } = useQuery({
    queryKey: ['products', tenant?.id, filters],
    queryFn: async () => {
      if (!tenant?.id) return { products: [], pagination: { total: 0 } };
      
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, value.toString());
        }
      });

      const res = await fetch(`/api/products?${params.toString()}`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch products');
      }

      return res.json();
    },
    enabled: !!tenant?.id,
  });

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: async (productId: string) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete product');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
      toast.success('Product deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete product');
    },
  });

  const handleEdit = useCallback((productId: string) => {
    router.push(`/dashboard/products/${productId}`);
  }, [router]);

  const handleDelete = useCallback((productId: string, productName: string) => {
    if (!confirm(`Are you sure you want to delete "${productName}"? This will deactivate the product.`)) return;
    deleteProductMutation.mutate(productId);
  }, [deleteProductMutation]);

  const handleFilterChange = useCallback((newFilters: Partial<ProductListQuery>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setFilters(prev => ({ ...prev, page }));
  }, []);

  const formatPrice = useCallback((priceInCents: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(priceInCents / 100);
  }, []);

  const getStockStatus = useCallback((product: Product) => {
    if (!product.track_inventory) return { text: 'Not tracked', color: 'text-gray-500' };
    if (product.stock_quantity === 0) return { text: 'Out of stock', color: 'text-red-600' };
    if (product.stock_quantity <= product.low_stock_threshold) return { text: 'Low stock', color: 'text-yellow-600' };
    return { text: 'In stock', color: 'text-green-600' };
  }, []);

  const products = productsData?.products || [];
  const pagination = productsData?.pagination || { total: 0, page: 1, totalPages: 1 };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">Error loading products: {error.message}</p>
        <Button onClick={() => refetch()} className="mt-4">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'table' ? 'bg-white shadow-sm' : ''
              }`}
            >
              📋 Table
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-white shadow-sm' : ''
              }`}
            >
              ⊞ Grid
            </button>
          </div>
          <span className="text-sm text-gray-600">
            {pagination.total} products
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {permissions.can_create_products && (
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary text-white"
            >
              ➕ Add Product
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <ProductFilters 
        filters={filters}
        onFilterChange={handleFilterChange}
      />

      {/* Products view */}
      {viewMode === 'grid' ? (
        <ProductGrid 
          products={products}
          permissions={permissions}
          onEdit={handleEdit}
          onDelete={handleDelete}
          formatPrice={formatPrice}
          getStockStatus={getStockStatus}
        />
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Category</TH>
                <TH>Price</TH>
                <TH>Stock</TH>
                <TH>Status</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {products.length === 0 ? (
                <TR>
                  <TD colSpan={6} className="text-center py-8 text-gray-500">
                    No products found. {permissions.can_create_products && (
                      <button 
                        onClick={() => setShowCreateModal(true)}
                        className="text-primary underline ml-1"
                      >
                        Create your first product
                      </button>
                    )}
                  </TD>
                </TR>
              ) : (
                products.map((product) => (
                  <ProductTableRow
                    key={product.id}
                    product={product}
                    permissions={permissions}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    formatPrice={formatPrice}
                    getStockStatus={getStockStatus}
                    isDeleting={deleteProductMutation.isPending}
                  />
                ))
              )}
            </TBody>
          </Table>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing {((pagination.page - 1) * filters.limit!) + 1} to {Math.min(pagination.page * filters.limit!, pagination.total)} of {pagination.total} products
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                >
                  ← Previous
                </Button>
                <span className="text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Product Modal */}
      {showCreateModal && (
        <CreateProductModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
          }}
        />
      )}
    </div>
  );
}