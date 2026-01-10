'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/lib/supabase/tenant-context';
import { Product, ProductVariant } from '@/types/product-catalogue';
import Button from '@/components/ui/button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';

interface ProductSelectorProps {
  onProductSelect: (product: Product, variant?: ProductVariant, quantity?: number) => void;
  selectedProducts?: Array<{
    product: Product;
    variant?: ProductVariant;
    quantity: number;
    price: number;
  }>;
  multiSelect?: boolean;
  showPricing?: boolean;
  categoryFilter?: string;
}

export default function ProductSelector({
  onProductSelect,
  selectedProducts = [],
  multiSelect = false,
  showPricing = true,
  categoryFilter
}: ProductSelectorProps) {
  const { tenant } = useTenant();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Fetch products
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', tenant?.id, searchQuery, categoryFilter],
    queryFn: async () => {
      if (!tenant?.id) throw new Error('No tenant');
      
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('include_variants', 'true');
      params.set('include_inventory', 'true');

      const res = await fetch(`/api/products?${params.toString()}`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
    enabled: !!tenant?.id,
  });

  const products = productsData?.products || [];

  // Fetch variants for selected product
  const { data: variantsData } = useQuery({
    queryKey: ['product-variants', selectedProductId, tenant?.id],
    queryFn: async () => {
      if (!tenant?.id || !selectedProductId) throw new Error('No tenant or product');
      
      const res = await fetch(`/api/products/${selectedProductId}/variants`, {
        headers: {
          'X-Tenant-ID': tenant.id,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch variants');
      return res.json();
    },
    enabled: !!tenant?.id && !!selectedProductId,
  });

  const variants = variantsData?.variants || [];

  const handleProductSelection = () => {
    const selectedProduct = products.find((p: Product) => p.id === selectedProductId);
    const selectedVariant = variants.find((v: ProductVariant) => v.id === selectedVariantId);

    if (!selectedProduct) return;

    onProductSelect(selectedProduct, selectedVariant, quantity);

    // Reset selection if not multi-select
    if (!multiSelect) {
      setSelectedProductId(null);
      setSelectedVariantId(null);
      setQuantity(1);
    }
  };

  const isProductSelected = (productId: string, variantId?: string) => {
    return selectedProducts.some(item => 
      item.product.id === productId && 
      (!variantId || item.variant?.id === variantId)
    );
  };

  const getProductPrice = (product: Product, variant?: ProductVariant) => {
    const basePrice = product.price_cents;
    const adjustment = variant?.price_adjustment_cents || 0;
    return (basePrice + adjustment) / 100;
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-10 bg-gray-200 rounded"></div>
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
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
          <h3 className="text-lg font-medium">Select Products</h3>
          {multiSelect && selectedProducts.length > 0 && (
            <span className="text-sm text-gray-500">
              {selectedProducts.length} selected
            </span>
          )}
        </div>

        {/* Search */}
        <div className="mt-4">
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Products Table */}
      {products.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-gray-500">
            {searchQuery ? 'No products found matching your search.' : 'No products available.'}
          </p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>Category</TH>
              <TH>Stock</TH>
              {showPricing && <TH>Price</TH>}
              <TH>Variants</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {products.map((product: Product) => (
              <TR 
                key={product.id}
                className={selectedProductId === product.id ? 'bg-blue-50' : ''}
              >
                <TD>
                  <div className="flex items-center gap-3">
                    {product.images?.[0] && (
                      <img
                        src={product.images[0]}
                        alt={product.name}
                        className="w-12 h-12 object-cover rounded"
                      />
                    )}
                    <div>
                      <div className="font-medium">{product.name}</div>
                      {product.description && (
                        <div className="text-sm text-gray-500 truncate max-w-xs">
                          {product.description}
                        </div>
                      )}
                    </div>
                  </div>
                </TD>
                <TD className="text-gray-600">
                  {product.category?.name || 'Uncategorized'}
                </TD>
                <TD>
                  {product.track_inventory ? (
                    <span className={`text-sm ${
                      product.available_stock <= 0 ? 'text-red-600' :
                      product.available_stock <= product.low_stock_threshold ? 'text-yellow-600' :
                      'text-green-600'
                    }`}>
                      {product.available_stock} units
                    </span>
                  ) : (
                    <span className="text-gray-500 text-sm">No tracking</span>
                  )}
                </TD>
                {showPricing && (
                  <TD className="font-medium">
                    ${getProductPrice(product).toFixed(2)}
                  </TD>
                )}
                <TD>
                  <span className="text-sm text-gray-500">
                    {product.variants?.length || 0} variants
                  </span>
                </TD>
                <TD>
                  <Button
                    size="sm"
                    variant={selectedProductId === product.id ? "solid" : "outline"}
                    onClick={() => {
                      if (selectedProductId === product.id) {
                        setSelectedProductId(null);
                        setSelectedVariantId(null);
                      } else {
                        setSelectedProductId(product.id);
                        setSelectedVariantId(null);
                      }
                    }}
                  >
                    {selectedProductId === product.id ? 'Selected' : 'Select'}
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Variant Selection */}
      {selectedProductId && variants.length > 0 && (
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <h4 className="text-md font-medium mb-3">Select Variant</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {variants.map((variant: ProductVariant) => (
              <button
                key={variant.id}
                onClick={() => setSelectedVariantId(
                  selectedVariantId === variant.id ? null : variant.id
                )}
                className={`p-3 border rounded-lg text-left transition-colors ${
                  selectedVariantId === variant.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-gray-300 hover:border-gray-400'
                } ${
                  isProductSelected(selectedProductId, variant.id)
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
                disabled={isProductSelected(selectedProductId, variant.id)}
              >
                <div className="font-medium">{variant.name}</div>
                {variant.description && (
                  <div className="text-sm text-gray-500 mt-1">
                    {variant.description}
                  </div>
                )}
                {showPricing && variant.price_adjustment_cents !== 0 && (
                  <div className="text-sm mt-1">
                    <span className={variant.price_adjustment_cents > 0 ? 'text-green-600' : 'text-red-600'}>
                      {variant.price_adjustment_cents > 0 ? '+' : ''}
                      ${(variant.price_adjustment_cents / 100).toFixed(2)}
                    </span>
                  </div>
                )}
                {variant.product_inventory?.[0] && (
                  <div className="text-xs text-gray-500 mt-1">
                    Stock: {variant.product_inventory[0].available_stock}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantity and Add */}
      {selectedProductId && (
        <div className="p-6 border-t border-gray-200">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
              </label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="w-20 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex-1">
              {showPricing && (
                <div className="text-sm text-gray-600 mb-2">
                  Unit Price: ${getProductPrice(
                    products.find((p: Product) => p.id === selectedProductId)!,
                    variants.find((v: ProductVariant) => v.id === selectedVariantId)
                  ).toFixed(2)}
                </div>
              )}
            </div>

            <Button
              onClick={handleProductSelection}
              disabled={!selectedProductId || (variants.length > 0 && !selectedVariantId)}
            >
              {multiSelect ? 'Add to Selection' : 'Select Product'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}