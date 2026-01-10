'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductWithDetails, UpdateProductRequest } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import ProductVariants from '@/components/admin/products/ProductVariants';

interface ProductDetailPageProps {
  params: {
    id: string;
  };
}

export default function ProductDetailPage({ params }: ProductDetailPageProps) {
  const router = useRouter();
  const { tenant } = useTenant();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<UpdateProductRequest>>({});

  // Fetch product details
  const { data: productData, isLoading } = useQuery({
    queryKey: ['product', params.id, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${params.id}`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Product not found');
        }
        throw new Error('Failed to fetch product');
      }

      return res.json();
    },
    enabled: !!tenant?.id && !!params.id,
  });

  const product = productData?.product as ProductWithDetails;

  // Fetch user role for permissions
  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  const canEdit = userRole && ['superadmin', 'owner', 'manager'].includes(userRole);

  // Update product mutation
  const updateProductMutation = useMutation({
    mutationFn: async (updateData: UpdateProductRequest) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${params.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(updateData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update product');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Product updated successfully');
      setIsEditing(false);
      setEditData({});
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update product');
    },
  });

  // Delete product mutation
  const deleteProductMutation = useMutation({
    mutationFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/products/${params.id}`, {
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
      toast.success('Product deleted successfully');
      router.push('/dashboard/products');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete product');
    },
  });

  const handleEdit = () => {
    if (!product) return;
    setEditData({
      name: product.name,
      description: product.description,
      short_description: product.short_description,
      price_cents: product.price_cents,
      cost_price_cents: product.cost_price_cents,
      brand: product.brand,
      is_active: product.is_active,
      is_featured: product.is_featured,
      is_digital: product.is_digital,
      upsell_priority: product.upsell_priority,
      tags: product.tags,
      metadata: product.metadata,
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (Object.keys(editData).length === 0) {
      setIsEditing(false);
      return;
    }

    updateProductMutation.mutate(editData as UpdateProductRequest);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditData({});
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this product? This action cannot be undone.')) {
      return;
    }

    deleteProductMutation.mutate();
  };

  const handleInputChange = (key: keyof UpdateProductRequest, value: any) => {
    setEditData(prev => ({ ...prev, [key]: value }));
  };

  const handleTagsChange = (value: string) => {
    const tags = value
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);
    handleInputChange('tags', tags);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-sm p-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Product Not Found</h1>
            <p className="text-gray-600 mb-4">The product you're looking for doesn't exist or has been removed.</p>
            <Button onClick={() => router.push('/dashboard/products')}>
              Back to Products
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const stockStatus = (() => {
    if (!product.track_inventory) return 'No tracking';
    if (product.stock_quantity <= 0) return 'Out of stock';
    if (product.stock_quantity <= product.low_stock_threshold) return 'Low stock';
    return 'In stock';
  })();

  const stockStatusColor = (() => {
    if (!product.track_inventory) return 'text-gray-500';
    if (product.stock_quantity <= 0) return 'text-red-600';
    if (product.stock_quantity <= product.low_stock_threshold) return 'text-yellow-600';
    return 'text-green-600';
  })();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <button
              onClick={() => router.push('/dashboard/products')}
              className="text-primary hover:text-primary-dark mb-2 text-sm"
            >
              ← Back to Products
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              {isEditing ? (
                <input
                  type="text"
                  value={editData.name || product.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="text-3xl font-bold bg-transparent border-b border-gray-300 focus:border-primary focus:outline-none"
                />
              ) : (
                product.name
              )}
            </h1>
          </div>

          {canEdit && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <Button
                    variant="outline"
                    onClick={handleCancel}
                    disabled={updateProductMutation.isLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={updateProductMutation.isLoading}
                  >
                    {updateProductMutation.isLoading ? 'Saving...' : 'Save Changes'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={handleEdit}>
                    Edit Product
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleDelete}
                    disabled={deleteProductMutation.isLoading}
                    className="text-red-600 border-red-300 hover:bg-red-50"
                  >
                    {deleteProductMutation.isLoading ? 'Deleting...' : 'Delete'}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product Images */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Product Images</h3>
              {product.images && product.images.length > 0 ? (
                <div className="space-y-2">
                  {product.images.map((image, index) => (
                    <img
                      key={index}
                      src={image}
                      alt={`${product.name} ${index + 1}`}
                      className="w-full h-48 object-cover rounded"
                    />
                  ))}
                </div>
              ) : (
                <div className="w-full h-48 bg-gray-100 rounded flex items-center justify-center">
                  <span className="text-gray-500">No images available</span>
                </div>
              )}
            </div>
          </div>

          {/* Product Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Basic Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
                  <p className="text-sm text-gray-900">{product.sku || 'Not set'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <p className="text-sm text-gray-900">{product.category?.name || 'Uncategorized'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editData.brand || product.brand || ''}
                      onChange={(e) => handleInputChange('brand', e.target.value)}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <p className="text-sm text-gray-900">{product.brand || 'Not specified'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      product.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {product.is_active ? 'Active' : 'Inactive'}
                    </span>
                    {product.is_featured && (
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                        Featured
                      </span>
                    )}
                    {product.is_digital && (
                      <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        Digital
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Short Description</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editData.short_description || product.short_description || ''}
                    onChange={(e) => handleInputChange('short_description', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <p className="text-sm text-gray-900">{product.short_description || 'No short description'}</p>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                {isEditing ? (
                  <textarea
                    value={editData.description || product.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={4}
                  />
                ) : (
                  <p className="text-sm text-gray-900">{product.description || 'No description available'}</p>
                )}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editData.tags?.join(', ') || product.tags?.join(', ') || ''}
                    onChange={(e) => handleTagsChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder="Enter tags separated by commas"
                  />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {product.tags && product.tags.length > 0 ? (
                      product.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-gray-500">No tags</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Pricing */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Pricing</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={(editData.price_cents || product.price_cents) / 100}
                      onChange={(e) => handleInputChange('price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <p className="text-lg font-semibold text-green-600">
                      ${(product.price_cents / 100).toFixed(2)} {product.currency}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost Price</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={(editData.cost_price_cents || product.cost_price_cents || 0) / 100}
                      onChange={(e) => handleInputChange('cost_price_cents', Math.round(parseFloat(e.target.value || '0') * 100))}
                      className="w-full px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <p className="text-sm text-gray-900">
                      ${((product.cost_price_cents || 0) / 100).toFixed(2)}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Profit Margin</label>
                  <p className="text-sm text-gray-900">
                    {product.cost_price_cents ? 
                      (((product.price_cents - product.cost_price_cents) / product.price_cents) * 100).toFixed(1) + '%' 
                      : 'N/A'
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Inventory */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Inventory</h3>
              
              {product.track_inventory ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stock Quantity</label>
                    <p className={`text-lg font-semibold ${stockStatusColor}`}>
                      {product.stock_quantity}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Low Stock Threshold</label>
                    <p className="text-sm text-gray-900">{product.low_stock_threshold}</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <p className={`text-sm font-medium ${stockStatusColor}`}>
                      {stockStatus}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">Inventory tracking is disabled for this product</p>
              )}
            </div>

            {/* Additional Settings */}
            {isEditing && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-medium mb-4">Settings</h3>
                
                <div className="space-y-3">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editData.is_active ?? product.is_active}
                      onChange={(e) => handleInputChange('is_active', e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">Active</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editData.is_featured ?? product.is_featured}
                      onChange={(e) => handleInputChange('is_featured', e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">Featured product</span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editData.is_digital ?? product.is_digital}
                      onChange={(e) => handleInputChange('is_digital', e.target.checked)}
                      className="mr-2"
                    />
                    <span className="text-sm">Digital product</span>
                  </label>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Upsell Priority</label>
                  <input
                    type="number"
                    min="0"
                    value={editData.upsell_priority ?? product.upsell_priority}
                    onChange={(e) => handleInputChange('upsell_priority', parseInt(e.target.value || '0'))}
                    className="w-24 px-3 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-xs text-gray-500 mt-1">Higher values = more likely to be recommended</p>
                </div>
              </div>
            )}

            {/* Variants and Related Products */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-medium mb-4">Related Information</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Created</label>
                  <p className="text-sm text-gray-600">
                    {new Date(product.created_at).toLocaleDateString()} at{' '}
                    {new Date(product.created_at).toLocaleTimeString()}
                  </p>
                  
                  <label className="block text-sm font-medium text-gray-700 mb-2 mt-3">Last Updated</label>
                  <p className="text-sm text-gray-600">
                    {new Date(product.updated_at).toLocaleDateString()} at{' '}
                    {new Date(product.updated_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Product Variants Section */}
          <div className="lg:col-span-3 mt-6">
            <ProductVariants 
              productId={product.id} 
              productName={product.name} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}