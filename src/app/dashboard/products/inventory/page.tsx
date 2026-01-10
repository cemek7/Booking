'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { Product, InventoryMovement, CreateInventoryMovementRequest } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

export default function InventoryPage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<string | null>(null);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [showMovementHistory, setShowMovementHistory] = useState(false);
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');

  // Fetch user role for permissions
  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  // Fetch products with inventory tracking
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['products-inventory', tenant?.id, stockFilter],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const params = new URLSearchParams({
        track_inventory: 'true',
        include_counts: 'true',
      });

      if (stockFilter === 'low') {
        params.append('stock_status', 'low');
      } else if (stockFilter === 'out') {
        params.append('stock_status', 'out');
      }

      const res = await fetch(`/api/products?${params}`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  // Fetch inventory movements
  const { data: movementsData, isLoading: movementsLoading } = useQuery({
    queryKey: ['inventory-movements', tenant?.id, selectedProduct],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const params = new URLSearchParams({
        limit: '50',
        order_by: 'created_at',
        order_direction: 'desc',
      });

      if (selectedProduct) {
        params.append('product_id', selectedProduct);
      }

      const res = await fetch(`/api/inventory/movements?${params}`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch movements');
      return res.json();
    },
    enabled: !!tenant?.id && showMovementHistory,
  });

  const products = productsData?.products || [];
  const movements = movementsData?.movements || [];
  const canManage = userRole && ['superadmin', 'owner', 'manager'].includes(userRole);

  // Stock adjustment mutation
  const adjustStockMutation = useMutation({
    mutationFn: async (movementData: CreateInventoryMovementRequest) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch('/api/inventory/movements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(movementData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to adjust stock');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Stock adjusted successfully');
      setShowAdjustmentModal(false);
      setSelectedProduct(null);
      queryClient.invalidateQueries({ queryKey: ['products-inventory', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['inventory-movements', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to adjust stock');
    },
  });

  const getStockStatus = (product: Product) => {
    if (!product.track_inventory) return { status: 'No tracking', color: 'text-gray-500' };
    if (product.stock_quantity <= 0) return { status: 'Out of stock', color: 'text-red-600' };
    if (product.stock_quantity <= product.low_stock_threshold) return { status: 'Low stock', color: 'text-yellow-600' };
    return { status: 'In stock', color: 'text-green-600' };
  };

  const getStockAlert = (product: Product) => {
    if (!product.track_inventory) return null;
    if (product.stock_quantity <= 0) return 'error';
    if (product.stock_quantity <= product.low_stock_threshold) return 'warning';
    return null;
  };

  const lowStockCount = products.filter((p: Product) => 
    p.track_inventory && p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold
  ).length;

  const outOfStockCount = products.filter((p: Product) => 
    p.track_inventory && p.stock_quantity <= 0
  ).length;

  const totalValue = products.reduce((sum: number, p: Product) => 
    sum + (p.track_inventory ? (p.cost_price_cents || 0) * p.stock_quantity : 0), 0
  ) / 100;

  if (productsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="h-6 bg-gray-200 rounded w-24 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-16"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Inventory Management</h1>
            <p className="text-gray-600 mt-1">Monitor and manage your product inventory</p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowMovementHistory(!showMovementHistory)}
            >
              {showMovementHistory ? 'Hide' : 'Show'} Movement History
            </Button>
            
            {canManage && (
              <Button
                onClick={() => setShowAdjustmentModal(true)}
                className="bg-primary text-white"
              >
                Adjust Stock
              </Button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Total Products</h3>
            <p className="text-2xl font-bold text-gray-900">{products.length}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Low Stock Alerts</h3>
            <p className="text-2xl font-bold text-yellow-600">{lowStockCount}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Out of Stock</h3>
            <p className="text-2xl font-bold text-red-600">{outOfStockCount}</p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Total Inventory Value</h3>
            <p className="text-2xl font-bold text-green-600">${totalValue.toFixed(2)}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex gap-4 items-center">
            <span className="text-sm font-medium text-gray-700">Filter by stock status:</span>
            
            <div className="flex gap-2">
              <button
                onClick={() => setStockFilter('all')}
                className={`px-3 py-1 text-sm rounded-full ${
                  stockFilter === 'all'
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All Products
              </button>
              
              <button
                onClick={() => setStockFilter('low')}
                className={`px-3 py-1 text-sm rounded-full ${
                  stockFilter === 'low'
                    ? 'bg-yellow-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Low Stock ({lowStockCount})
              </button>
              
              <button
                onClick={() => setStockFilter('out')}
                className={`px-3 py-1 text-sm rounded-full ${
                  stockFilter === 'out'
                    ? 'bg-red-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Out of Stock ({outOfStockCount})
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Inventory Table */}
          <div className={`${showMovementHistory ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-200">
                <h3 className="text-lg font-medium">Product Inventory</h3>
              </div>

              {products.length === 0 ? (
                <div className="p-12 text-center">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No products with inventory tracking</h3>
                  <p className="text-gray-500">Products need to have inventory tracking enabled to appear here.</p>
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Product</TH>
                      <TH>SKU</TH>
                      <TH>Stock Quantity</TH>
                      <TH>Low Stock Threshold</TH>
                      <TH>Status</TH>
                      <TH>Value</TH>
                      {canManage && <TH>Actions</TH>}
                    </TR>
                  </THead>
                  <TBody>
                    {products.map((product: Product) => {
                      const stockStatus = getStockStatus(product);
                      const stockAlert = getStockAlert(product);
                      
                      return (
                        <TR key={product.id} className={stockAlert === 'error' ? 'bg-red-50' : stockAlert === 'warning' ? 'bg-yellow-50' : ''}>
                          <TD>
                            <div className="flex items-center gap-3">
                              {stockAlert && (
                                <div className={`w-2 h-2 rounded-full ${
                                  stockAlert === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                                }`} />
                              )}
                              <span className="font-medium">{product.name}</span>
                            </div>
                          </TD>
                          <TD className="text-gray-600">{product.sku || '-'}</TD>
                          <TD>
                            <span className={`font-medium ${stockStatus.color}`}>
                              {product.stock_quantity}
                            </span>
                          </TD>
                          <TD className="text-gray-600">{product.low_stock_threshold}</TD>
                          <TD>
                            <span className={`text-sm ${stockStatus.color}`}>
                              {stockStatus.status}
                            </span>
                          </TD>
                          <TD className="text-gray-600">
                            ${((product.cost_price_cents || 0) * product.stock_quantity / 100).toFixed(2)}
                          </TD>
                          {canManage && (
                            <TD>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedProduct(product.id);
                                  setShowAdjustmentModal(true);
                                }}
                              >
                                Adjust
                              </Button>
                            </TD>
                          )}
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )}
            </div>
          </div>

          {/* Movement History */}
          {showMovementHistory && (
            <div className="xl:col-span-1">
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-200">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium">Movement History</h3>
                    <button
                      onClick={() => setSelectedProduct(null)}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Clear Filter
                    </button>
                  </div>
                </div>

                <div className="max-h-96 overflow-y-auto">
                  {movementsLoading ? (
                    <div className="p-6">
                      <div className="animate-pulse space-y-3">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-12 bg-gray-200 rounded"></div>
                        ))}
                      </div>
                    </div>
                  ) : movements.length === 0 ? (
                    <div className="p-6 text-center text-gray-500">
                      No movement history found
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {movements.map((movement: InventoryMovement) => (
                        <div key={movement.id} className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-sm">{movement.product?.name}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {movement.movement_type.replace('_', ' ').toUpperCase()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-medium ${
                                movement.quantity_change > 0 ? 'text-green-600' : 'text-red-600'
                              }`}>
                                {movement.quantity_change > 0 ? '+' : ''}{movement.quantity_change}
                              </p>
                              <p className="text-xs text-gray-500">
                                {new Date(movement.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          {movement.notes && (
                            <p className="text-xs text-gray-600 mt-2">{movement.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stock Adjustment Modal */}
        {showAdjustmentModal && (
          <StockAdjustmentModal
            isOpen={showAdjustmentModal}
            onClose={() => {
              setShowAdjustmentModal(false);
              setSelectedProduct(null);
            }}
            onSubmit={(data) => adjustStockMutation.mutate(data)}
            isLoading={adjustStockMutation.isLoading}
            products={products}
            selectedProductId={selectedProduct}
          />
        )}
      </div>
    </div>
  );
}

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateInventoryMovementRequest) => void;
  isLoading: boolean;
  products: Product[];
  selectedProductId: string | null;
}

function StockAdjustmentModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading, 
  products, 
  selectedProductId 
}: StockAdjustmentModalProps) {
  const [formData, setFormData] = useState({
    product_id: selectedProductId || '',
    movement_type: 'adjustment' as const,
    quantity_change: 0,
    reference_id: '',
    notes: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedProduct = products.find(p => p.id === formData.product_id);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.product_id) {
      newErrors.product_id = 'Please select a product';
    }

    if (formData.quantity_change === 0) {
      newErrors.quantity_change = 'Quantity change cannot be zero';
    }

    const newQuantity = (selectedProduct?.stock_quantity || 0) + formData.quantity_change;
    if (newQuantity < 0) {
      newErrors.quantity_change = 'Cannot reduce stock below zero';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    onSubmit(formData);
  };

  const handleInputChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Adjust Stock</h2>
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Product *
              </label>
              <select
                value={formData.product_id}
                onChange={(e) => handleInputChange('product_id', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  errors.product_id ? 'border-red-500' : 'border-gray-300'
                }`}
                disabled={isLoading}
              >
                <option value="">Select a product</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} (Current: {product.stock_quantity})
                  </option>
                ))}
              </select>
              {errors.product_id && <p className="text-red-500 text-sm mt-1">{errors.product_id}</p>}
            </div>

            {selectedProduct && (
              <div className="bg-gray-50 p-3 rounded">
                <p className="text-sm text-gray-600">
                  Current stock: <span className="font-medium">{selectedProduct.stock_quantity}</span>
                </p>
                <p className="text-sm text-gray-600">
                  New stock will be: <span className="font-medium">
                    {selectedProduct.stock_quantity + formData.quantity_change}
                  </span>
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity Change *
              </label>
              <input
                type="number"
                value={formData.quantity_change}
                onChange={(e) => handleInputChange('quantity_change', parseInt(e.target.value || '0'))}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  errors.quantity_change ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter positive or negative number"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                Use positive numbers to increase stock, negative to decrease
              </p>
              {errors.quantity_change && <p className="text-red-500 text-sm mt-1">{errors.quantity_change}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference ID
              </label>
              <input
                type="text"
                value={formData.reference_id}
                onChange={(e) => handleInputChange('reference_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Purchase order, damage report, etc."
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Reason for adjustment..."
                rows={3}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading}
              className="bg-primary text-white"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Adjusting...
                </>
              ) : (
                'Adjust Stock'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}