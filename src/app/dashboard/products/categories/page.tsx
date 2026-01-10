'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductCategory, CreateCategoryRequest, UpdateCategoryRequest } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

export default function CategoriesPage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);

  // Fetch user role for permissions
  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  // Fetch categories
  const { data: categoriesData, isLoading } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch('/api/categories', {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  const categories = categoriesData?.categories || [];
  const canEdit = userRole && ['superadmin', 'owner', 'manager'].includes(userRole);

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: async (categoryData: CreateCategoryRequest) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(categoryData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create category');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Category created successfully');
      setShowCreateModal(false);
      queryClient.invalidateQueries({ queryKey: ['categories', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create category');
    },
  });

  // Update category mutation
  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCategoryRequest }) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update category');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Category updated successfully');
      setEditingCategory(null);
      queryClient.invalidateQueries({ queryKey: ['categories', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update category');
    },
  });

  // Delete category mutation
  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const res = await fetch(`/api/categories/${id}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete category');
      }

      return res.json();
    },
    onSuccess: () => {
      toast.success('Category deleted successfully');
      queryClient.invalidateQueries({ queryKey: ['categories', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete category');
    },
  });

  const handleDelete = async (category: ProductCategory) => {
    if (!confirm(`Are you sure you want to delete "${category.name}"? This action cannot be undone.`)) {
      return;
    }

    deleteCategoryMutation.mutate(category.id);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 rounded w-64 mb-6"></div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-200 rounded"></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Product Categories</h1>
            <p className="text-gray-600 mt-1">Organize your products with categories</p>
          </div>

          {canEdit && (
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-primary text-white"
            >
              Create Category
            </Button>
          )}
        </div>

        {/* Categories Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {categories.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mx-auto max-w-md">
                <h3 className="text-lg font-medium text-gray-900 mb-2">No categories found</h3>
                <p className="text-gray-500 mb-6">Get started by creating your first product category.</p>
                {canEdit && (
                  <Button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-primary text-white"
                  >
                    Create Your First Category
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Description</TH>
                  <TH>Products</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  {canEdit && <TH>Actions</TH>}
                </TR>
              </THead>
              <TBody>
                {categories.map((category: ProductCategory) => (
                  <TR key={category.id}>
                    <TD className="font-medium">{category.name}</TD>
                    <TD className="text-gray-600">
                      {category.description || 'No description'}
                    </TD>
                    <TD>
                      <span className="inline-flex px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded-full">
                        {category._count?.products || 0} products
                      </span>
                    </TD>
                    <TD>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        category.is_active 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {category.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </TD>
                    <TD className="text-gray-500">
                      {new Date(category.created_at).toLocaleDateString()}
                    </TD>
                    {canEdit && (
                      <TD>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingCategory(category)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(category)}
                            disabled={deleteCategoryMutation.isLoading}
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
        </div>

        {/* Create Category Modal */}
        {showCreateModal && (
          <CategoryModal
            isOpen={showCreateModal}
            onClose={() => setShowCreateModal(false)}
            onSubmit={(data) => createCategoryMutation.mutate(data)}
            isLoading={createCategoryMutation.isLoading}
            title="Create New Category"
          />
        )}

        {/* Edit Category Modal */}
        {editingCategory && (
          <CategoryModal
            isOpen={!!editingCategory}
            onClose={() => setEditingCategory(null)}
            onSubmit={(data) => updateCategoryMutation.mutate({ id: editingCategory.id, data })}
            isLoading={updateCategoryMutation.isLoading}
            title="Edit Category"
            initialData={{
              name: editingCategory.name,
              description: editingCategory.description,
              slug: editingCategory.slug,
              parent_id: editingCategory.parent_id,
              is_active: editingCategory.is_active,
              sort_order: editingCategory.sort_order,
              metadata: editingCategory.metadata,
            }}
          />
        )}
      </div>
    </div>
  );
}

interface CategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CreateCategoryRequest | UpdateCategoryRequest) => void;
  isLoading: boolean;
  title: string;
  initialData?: Partial<CreateCategoryRequest>;
}

function CategoryModal({ isOpen, onClose, onSubmit, isLoading, title, initialData }: CategoryModalProps) {
  const [formData, setFormData] = useState({
    name: initialData?.name || '',
    description: initialData?.description || '',
    slug: initialData?.slug || '',
    is_active: initialData?.is_active ?? true,
    sort_order: initialData?.sort_order || 0,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name?.trim()) {
      newErrors.name = 'Category name is required';
    }

    if (formData.sort_order < 0) {
      newErrors.sort_order = 'Sort order must be non-negative';
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
      slug: formData.slug?.trim().toLowerCase() || formData.name.trim().toLowerCase().replace(/\s+/g, '-'),
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
              <h2 className="text-xl font-semibold">{title}</h2>
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
                Category Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Enter category name"
                disabled={isLoading}
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Slug
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => handleInputChange('slug', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="category-slug (auto-generated if empty)"
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
                placeholder="Category description"
                rows={3}
                disabled={isLoading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                min="0"
                value={formData.sort_order}
                onChange={(e) => handleInputChange('sort_order', parseInt(e.target.value || '0'))}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary ${
                  errors.sort_order ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="0"
                disabled={isLoading}
              />
              {errors.sort_order && <p className="text-red-500 text-sm mt-1">{errors.sort_order}</p>}
            </div>

            <label className="flex items-center">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => handleInputChange('is_active', e.target.checked)}
                className="mr-2"
                disabled={isLoading}
              />
              <span className="text-sm">Active category</span>
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
                'Save Category'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}