'use client';

export const dynamic = 'force-dynamic';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { ProductCategory } from '@/types/product-catalogue';
import { getUserRole } from '@/lib/supabase/auth';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

type CategoryActionMode = 'rename' | 'merge' | 'clear';

type CategoryActionState = {
  category: ProductCategory;
  mode: CategoryActionMode;
} | null;

export default function CategoriesPage() {
  const { tenant } = useTenant();
  const queryClient = useQueryClient();
  const [actionState, setActionState] = useState<CategoryActionState>(null);

  const { data: userRole } = useQuery({
    queryKey: ['userRole'],
    queryFn: getUserRole,
  });

  const canEdit = typeof userRole === 'string' && ['superadmin', 'owner', 'manager'].includes(userRole);

  const { data: categoriesData, isLoading } = useQuery({
    queryKey: ['categories', tenant?.id],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');

      const res = await fetch('/api/categories?include_product_count=true', {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  const categories = useMemo(
    () => ((categoriesData?.categories || []) as ProductCategory[]).sort((a, b) => a.name.localeCompare(b.name)),
    [categoriesData]
  );

  const renameOrMergeMutation = useMutation({
    mutationFn: async ({
      currentName,
      payload,
    }: {
      currentName: string;
      payload: { name?: string; merge_into?: string | null };
    }) => {
      if (!tenant?.id) throw new Error('No tenant');

      const res = await fetch(`/api/categories/${encodeURIComponent(currentName)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenant.id,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update category');
      }

      return res.json();
    },
    onSuccess: (result) => {
      toast.success(result?.message || 'Category updated successfully');
      setActionState(null);
      queryClient.invalidateQueries({ queryKey: ['categories', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update category');
    },
  });

  const clearMutation = useMutation({
    mutationFn: async ({
      currentName,
      moveTo,
    }: {
      currentName: string;
      moveTo?: string;
    }) => {
      if (!tenant?.id) throw new Error('No tenant');

      const params = new URLSearchParams();
      if (moveTo) {
        params.set('move_products', 'true');
        params.set('new_category', moveTo);
      }

      const res = await fetch(`/api/categories/${encodeURIComponent(currentName)}?${params.toString()}`, {
        method: 'DELETE',
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to clear category');
      }

      return res.json();
    },
    onSuccess: (result) => {
      toast.success(result?.message || 'Category cleared successfully');
      setActionState(null);
      queryClient.invalidateQueries({ queryKey: ['categories', tenant?.id] });
      queryClient.invalidateQueries({ queryKey: ['products', tenant?.id] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to clear category');
    },
  });

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
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Product Categories</h1>
            <p className="text-gray-600 mt-1">
              Categories are product labels derived from `products.category`.
            </p>
          </div>
          <div className="text-sm text-gray-500 max-w-md text-right">
            New categories are created when you assign a category while creating or editing a product.
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          {categories.length === 0 ? (
            <div className="p-12 text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-2">No categories found</h3>
              <p className="text-gray-500">
                Add a category label to any product to create your first category.
              </p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Products</TH>
                  <TH>Last Updated</TH>
                  {canEdit && <TH>Actions</TH>}
                </TR>
              </THead>
              <TBody>
                {categories.map((category) => (
                  <TR key={category.id}>
                    <TD className="font-medium">{category.name}</TD>
                    <TD>
                      <span className="inline-flex px-2 py-1 text-sm bg-blue-100 text-blue-800 rounded-full">
                        {category.product_count ?? category._count?.products ?? 0} products
                      </span>
                    </TD>
                    <TD className="text-gray-500">
                      {category.updated_at ? new Date(category.updated_at).toLocaleDateString() : '—'}
                    </TD>
                    {canEdit && (
                      <TD>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setActionState({ category, mode: 'rename' })}>
                            Rename
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setActionState({ category, mode: 'merge' })}>
                            Merge
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-300 hover:bg-red-50"
                            onClick={() => setActionState({ category, mode: 'clear' })}
                          >
                            Clear
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

        {actionState && (
          <CategoryActionModal
            categories={categories}
            state={actionState}
            isLoading={renameOrMergeMutation.isPending || clearMutation.isPending}
            onClose={() => setActionState(null)}
            onRename={(nextName) =>
              renameOrMergeMutation.mutate({
                currentName: actionState.category.name,
                payload: { name: nextName },
              })
            }
            onMerge={(targetName) =>
              renameOrMergeMutation.mutate({
                currentName: actionState.category.name,
                payload: { merge_into: targetName },
              })
            }
            onClear={(moveTo) =>
              clearMutation.mutate({
                currentName: actionState.category.name,
                moveTo,
              })
            }
          />
        )}
      </div>
    </div>
  );
}

function CategoryActionModal({
  categories,
  state,
  isLoading,
  onClose,
  onRename,
  onMerge,
  onClear,
}: {
  categories: ProductCategory[];
  state: CategoryActionState;
  isLoading: boolean;
  onClose: () => void;
  onRename: (nextName: string) => void;
  onMerge: (targetName: string) => void;
  onClear: (moveTo?: string) => void;
}) {
  const [value, setValue] = useState('');
  const [moveTo, setMoveTo] = useState('');

  if (!state) return null;

  const otherCategories = categories.filter((category) => category.name !== state.category.name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (state.mode === 'rename') {
      const nextName = value.trim();
      if (!nextName) return;
      onRename(nextName);
      return;
    }

    if (state.mode === 'merge') {
      const nextName = value.trim();
      if (!nextName) return;
      onMerge(nextName);
      return;
    }

    const target = moveTo.trim();
    onClear(target || undefined);
  };

  const title = state.mode === 'rename'
    ? `Rename "${state.category.name}"`
    : state.mode === 'merge'
      ? `Merge "${state.category.name}"`
      : `Clear "${state.category.name}"`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-semibold">{title}</h2>
            <button type="button" onClick={onClose} disabled={isLoading} className="text-gray-400 hover:text-gray-600">
              ✕
            </button>
          </div>

          <div className="p-6 space-y-4">
            {state.mode === 'rename' && (
              <>
                <p className="text-sm text-gray-600">
                  Rename this label across all products currently using it.
                </p>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="New category name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isLoading}
                />
              </>
            )}

            {state.mode === 'merge' && (
              <>
                <p className="text-sm text-gray-600">
                  Move all products in this category into another label.
                </p>
                <input
                  type="text"
                  list="merge-category-targets"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Target category name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isLoading}
                />
                <datalist id="merge-category-targets">
                  {otherCategories.map((category) => (
                    <option key={category.id} value={category.name} />
                  ))}
                </datalist>
              </>
            )}

            {state.mode === 'clear' && (
              <>
                <p className="text-sm text-gray-600">
                  Clear this label from all products, or optionally move them into another label first.
                </p>
                <input
                  type="text"
                  list="clear-category-targets"
                  value={moveTo}
                  onChange={(e) => setMoveTo(e.target.value)}
                  placeholder="Optional target category"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={isLoading}
                />
                <datalist id="clear-category-targets">
                  {otherCategories.map((category) => (
                    <option key={category.id} value={category.name} />
                  ))}
                </datalist>
              </>
            )}
          </div>

          <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary text-white" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Confirm'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
