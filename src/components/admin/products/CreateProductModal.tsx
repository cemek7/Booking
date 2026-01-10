'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { CreateProductRequest, PRODUCT_VALIDATION_RULES } from '@/types/product-catalogue';
import Button from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { authFetch, authPost } from '@/lib/auth/auth-api-client';

interface CreateProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateProductModal({ isOpen, onClose, onSuccess }: CreateProductModalProps) {
  const { tenant } = useTenant();
  const [formData, setFormData] = useState<CreateProductRequest>({
    name: '',
    description: '',
    short_description: '',
    sku: '',
    price_cents: 0,
    currency: 'USD',
    cost_price_cents: 0,
    track_inventory: false,
    stock_quantity: 0,
    low_stock_threshold: 5,
    brand: '',
    is_active: true,
    is_featured: false,
    is_digital: false,
    upsell_priority: 0,
    tags: [],
    images: [],
    metadata: {},
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch categories for dropdown
  const { data: categoriesData } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) return { categories: [] };
      
      const response = await authFetch('/api/categories?is_active=true');
      
      if (response.error) throw new Error('Failed to fetch categories');
      return response.data;
    },
    enabled: !!tenant?.id && isOpen,
  });

  const categories = categoriesData?.categories || [];

  // Create product mutation
  const createProductMutation = useMutation({
    mutationFn: async (productData: CreateProductRequest) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const response = await authPost('/api/products', productData);
      
      if (response.error) {
        throw new Error(response.error || 'Failed to create product');
      }

      return response.data;
    },
    onSuccess: () => {
      toast.success('Product created successfully');
      onSuccess();
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create product');
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Required fields
    if (!formData.name?.trim()) {
      newErrors.name = 'Product name is required';
    }

    if (formData.price_cents < 0) {
      newErrors.price_cents = 'Price must be non-negative';
    }

    if (formData.cost_price_cents < 0) {
      newErrors.cost_price_cents = 'Cost price must be non-negative';
    }

    if (formData.stock_quantity < 0) {
      newErrors.stock_quantity = 'Stock quantity must be non-negative';
    }

    if (formData.low_stock_threshold < 0) {
      newErrors.low_stock_threshold = 'Low stock threshold must be non-negative';
    }

    // SKU format validation
    if (formData.sku && !/^[A-Za-z0-9-_]+$/.test(formData.sku)) {
      newErrors.sku = 'SKU can only contain letters, numbers, hyphens, and underscores';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (key: keyof CreateProductRequest, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    // Clear error for this field
    if (errors[key]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[key];
        return newErrors;
      });
    }
  };

  const handleTagsChange = (value: string) => {
    const tags = value
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    handleInputChange('tags', tags);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      short_description: '',
      sku: '',
      price_cents: 0,
      currency: 'USD',
      cost_price_cents: 0,
      track_inventory: false,
      stock_quantity: 0,
      low_stock_threshold: 5,
      brand: '',
      is_active: true,
      is_featured: false,
      is_digital: false,
      upsell_priority: 0,
      tags: [],
      images: [],
      metadata: {},
    });
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    // Convert price from dollars to cents if needed
    const submissionData = {
      ...formData,
      name: formData.name.trim(),
      description: formData.description?.trim(),
      short_description: formData.short_description?.trim(),
      sku: formData.sku?.trim().toUpperCase(),
      brand: formData.brand?.trim(),
    };

    createProductMutation.mutate(submissionData);
  };

  const handleClose = () => {
    if (!createProductMutation.isLoading) {
      resetForm();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-xl font-semibold">Create New Product</h2>
                <p className="text-sm text-gray-600 mt-1">Add a new product to your catalog</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={createProductMutation.isLoading}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-6">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Basic Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Enter product name"
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
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.sku ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="PROD-001"
                  />
                  {errors.sku && <p className="text-red-500 text-sm mt-1">{errors.sku}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    value={formData.category_id || ''}
                    onChange={(e) => handleInputChange('category_id', e.target.value || undefined)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Category</option>
                    {categories.map((category: any) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Short Description
                  </label>
                  <input
                    type="text"
                    value={formData.short_description}
                    onChange={(e) => handleInputChange('short_description', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Brief product description"
                    maxLength={500}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Detailed product description"
                    rows={3}
                  />
                </div>
              </div>
            </div>

            {/* Pricing */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Pricing</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Price ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price_cents / 100}
                    onChange={(e) => handleInputChange('price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.price_cents ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="0.00"
                  />
                  {errors.price_cents && <p className="text-red-500 text-sm mt-1">{errors.price_cents}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.cost_price_cents / 100}
                    onChange={(e) => handleInputChange('cost_price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.cost_price_cents ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="0.00"
                  />
                  {errors.cost_price_cents && <p className="text-red-500 text-sm mt-1">{errors.cost_price_cents}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Currency
                  </label>
                  <select
                    value={formData.currency}
                    onChange={(e) => handleInputChange('currency', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Inventory */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Inventory</h3>
              
              <div className="space-y-4">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.track_inventory}
                    onChange={(e) => handleInputChange('track_inventory', e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">Track inventory for this product</span>
                </label>

                {formData.track_inventory && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Stock Quantity
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.stock_quantity}
                        onChange={(e) => handleInputChange('stock_quantity', parseInt(e.target.value || '0'))}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                          errors.stock_quantity ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="0"
                      />
                      {errors.stock_quantity && <p className="text-red-500 text-sm mt-1">{errors.stock_quantity}</p>}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Low Stock Threshold
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.low_stock_threshold}
                        onChange={(e) => handleInputChange('low_stock_threshold', parseInt(e.target.value || '5'))}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                          errors.low_stock_threshold ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="5"
                      />
                      {errors.low_stock_threshold && <p className="text-red-500 text-sm mt-1">{errors.low_stock_threshold}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Additional Details */}
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Additional Details</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Brand
                  </label>
                  <input
                    type="text"
                    value={formData.brand}
                    onChange={(e) => handleInputChange('brand', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Brand name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Upsell Priority
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.upsell_priority}
                    onChange={(e) => handleInputChange('upsell_priority', parseInt(e.target.value || '0'))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">Higher values = more likely to be recommended</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tags
                  </label>
                  <input
                    type="text"
                    value={formData.tags?.join(', ') || ''}
                    onChange={(e) => handleTagsChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="hair, color, treatment (comma separated)"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.is_featured}
                    onChange={(e) => handleInputChange('is_featured', e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">Feature this product</span>
                </label>

                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.is_digital}
                    onChange={(e) => handleInputChange('is_digital', e.target.checked)}
                    className="mr-2"
                  />
                  <span className="text-sm">Digital product (no shipping required)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createProductMutation.isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createProductMutation.isLoading}
              className="bg-primary text-white"
            >
              {createProductMutation.isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Creating...
                </>
              ) : (
                'Create Product'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}