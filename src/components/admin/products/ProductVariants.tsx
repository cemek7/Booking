'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductVariant, CreateVariantRequest } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

interface ProductVariantsProps {
  productId: string;
  productName: string;
}

export default function ProductVariants({ productId, productName }: ProductVariantsProps) {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);

  // Fetch user role for permissions
  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  // Fetch variants for this product
  const { data: variantsData, isLoading } = useQuery({
    queryKey: ['product-variants', productId, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}/variants`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch variants');
      return res.json();
    },
    enabled: !!tenant?.id && !!productId,
  });

  const variants = variantsData?.variants || [];
  const canEdit = userRole && ['superadmin', 'owner', 'manager'].includes(userRole);

  // Create variant mutation
  const createVariantMutation = useMutation({
    mutationFn: async (variantData: CreateVariantRequest) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}/variants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(variantData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create variant');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Variant created successfully');
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['product-variants', productId, tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create variant');
    },
  });

  // Update variant mutation
  const updateVariantMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CreateVariantRequest> }) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}/variants/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update variant');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Variant updated successfully');
      setEditingVariant(null);
      queryClient.invalidateQueries({ queryKey: ['product-variants', productId, tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update variant');
    },
  });

  // Delete variant mutation
  const deleteVariantMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${productId}/variants/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete variant');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Variant deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['product-variants', productId, tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete variant');
    },
  });

  const handleDelete = async (variant: ProductVariant) => {
    if (!confirm(`Are you sure you want to delete variant "${variant.name}"? This action cannot be undone.`)) {
      return;
    }

    deleteVariantMutation.mutate(variant.id);
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-lg font-medium">Product Variants</h3>
            <p className="text-sm text-gray-600 mt-1">
              Manage different versions of {productName}
            </p>
          </div>

          {canEdit && (
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary text-white"
            >
              Add Variant
            </Button>
          )}
        </div>
      </div>

      {/* Variants Table */}
      {variants.length === 0 ? (
        <div className="p-12 text-center">
          <div className="mx-auto max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-2">No variants found</h3>
            <p className="text-gray-500 mb-6">
              Create variants for different sizes, colors, or types of this product.
            </p>
            {canEdit && (
              <Button
                onClick={() => setShowCreateModal(true)}
                className="bg-primary text-white"
              >
                Create First Variant
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>SKU</TH>
              <TH>Price Adjustment</TH>
              <TH>Weight/Volume</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              {canEdit && <TH>Actions</TH>}
            </TR>
          </THead>
          <TBody>
            {variants.map((variant: ProductVariant) => (
              <TR key={variant.id}>
                <TD>
                  <div>
                    <div className="font-medium">{variant.name}</div>
                    {variant.description && (
                      <div className="text-sm text-gray-500">{variant.description}</div>
                    )}
                  </div>
                </TD>
                <TD className="text-gray-600">{variant.sku || '-'}</TD>
                <TD>
                  {variant.price_adjustment_cents !== 0 && (
                    <span className={`font-medium ${
                      variant.price_adjustment_cents > 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {variant.price_adjustment_cents > 0 ? '+' : ''}
                      ${(variant.price_adjustment_cents / 100).toFixed(2)}
                    </span>
                  )}
                  {variant.price_adjustment_cents === 0 && (
                    <span className="text-gray-500">No adjustment</span>
                  )}
                </TD>
                <TD className="text-gray-600">
                  {variant.weight_grams && `${variant.weight_grams}g`}
                  {variant.volume_ml && `${variant.volume_ml}ml`}
                  {!variant.weight_grams && !variant.volume_ml && '-'}
                </TD>
                <TD>
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    variant.is_active 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {variant.is_active ? 'Active' : 'Inactive'}
                  </span>
                </TD>
                <TD className="text-gray-500">
                  {new Date(variant.created_at).toLocaleDateString()}
                </TD>
                {canEdit && (
                  <TD>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingVariant(variant)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(variant)}
                        disabled={deleteVariantMutation.isLoading}
                        className="text-red-600 border-red-300 hover:bg-red-50"
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create Variant Modal */}
      {showCreateModal && (
        <VariantModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSubmit={(data) => createVariantMutation.mutate(data)}
          isLoading={createVariantMutation.isLoading}
          title="Create New Variant"
          productName={productName}
        />
      )}

      {/* Edit Variant Modal */}
      {editingVariant && (
        <VariantModal
          isOpen={!!editingVariant}
          onClose={() => setEditingVariant(null)}
          onSubmit={(data) => updateVariantMutation.mutate({ id: editingVariant.id, data })}
          isLoading={updateVariantMutation.isLoading}
          title="Edit Variant"
          productName={productName}
          initialData={{
            name: editingVariant.name,
            description: editingVariant.description,
            sku: editingVariant.sku,
            price_adjustment_cents: editingVariant.price_adjustment_cents,
            weight_grams: editingVariant.weight_grams,
            volume_ml: editingVariant.volume_ml,
            is_active: editingVariant.is_active,
            attributes: editingVariant.attributes,
          }}
        />
      )}
    </div>
  );
}

interface VariantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateVariantRequest) => void;
  isLoading: boolean;
  title: string;
  productName: string;
  initialData?: Partial<CreateVariantRequest>;
}

function VariantModal({ 
  isOpen, 
  onClose, 
  onSubmit, 
  isLoading, 
  title, 
  productName,
  initialData 
}: VariantModalProps) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    sku: initialData?.sku || '',
    price_adjustment_cents: initialData?.price_adjustment_cents || 0,
    weight_grams: initialData?.weight_grams || undefined,
    volume_ml: initialData?.volume_ml || undefined,
    is_active: initialData?.is_active ?? true,
    attributes: initialData?.attributes || {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = 'Variant name is required';
    }

    if (formData.weight_grams && formData.weight_grams < 0) {
      newErrors.weight_grams = 'Weight must be non-negative';
    }

    if (formData.volume_ml && formData.volume_ml < 0) {
      newErrors.volume_ml = 'Volume must be non-negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const submissionData = {
      ...formData,
      name: formData.name.trim(),
      description: formData.description?.trim(),
      sku: formData.sku?.trim().toUpperCase(),
    };

    onSubmit(submissionData);
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
              <div>
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="text-sm text-gray-600 mt-1">For {productName}</p>
              </div>
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
                Variant Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="e.g., Large, Red, Professional"
                disabled={isLoading}
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SKU
              </label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => handleInputChange('sku', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="PROD-001-VAR"
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Variant description"
                rows={2}
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Price Adjustment ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price_adjustment_cents / 100}
                onChange={(e) => handleInputChange('price_adjustment_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="0.00"
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                Positive values increase price, negative values decrease price
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight (grams)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.weight_grams || ''}
                  onChange={(e) => handleInputChange('weight_grams', e.target.value ? parseFloat(e.target.value) : undefined)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                    errors.weight_grams ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="0"
                  disabled={isLoading}
                />
                {errors.weight_grams && <p className="text-red-500 text-sm mt-1">{errors.weight_grams}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Volume (ml)
                </label>
                <input
                  type="number"
                  min="0"
                  value={formData.volume_ml || ''}
                  onChange={(e) => handleInputChange('volume_ml', e.target.value ? parseFloat(e.target.value) : undefined)}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                    errors.volume_ml ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="0"
                  disabled={isLoading}
                />
                {errors.volume_ml && <p className="text-red-500 text-sm mt-1">{errors.volume_ml}</p>}
              </div>
            </div>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => handleInputChange('is_active', e.target.checked)}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm">Active variant</span>
            </label>
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
                  Saving...
                </>
              ) : (
                'Save Variant'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}