/**
 * Product Catalogue Types
 * Canonical type definitions for the product catalogue domain.
 */

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  short_description?: string;
  price_cents: number;
  cost_price_cents?: number;
  price?: number;
  currency?: string;
  sku?: string;
  brand?: string;
  category?: string | null;
  images?: string[];
  is_active: boolean;
  is_featured?: boolean;
  is_digital?: boolean;
  track_inventory?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  upsell_priority?: number;
  variants?: ProductVariant[];
  tags?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

/** Product with all related data fully hydrated */
export type ProductWithDetails = Product & {
  variants?: ProductVariant[];
  inventory?: { stock_quantity: number; reserved: number; available: number };
};

export interface ProductVariant {
  id: string;
  product_id: string;
  name: string;
  variant_name?: string;
  variant_type?: string;
  description?: string;
  sku?: string;
  price_cents?: number;
  price?: number;
  price_adjustment_cents?: number;
  stock_quantity?: number;
  display_order?: number;
  weight_grams?: number;
  volume_ml?: number;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  category?: string | null;
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
  category?: string | null;
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
  variant_name?: string;
  variant_type?: string;
  description?: string;
  sku?: string;
  price_cents?: number;
  price_adjustment_cents?: number;
  stock_quantity?: number;
  display_order?: number;
  weight_grams?: number;
  volume_ml?: number;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateProductVariantRequest {
  name?: string;
  variant_name?: string;
  variant_type?: string;
  sku?: string;
  price_cents?: number;
  price_adjustment_cents?: number;
  stock_quantity?: number;
  display_order?: number;
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  can_edit_products?: boolean;
  can_delete_products?: boolean;
}

export interface ProductListQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  is_active?: boolean;
  is_featured?: boolean;
  is_digital?: boolean;
  status?: string;
  stock_status?: 'in_stock' | 'low_stock' | 'out_of_stock' | 'all';
  include_variants?: boolean;
  include_stock_info?: boolean;
  price_min?: number;
  price_max?: number;
  tags?: string | string[];
  sort?: string;
  order?: 'asc' | 'desc';
  track_inventory?: boolean;
  include_counts?: boolean;
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

export interface CreateCategoryRequest {
  name: string;
}

export interface UpdateCategoryRequest {
  name?: string;
  merge_into?: string | null;
}

export interface InventoryMovement {
  id: string;
  product_id: string;
  tenant_id: string;
  movement_type: 'in' | 'out' | 'adjustment' | 'transfer';
  quantity: number;
  quantity_change?: number;
  product?: { id: string; name: string };
  reason?: string;
  notes?: string;
  reference_id?: string;
  created_at?: string;
  created_by?: string;
}

export interface CreateInventoryMovementRequest {
  product_id: string;
  movement_type: 'in' | 'out' | 'adjustment' | 'transfer';
  quantity?: number;
  quantity_change?: number;
  reason?: string;
  notes?: string;
  reference_id?: string;
}

export interface ProductCategory {
  id: string;
  name: string;
  product_count?: number;
  created_at?: string | null;
  updated_at?: string | null;
  _count?: { products?: number };
}
