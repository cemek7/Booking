'use client';

import React, { memo, useCallback } from 'react';
import { Product, ProductPermissions } from '@/types/product-catalogue';

interface ProductCardProps {
  product: Product;
  permissions: ProductPermissions;
  onEdit: (productId: string) => void;
  onDelete: (productId: string, productName: string) => void;
  formatPrice: (priceInCents: number, currency?: string) => string;
  getStockStatus: (product: Product) => { text: string; color: string };
}

const ProductCard = memo<ProductCardProps>(function ProductCard({
  product,
  permissions,
  onEdit,
  onDelete,
  formatPrice,
  getStockStatus,
}) {
  const stockStatus = getStockStatus(product);

  const handleEdit = useCallback(() => {
    onEdit(product.id);
  }, [onEdit, product.id]);

  const handleDelete = useCallback(() => {
    onDelete(product.id, product.name);
  }, [onDelete, product.id, product.name]);

  return (
    <div className="bg-white rounded-lg shadow hover:shadow-md transition-shadow border border-gray-200 overflow-hidden">
      {/* Product Image */}
      <div className="aspect-square relative">
        {product.images?.length > 0 ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <span className="text-4xl">📦</span>
          </div>
        )}

        {/* Status badges */}
        <div className="absolute top-2 left-2 space-y-1">
          {product.is_featured && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              ⭐ Featured
            </span>
          )}
          {!product.is_active && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
              ⚪ Inactive
            </span>
          )}
          {product.track_inventory && product.stock_quantity === 0 && (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
              Out of Stock
            </span>
          )}
          {product.track_inventory &&
            product.stock_quantity <= product.low_stock_threshold &&
            product.stock_quantity > 0 && (
              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                Low Stock
              </span>
            )}
        </div>

        {/* Quick actions */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="flex flex-col gap-1">
            {permissions.can_edit_products && (
              <button
                onClick={handleEdit}
                className="p-2 bg-white rounded-full shadow hover:shadow-md transition-shadow"
                title="Edit Product"
              >
                ✏️
              </button>
            )}
            {permissions.can_delete_products && (
              <button
                onClick={handleDelete}
                className="p-2 bg-white rounded-full shadow hover:shadow-md transition-shadow"
                title="Delete Product"
              >
                🗑️
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Product Details */}
      <div className="p-4">
        {/* Product Name & Category */}
        <div className="mb-2">
          <h3 className="font-medium text-gray-900 truncate">{product.name}</h3>
          <p className="text-sm text-gray-500">{product.category?.name || 'Uncategorized'}</p>
        </div>

        {/* SKU */}
        {product.sku && <p className="text-xs text-gray-500 mb-2">SKU: {product.sku}</p>}

        {/* Price */}
        <div className="mb-3">
          <div className="font-semibold text-lg">
            {formatPrice(product.price_cents, product.currency)}
          </div>
          {permissions.can_view_cost_prices && product.cost_price_cents > 0 && (
            <div className="text-sm text-gray-500">
              Cost: {formatPrice(product.cost_price_cents, product.currency)}
            </div>
          )}
        </div>

        {/* Stock Information */}
        {product.track_inventory ? (
          <div className="mb-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Stock:</span>
              <span className={`text-sm font-medium ${stockStatus.color}`}>
                {product.stock_quantity} units
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
              <div
                className={`h-1.5 rounded-full ${
                  product.stock_quantity === 0
                    ? 'bg-red-400'
                    : product.stock_quantity <= product.low_stock_threshold
                      ? 'bg-yellow-400'
                      : 'bg-green-400'
                }`}
                style={{
                  width: `${Math.min(
                    (product.stock_quantity / Math.max(product.low_stock_threshold * 2, 1)) * 100,
                    100
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <span className="text-sm text-gray-500">Stock: Not tracked</span>
          </div>
        )}

        {/* Variants Count */}
        {product.variants && product.variants.length > 0 && (
          <div className="mb-3">
            <span className="text-sm text-gray-600">
              {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Tags */}
        {product.tags && product.tags.length > 0 && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-1">
              {product.tags.slice(0, 3).map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"
                >
                  {tag}
                </span>
              ))}
              {product.tags.length > 3 && (
                <span className="text-xs text-gray-500">+{product.tags.length - 3} more</span>
              )}
            </div>
          </div>
        )}

        {/* Description */}
        {product.short_description && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">{product.short_description}</p>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2 border-t">
          {permissions.can_edit_products && (
            <button
              onClick={handleEdit}
              className="flex-1 px-3 py-2 text-sm bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
            >
              ✏️ Edit
            </button>
          )}
          {permissions.can_delete_products && (
            <button
              onClick={handleDelete}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

interface ProductGridProps {
  products: Product[];
  permissions: ProductPermissions;
  onEdit: (productId: string) => void;
  onDelete: (productId: string, productName: string) => void;
  formatPrice: (priceInCents: number, currency?: string) => string;
  getStockStatus: (product: Product) => { text: string; color: string };
}

export default function ProductGrid({
  products,
  permissions,
  onEdit,
  onDelete,
  formatPrice,
  getStockStatus,
}: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">📦</div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No products found</h3>
        <p className="text-gray-500 mb-4">
          Try adjusting your filters or create your first product.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          permissions={permissions}
          onEdit={onEdit}
          onDelete={onDelete}
          formatPrice={formatPrice}
          getStockStatus={getStockStatus}
        />
      ))}
    </div>
  );
}
