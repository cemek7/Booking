/**
 * Product Catalogue Type Definitions
 * Comprehensive type safety for the product management system
 */

// ============================================================================
// CORE PRODUCT TYPES
// ============================================================================

export interface ProductCategory {
  id: string;
  tenant_id: string;
  name: string;
  description?: string;
  parent_id?: string;
  display_order: number;
  is_active: boolean;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  
  // Computed fields (not in DB)
  children?: ProductCategory[];
  parent?: ProductCategory;
  product_count?: number;
}

export interface Product {
  id: string;
  tenant_id: string;
  category_id?: string;
  name: string;
  description?: string;
  short_description?: string;
  sku?: string;
  
  // Pricing (in cents)
  price_cents: number;
  currency: string;
  cost_price_cents: number;
  
  // Inventory
  track_inventory: boolean;
  stock_quantity: number;
  low_stock_threshold: number;
  
  // Product details
  brand?: string;
  weight_grams?: number;
  dimensions: ProductDimensions;
  
  // Status flags
  is_active: boolean;
  is_featured: boolean;
  is_digital: boolean;
  
  // AI and upselling
  upsell_priority: number;
  frequently_bought_together: string[];
  tags: string[];
  
  // Media
  images: string[];
  
  // Metadata
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  
  // Relations (not in DB)
  category?: ProductCategory;
  variants?: ProductVariant[];
  stock_info?: ProductStockInfo;
}

export interface ProductVariant {
  id: string;
  product_id: string;
  tenant_id: string;
  variant_name: string;
  variant_type: string;
  price_adjustment_cents: number;
  stock_quantity: number;
  sku?: string;
  is_active: boolean;
  display_order: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  
  // Computed fields
  final_price_cents?: number;
  is_low_stock?: boolean;
}

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  product_id?: string;
  variant_id?: string;
  movement_type: InventoryMovementType;
  quantity_change: number;
  previous_quantity: number;
  new_quantity: number;
  reference_type?: string;
  reference_id?: string;
  reason?: string;
  performed_by?: string;
  notes?: string;
  created_at: string;
  
  // Relations
  product?: Product;
  variant?: ProductVariant;
  performed_by_user?: any; // User type from auth
}

export interface ServiceProduct {
  id: string;
  tenant_id: string;
  service_id: string;
  product_id: string;
  recommendation_type: RecommendationType;
  display_order: number;
  recommendation_weight: number;
  created_at: string;
  updated_at: string;
  
  // Relations
  service?: any; // Service type
  product?: Product;
}

// ============================================================================
// SUPPORTING TYPES
// ============================================================================

export interface ProductDimensions {
  length?: number;
  width?: number;
  height?: number;
  unit?: 'cm' | 'in' | 'mm';
}

export interface ProductStockInfo {
  product_id: string;
  variant_id?: string;
  variant_name?: string;
  current_stock: number;
  low_stock_threshold: number;
  is_low_stock: boolean;
}

// ============================================================================
// ENUMS AND CONSTANTS
// ============================================================================

export type InventoryMovementType = 
  | 'sale'
  | 'purchase'
  | 'adjustment'
  | 'return'
  | 'damage'
  | 'transfer';

export type RecommendationType = 
  | 'required'
  | 'recommended'
  | 'upsell'
  | 'complementary'
  | 'aftercare';

export type ProductSortField = 
  | 'name'
  | 'price_cents'
  | 'created_at'
  | 'updated_at'
  | 'stock_quantity'
  | 'upsell_priority';

export type ProductFilterStatus = 
  | 'all'
  | 'active'
  | 'inactive'
  | 'featured'
  | 'low_stock'
  | 'out_of_stock';

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface CreateProductCategoryRequest {
  name: string;
  description?: string;
  parent_id?: string;
  display_order?: number;
  is_active?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateProductCategoryRequest extends Partial<CreateProductCategoryRequest> {
  id: string;
}

export interface CreateProductRequest {
  category_id?: string;
  name: string;
  description?: string;
  short_description?: string;
  sku?: string;
  price_cents: number;
  currency?: string;
  cost_price_cents?: number;
  track_inventory?: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  brand?: string;
  weight_grams?: number;
  dimensions?: ProductDimensions;
  is_active?: boolean;
  is_featured?: boolean;
  is_digital?: boolean;
  upsell_priority?: number;
  frequently_bought_together?: string[];
  tags?: string[];
  images?: string[];
  metadata?: Record<string, any>;
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {
  id: string;
}

export interface CreateProductVariantRequest {
  product_id: string;
  variant_name: string;
  variant_type: string;
  price_adjustment_cents?: number;
  stock_quantity?: number;
  sku?: string;
  is_active?: boolean;
  display_order?: number;
  metadata?: Record<string, any>;
}

export interface UpdateProductVariantRequest extends Partial<CreateProductVariantRequest> {
  id: string;
}

export interface UpdateInventoryRequest {
  product_id?: string;
  variant_id?: string;
  quantity_change: number;
  movement_type: InventoryMovementType;
  reference_type?: string;
  reference_id?: string;
  reason?: string;
  notes?: string;
}

export interface CreateServiceProductRequest {
  service_id: string;
  product_id: string;
  recommendation_type?: RecommendationType;
  display_order?: number;
  recommendation_weight?: number;
}

// ============================================================================
// QUERY TYPES
// ============================================================================

export interface ProductListQuery {
  category_id?: string;
  status?: ProductFilterStatus;
  search?: string;
  tags?: string[];
  price_min?: number;
  price_max?: number;
  sort?: ProductSortField;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  include_variants?: boolean;
  include_stock_info?: boolean;
}

export interface ProductCategoryListQuery {
  parent_id?: string;
  is_active?: boolean;
  include_children?: boolean;
  include_product_count?: boolean;
  sort?: 'name' | 'display_order' | 'created_at';
  order?: 'asc' | 'desc';
}

export interface InventoryMovementListQuery {
  product_id?: string;
  variant_id?: string;
  movement_type?: InventoryMovementType;
  reference_type?: string;
  date_from?: string;
  date_to?: string;
  sort?: 'created_at' | 'quantity_change';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

// ============================================================================
// AI UPSELLING TYPES
// ============================================================================

export interface AIRecommendationContext {
  service_id?: string;
  current_cart?: CartItem[];
  customer_history?: PurchaseHistory[];
  preferences?: CustomerPreferences;
  budget_range?: {
    min: number;
    max: number;
  };
}

export interface CartItem {
  product_id: string;
  variant_id?: string;
  quantity: number;
  price_cents: number;
}

export interface PurchaseHistory {
  product_id: string;
  variant_id?: string;
  quantity: number;
  purchase_date: string;
  satisfaction_rating?: number;
}

export interface CustomerPreferences {
  preferred_brands?: string[];
  price_sensitivity?: 'low' | 'medium' | 'high';
  product_categories?: string[];
  purchase_frequency?: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
}

export interface ProductRecommendation {
  product: Product;
  variant?: ProductVariant;
  confidence_score: number;
  recommendation_reason: string;
  expected_value: number; // Estimated additional revenue
  cross_sell_products?: Product[];
}

export interface UpsellStrategy {
  primary_recommendations: ProductRecommendation[];
  complementary_products: ProductRecommendation[];
  bundle_suggestions: ProductBundle[];
  total_potential_value: number;
}

export interface ProductBundle {
  id: string;
  name: string;
  products: Array<{
    product: Product;
    variant?: ProductVariant;
    quantity: number;
  }>;
  bundle_price_cents: number;
  savings_cents: number;
  savings_percentage: number;
}

// ============================================================================
// DASHBOARD ANALYTICS TYPES
// ============================================================================

export interface ProductAnalytics {
  total_products: number;
  active_products: number;
  featured_products: number;
  low_stock_alerts: number;
  out_of_stock_count: number;
  total_inventory_value: number;
  top_selling_products: ProductSalesData[];
  category_performance: CategoryPerformance[];
  inventory_turnover: number;
  profit_margins: ProfitMarginData;
}

export interface ProductSalesData {
  product: Product;
  variant?: ProductVariant;
  units_sold: number;
  revenue_cents: number;
  profit_cents: number;
  growth_rate: number;
}

export interface CategoryPerformance {
  category: ProductCategory;
  total_products: number;
  total_sales: number;
  revenue_cents: number;
  average_rating: number;
  growth_rate: number;
}

export interface ProfitMarginData {
  overall_margin_percentage: number;
  category_margins: Array<{
    category_id: string;
    category_name: string;
    margin_percentage: number;
  }>;
  product_margins: Array<{
    product_id: string;
    product_name: string;
    margin_percentage: number;
  }>;
}

// ============================================================================
// PERMISSION TYPES (Role-Based Access)
// ============================================================================

export interface ProductPermissions {
  can_view_products: boolean;
  can_create_products: boolean;
  can_edit_products: boolean;
  can_delete_products: boolean;
  can_manage_inventory: boolean;
  can_view_analytics: boolean;
  can_manage_categories: boolean;
  can_set_pricing: boolean;
  can_view_cost_prices: boolean;
  can_export_data: boolean;
}

// Role-based permission matrix
export const PRODUCT_ROLE_PERMISSIONS: Record<string, ProductPermissions> = {
  superadmin: {
    can_view_products: true,
    can_create_products: true,
    can_edit_products: true,
    can_delete_products: true,
    can_manage_inventory: true,
    can_view_analytics: true,
    can_manage_categories: true,
    can_set_pricing: true,
    can_view_cost_prices: true,
    can_export_data: true,
  },
  owner: {
    can_view_products: true,
    can_create_products: true,
    can_edit_products: true,
    can_delete_products: true,
    can_manage_inventory: true,
    can_view_analytics: true,
    can_manage_categories: true,
    can_set_pricing: true,
    can_view_cost_prices: true,
    can_export_data: true,
  },
  manager: {
    can_view_products: true,
    can_create_products: true,
    can_edit_products: true,
    can_delete_products: false,
    can_manage_inventory: true,
    can_view_analytics: true,
    can_manage_categories: true,
    can_set_pricing: true,
    can_view_cost_prices: false,
    can_export_data: true,
  },
  staff: {
    can_view_products: true,
    can_create_products: false,
    can_edit_products: false,
    can_delete_products: false,
    can_manage_inventory: true,
    can_view_analytics: false,
    can_manage_categories: false,
    can_set_pricing: false,
    can_view_cost_prices: false,
    can_export_data: false,
  },
};

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface ProductError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, any>;
}

export const PRODUCT_ERROR_CODES = {
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  VARIANT_NOT_FOUND: 'VARIANT_NOT_FOUND',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_SKU: 'INVALID_SKU',
  DUPLICATE_SKU: 'DUPLICATE_SKU',
  INVALID_PRICE: 'INVALID_PRICE',
  INVALID_INVENTORY: 'INVALID_INVENTORY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

// ============================================================================
// UTILITY TYPES
// ============================================================================

export type ProductWithRelations = Product & {
  category?: ProductCategory;
  variants?: ProductVariant[];
  stock_info?: ProductStockInfo;
  sales_data?: ProductSalesData;
};

export type CategoryWithProducts = ProductCategory & {
  products?: Product[];
  children?: CategoryWithProducts[];
  parent?: ProductCategory;
};

// Type guards for runtime type checking
export const isProduct = (obj: any): obj is Product => {
  return obj && typeof obj.id === 'string' && typeof obj.name === 'string';
};

export const isProductCategory = (obj: any): obj is ProductCategory => {
  return obj && typeof obj.id === 'string' && typeof obj.name === 'string';
};

export const isProductVariant = (obj: any): obj is ProductVariant => {
  return obj && typeof obj.id === 'string' && typeof obj.variant_name === 'string';
};

// ============================================================================
// FORM VALIDATION SCHEMAS (for use with form libraries)
// ============================================================================

export const PRODUCT_VALIDATION_RULES = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 255,
  },
  description: {
    maxLength: 5000,
  },
  short_description: {
    maxLength: 500,
  },
  sku: {
    maxLength: 100,
    pattern: /^[A-Za-z0-9-_]+$/, // Alphanumeric, hyphens, underscores only
  },
  price_cents: {
    required: true,
    min: 0,
    type: 'integer',
  },
  stock_quantity: {
    min: 0,
    type: 'integer',
  },
  low_stock_threshold: {
    min: 0,
    type: 'integer',
  },
  weight_grams: {
    min: 0,
    type: 'integer',
  },
  upsell_priority: {
    min: 0,
    type: 'integer',
  },
} as const;

export const CATEGORY_VALIDATION_RULES = {
  name: {
    required: true,
    minLength: 1,
    maxLength: 255,
  },
  description: {
    maxLength: 1000,
  },
  display_order: {
    min: 0,
    type: 'integer',
  },
} as const;