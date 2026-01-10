'use client';

import { useState, useEffect } from 'react';
import { Product, ProductVariant } from '@/types/product-catalogue';
import Button from '@/components/ui/button';

interface SelectedProduct {
  product: Product;
  variant?: ProductVariant;
  quantity: number;
  price: number;
}

interface BookingProductListProps {
  selectedProducts: SelectedProduct[];
  onUpdateQuantity: (index: number, quantity: number) => void;
  onRemoveProduct: (index: number) => void;
  onUpdateTotal: (total: number) => void;
  showPricing?: boolean;
  editable?: boolean;
}

export default function BookingProductList({
  selectedProducts,
  onUpdateQuantity,
  onRemoveProduct,
  onUpdateTotal,
  showPricing = true,
  editable = true
}: BookingProductListProps) {
  const [total, setTotal] = useState(0);

  // Calculate total whenever selectedProducts changes
  useEffect(() => {
    const newTotal = selectedProducts.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);
    setTotal(newTotal);
    onUpdateTotal(newTotal);
  }, [selectedProducts, onUpdateTotal]);

  const getProductDisplayName = (item: SelectedProduct) => {
    if (item.variant) {
      return `${item.product.name} - ${item.variant.name}`;
    }
    return item.product.name;
  };

  const getProductSku = (item: SelectedProduct) => {
    if (item.variant?.sku) {
      return item.variant.sku;
    }
    return item.product.sku;
  };

  const handleQuantityChange = (index: number, newQuantity: number) => {
    if (newQuantity < 1) return;
    onUpdateQuantity(index, newQuantity);
  };

  if (selectedProducts.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="text-center py-8">
          <div className="text-gray-400 text-5xl mb-4">📦</div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No products selected
          </h3>
          <p className="text-gray-500">
            Add products to this booking to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-medium">Selected Products</h3>
          <span className="text-sm text-gray-500">
            {selectedProducts.length} {selectedProducts.length === 1 ? 'item' : 'items'}
          </span>
        </div>
      </div>

      {/* Product List */}
      <div className="divide-y divide-gray-200">
        {selectedProducts.map((item, index) => (
          <div key={`${item.product.id}-${item.variant?.id || 'base'}-${index}`} className="p-6">
            <div className="flex items-center gap-4">
              {/* Product Image */}
              {item.product.images?.[0] && (
                <img
                  src={item.product.images[0]}
                  alt={getProductDisplayName(item)}
                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                />
              )}

              {/* Product Info */}
              <div className="flex-1">
                <h4 className="font-medium text-gray-900">
                  {getProductDisplayName(item)}
                </h4>
                
                {item.product.description && (
                  <p className="text-sm text-gray-500 mt-1">
                    {item.product.description}
                  </p>
                )}

                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                  {getProductSku(item) && (
                    <span>SKU: {getProductSku(item)}</span>
                  )}
                  
                  {item.product.category && (
                    <span>Category: {item.product.category.name}</span>
                  )}

                  {item.variant && (
                    <div className="flex items-center gap-2">
                      {item.variant.weight_grams && (
                        <span>{item.variant.weight_grams}g</span>
                      )}
                      {item.variant.volume_ml && (
                        <span>{item.variant.volume_ml}ml</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Quantity Controls */}
              {editable ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleQuantityChange(index, item.quantity - 1)}
                    disabled={item.quantity <= 1}
                    className="w-8 h-8 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => handleQuantityChange(index, parseInt(e.target.value) || 1)}
                    className="w-16 px-2 py-1 text-center border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  
                  <button
                    onClick={() => handleQuantityChange(index, item.quantity + 1)}
                    className="w-8 h-8 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
              ) : (
                <div className="text-gray-600 min-w-16 text-center">
                  Qty: {item.quantity}
                </div>
              )}

              {/* Price */}
              {showPricing && (
                <div className="text-right min-w-24">
                  <div className="text-lg font-medium">
                    ${(item.price * item.quantity).toFixed(2)}
                  </div>
                  <div className="text-sm text-gray-500">
                    ${item.price.toFixed(2)} each
                  </div>
                </div>
              )}

              {/* Remove Button */}
              {editable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRemoveProduct(index)}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      {showPricing && selectedProducts.length > 0 && (
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center">
            <span className="text-lg font-medium">Total Products:</span>
            <span className="text-xl font-bold">${total.toFixed(2)}</span>
          </div>
          
          <div className="mt-2 text-sm text-gray-500">
            {selectedProducts.reduce((sum, item) => sum + item.quantity, 0)} total items
          </div>
        </div>
      )}
    </div>
  );
}