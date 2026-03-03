/**
 * Product Catalogue Types
 * Canonical type definitions for the product catalogue domain.
 */

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  price_cents: number;
  price?: number;
  category_id?: string;
  category?: { id: string; name: string; description?: string };
  images?: string[];
  is_active: boolean;
  is_featured?: boolean;
  track_inventory?: boolean;
  stock_quantity?: number;
  variants?: ProductVariant[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  sku?: string;
  price_cents?: number;
  price?: number;
  stock_quantity?: number;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateProductRequest {
  name: string;
  description?: string;
  short_description?: string;
  price_cents: number;
  cost_price_cents?: number;
  currency?: string;
  category_id?: string;
  images?: string[];
  is_active?: boolean;
  is_featured?: boolean;
  is_digital?: boolean;
  track_inventory?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  sku?: string;
  brand?: string;
  weight_grams?: number;
  dimensions?: Record<string, unknown>;
  upsell_priority?: number;
  frequently_bought_together?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateProductRequest {
  name?: string;
  description?: string;
  short_description?: string;
  price_cents?: number;
  cost_price_cents?: number;
  currency?: string;
  category_id?: string;
  images?: string[];
  is_active?: boolean;
  is_featured?: boolean;
  is_digital?: boolean;
  track_inventory?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  sku?: string;
  brand?: string;
  weight_grams?: number;
  dimensions?: Record<string, unknown>;
  upsell_priority?: number;
  frequently_bought_together?: string[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface CreateProductVariantRequest {
  product_id: string;
  name: string;
  description?: string;
  sku?: string;
  price_cents?: number;
  price_adjustment_cents?: number;
  stock_quantity?: number;
  weight_grams?: number;
  volume_ml?: number;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateProductVariantRequest {
  name?: string;
  sku?: string;
  price_cents?: number;
  stock_quantity?: number;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
}

export interface ProductPermissions {
  canCreate: boolean;
  canRead: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManageInventory: boolean;
  // snake_case aliases used by product route handlers
  can_view_cost_prices: boolean;
  can_set_pricing: boolean;
  can_manage_inventory: boolean;
}

export interface ProductListQuery {
  page?: number;
  limit?: number;
  search?: string;
  category_id?: string;
  is_active?: boolean;
  is_featured?: boolean;
  status?: string;
  include_variants?: boolean;
  include_stock_info?: boolean;
  price_min?: number;
  price_max?: number;
  tags?: string | string[];
  sort?: string;
  order?: 'asc' | 'desc';
}

export const PRODUCT_ROLE_PERMISSIONS: Record<string, ProductPermissions> = {
  superadmin: { canCreate: true, canRead: true, canUpdate: true, canDelete: true, canManageInventory: true, can_view_cost_prices: true, can_set_pricing: true, can_manage_inventory: true },
  owner: { canCreate: true, canRead: true, canUpdate: true, canDelete: true, canManageInventory: true, can_view_cost_prices: true, can_set_pricing: true, can_manage_inventory: true },
  manager: { canCreate: true, canRead: true, canUpdate: true, canDelete: false, canManageInventory: true, can_view_cost_prices: false, can_set_pricing: true, can_manage_inventory: true },
  staff: { canCreate: false, canRead: true, canUpdate: false, canDelete: false, canManageInventory: false, can_view_cost_prices: false, can_set_pricing: false, can_manage_inventory: false },
  customer: { canCreate: false, canRead: true, canUpdate: false, canDelete: false, canManageInventory: false, can_view_cost_prices: false, can_set_pricing: false, can_manage_inventory: false },
};

export const PRODUCT_VALIDATION_RULES = {
  name: { minLength: 1, maxLength: 255 },
  description: { maxLength: 5000 },
  price_cents: { min: 0 },
  stock_quantity: { min: 0 },
};

/** Alias used by the variants route */
export type CreateVariantRequest = CreateProductVariantRequest;
/** Alias used by the variants route */
export type UpdateVariantRequest = UpdateProductVariantRequest;
export interface ProductCategory { id: string; name: string; parent_id?: string | null; description?: string; is_active?: boolean; }
