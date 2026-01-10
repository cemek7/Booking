-- Migration 035: Product Catalogue Schema
-- Date: 2025-12-01
-- Priority: Core Product Management Implementation

-- ========================================
-- 1. PRODUCT CATEGORIES TABLE
-- ========================================

-- Product categories with hierarchical structure
CREATE TABLE public.product_categories (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id UUID,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT product_categories_pkey PRIMARY KEY (id),
    CONSTRAINT product_categories_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT product_categories_parent_fkey FOREIGN KEY (parent_id) REFERENCES public.product_categories(id) ON DELETE CASCADE,
    CONSTRAINT product_categories_unique_name UNIQUE (tenant_id, name),
    CONSTRAINT product_categories_no_self_parent CHECK (id != parent_id)
);

-- ========================================
-- 2. PRODUCTS TABLE
-- ========================================

-- Core products table with pricing, inventory, and AI features
CREATE TABLE public.products (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    category_id UUID,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    short_description VARCHAR(500),
    sku VARCHAR(100),
    
    -- Pricing (stored in cents for precision)
    price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
    currency VARCHAR(3) DEFAULT 'USD',
    cost_price_cents INTEGER DEFAULT 0 CHECK (cost_price_cents >= 0),
    
    -- Inventory management
    track_inventory BOOLEAN DEFAULT FALSE,
    stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
    low_stock_threshold INTEGER DEFAULT 5 CHECK (low_stock_threshold >= 0),
    
    -- Product details
    brand VARCHAR(255),
    weight_grams INTEGER CHECK (weight_grams > 0),
    dimensions JSONB DEFAULT '{}', -- {length, width, height, unit}
    
    -- Status flags
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_digital BOOLEAN DEFAULT FALSE, -- For digital products/services
    
    -- AI and upselling features
    upsell_priority INTEGER DEFAULT 0 CHECK (upsell_priority >= 0), -- Higher = more likely to recommend
    frequently_bought_together UUID[], -- Array of product IDs
    tags TEXT[] DEFAULT '{}', -- For AI matching and search
    
    -- Media and assets
    images JSONB DEFAULT '[]', -- Array of image URLs/paths
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT products_pkey PRIMARY KEY (id),
    CONSTRAINT products_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT products_category_fkey FOREIGN KEY (category_id) REFERENCES public.product_categories(id) ON DELETE SET NULL,
    CONSTRAINT products_unique_sku UNIQUE (tenant_id, sku) -- SKU unique per tenant
);

-- ========================================
-- 3. PRODUCT VARIANTS TABLE
-- ========================================

-- Product variants for sizes, colors, volumes, etc.
CREATE TABLE public.product_variants (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    
    variant_name VARCHAR(255) NOT NULL, -- "Small", "Red", "500ml"
    variant_type VARCHAR(100) NOT NULL, -- "size", "color", "volume"
    
    -- Pricing adjustments from base product price
    price_adjustment_cents INTEGER DEFAULT 0, -- Can be negative for discounts
    
    -- Variant-specific inventory
    stock_quantity INTEGER DEFAULT 0 CHECK (stock_quantity >= 0),
    sku VARCHAR(100), -- Variant-specific SKU
    
    -- Status and ordering
    is_active BOOLEAN DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT product_variants_pkey PRIMARY KEY (id),
    CONSTRAINT product_variants_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    CONSTRAINT product_variants_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT product_variants_unique_name UNIQUE (product_id, variant_name, variant_type),
    CONSTRAINT product_variants_unique_sku UNIQUE (tenant_id, sku) -- SKU unique per tenant
);

-- ========================================
-- 4. INVENTORY MOVEMENTS TABLE
-- ========================================

-- Track all inventory changes for audit and analytics
CREATE TABLE public.inventory_movements (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    product_id UUID,
    variant_id UUID,
    
    -- Movement details
    movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN ('sale', 'purchase', 'adjustment', 'return', 'damage', 'transfer')),
    quantity_change INTEGER NOT NULL, -- Positive for increase, negative for decrease
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    
    -- Reference information
    reference_type VARCHAR(50), -- 'booking', 'manual', 'purchase_order', 'damage_report'
    reference_id UUID, -- booking_id, purchase_order_id, etc.
    
    -- Audit trail
    reason TEXT,
    performed_by UUID,
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT inventory_movements_pkey PRIMARY KEY (id),
    CONSTRAINT inventory_movements_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT inventory_movements_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    CONSTRAINT inventory_movements_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE,
    CONSTRAINT inventory_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT inventory_movements_quantity_check CHECK (
        (quantity_change > 0 AND new_quantity = previous_quantity + quantity_change) OR
        (quantity_change < 0 AND new_quantity = previous_quantity + quantity_change) OR
        (quantity_change = 0 AND new_quantity = previous_quantity)
    )
);

-- ========================================
-- 5. SERVICE-PRODUCT ASSOCIATIONS TABLE
-- ========================================

-- Link products to services for upselling and recommendations
CREATE TABLE public.service_products (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    service_id UUID NOT NULL,
    product_id UUID NOT NULL,
    
    -- Recommendation strategy
    recommendation_type VARCHAR(50) DEFAULT 'upsell' CHECK (
        recommendation_type IN ('required', 'recommended', 'upsell', 'complementary', 'aftercare')
    ),
    display_order INTEGER DEFAULT 0,
    
    -- AI recommendation weight
    recommendation_weight NUMERIC(3,2) DEFAULT 1.0 CHECK (recommendation_weight >= 0 AND recommendation_weight <= 1.0),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT service_products_pkey PRIMARY KEY (id),
    CONSTRAINT service_products_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT service_products_service_fkey FOREIGN KEY (service_id) REFERENCES public.services(id) ON DELETE CASCADE,
    CONSTRAINT service_products_product_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
    CONSTRAINT service_products_unique UNIQUE (tenant_id, service_id, product_id)
);

-- ========================================
-- 6. PERFORMANCE INDEXES
-- ========================================

-- Product category indexes
CREATE INDEX idx_product_categories_tenant ON public.product_categories (tenant_id);
CREATE INDEX idx_product_categories_parent ON public.product_categories (parent_id);
CREATE INDEX idx_product_categories_active ON public.product_categories (tenant_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_product_categories_display_order ON public.product_categories (tenant_id, display_order);

-- Product indexes
CREATE INDEX idx_products_tenant ON public.products (tenant_id);
CREATE INDEX idx_products_category ON public.products (category_id);
CREATE INDEX idx_products_active ON public.products (tenant_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_products_featured ON public.products (tenant_id, is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_products_inventory ON public.products (tenant_id, track_inventory, stock_quantity);
CREATE INDEX idx_products_upsell_priority ON public.products (tenant_id, upsell_priority DESC);
CREATE INDEX idx_products_tags ON public.products USING GIN (tags);
CREATE INDEX idx_products_price ON public.products (tenant_id, price_cents);

-- Full-text search index for products
CREATE INDEX idx_products_search ON public.products USING GIN (
    to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(brand, ''))
);

-- Product variant indexes
CREATE INDEX idx_product_variants_product ON public.product_variants (product_id);
CREATE INDEX idx_product_variants_tenant ON public.product_variants (tenant_id);
CREATE INDEX idx_product_variants_type ON public.product_variants (product_id, variant_type);
CREATE INDEX idx_product_variants_active ON public.product_variants (product_id, is_active) WHERE is_active = TRUE;

-- Inventory movement indexes
CREATE INDEX idx_inventory_movements_product ON public.inventory_movements (product_id);
CREATE INDEX idx_inventory_movements_variant ON public.inventory_movements (variant_id);
CREATE INDEX idx_inventory_movements_tenant ON public.inventory_movements (tenant_id);
CREATE INDEX idx_inventory_movements_type ON public.inventory_movements (tenant_id, movement_type);
CREATE INDEX idx_inventory_movements_date ON public.inventory_movements (tenant_id, created_at DESC);
CREATE INDEX idx_inventory_movements_reference ON public.inventory_movements (reference_type, reference_id);

-- Service-product association indexes
CREATE INDEX idx_service_products_service ON public.service_products (service_id);
CREATE INDEX idx_service_products_product ON public.service_products (product_id);
CREATE INDEX idx_service_products_tenant ON public.service_products (tenant_id);
CREATE INDEX idx_service_products_recommendation ON public.service_products (tenant_id, recommendation_type);

-- ========================================
-- 7. ROW LEVEL SECURITY (RLS) POLICIES
-- ========================================

-- Enable RLS on all tables
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_products ENABLE ROW LEVEL SECURITY;

-- Product Categories RLS Policies
CREATE POLICY product_categories_tenant_isolation ON public.product_categories
    FOR ALL TO authenticated
    USING (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    )
    WITH CHECK (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    );

-- Products RLS Policies
CREATE POLICY products_tenant_isolation ON public.products
    FOR ALL TO authenticated
    USING (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    )
    WITH CHECK (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    );

-- Product Variants RLS Policies
CREATE POLICY product_variants_tenant_isolation ON public.product_variants
    FOR ALL TO authenticated
    USING (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    )
    WITH CHECK (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    );

-- Inventory Movements RLS Policies
CREATE POLICY inventory_movements_tenant_isolation ON public.inventory_movements
    FOR ALL TO authenticated
    USING (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    )
    WITH CHECK (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    );

-- Service Products RLS Policies
CREATE POLICY service_products_tenant_isolation ON public.service_products
    FOR ALL TO authenticated
    USING (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    )
    WITH CHECK (
        tenant_id::text IN (
            SELECT t.tenant_id::text 
            FROM public.tenant_users t 
            WHERE t.user_id = auth.uid()
        ) OR
        auth.uid()::text IN (SELECT user_id::text FROM public.admins WHERE is_active = true)
    );

-- Service role access for system operations
CREATE POLICY product_categories_service ON public.product_categories
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY products_service ON public.products
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY product_variants_service ON public.product_variants
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY inventory_movements_service ON public.inventory_movements
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY service_products_service ON public.service_products
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ========================================
-- 8. UTILITY FUNCTIONS
-- ========================================

-- Function to get current stock for a product (including variants)
CREATE OR REPLACE FUNCTION public.get_product_stock(product_uuid UUID)
RETURNS TABLE(
    product_id UUID,
    variant_id UUID,
    variant_name TEXT,
    current_stock INTEGER,
    low_stock_threshold INTEGER,
    is_low_stock BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH product_stock AS (
        SELECT 
            p.id as product_id,
            NULL::UUID as variant_id,
            'Base Product'::TEXT as variant_name,
            p.stock_quantity as current_stock,
            p.low_stock_threshold,
            (p.stock_quantity <= p.low_stock_threshold) as is_low_stock
        FROM products p 
        WHERE p.id = product_uuid AND p.track_inventory = true
        
        UNION ALL
        
        SELECT 
            pv.product_id,
            pv.id as variant_id,
            pv.variant_name,
            pv.stock_quantity as current_stock,
            p.low_stock_threshold,
            (pv.stock_quantity <= p.low_stock_threshold) as is_low_stock
        FROM product_variants pv
        JOIN products p ON pv.product_id = p.id
        WHERE pv.product_id = product_uuid AND pv.is_active = true
    )
    SELECT * FROM product_stock
    ORDER BY variant_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update inventory with movement tracking
CREATE OR REPLACE FUNCTION public.update_inventory(
    p_tenant_id UUID,
    p_product_id UUID,
    p_variant_id UUID DEFAULT NULL,
    p_quantity_change INTEGER,
    p_movement_type VARCHAR(50),
    p_reference_type VARCHAR(50) DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_performed_by UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    current_stock INTEGER;
    new_stock INTEGER;
    target_table_name TEXT;
    target_id UUID;
BEGIN
    -- Determine if we're updating product or variant stock
    IF p_variant_id IS NOT NULL THEN
        SELECT stock_quantity INTO current_stock 
        FROM product_variants 
        WHERE id = p_variant_id AND tenant_id = p_tenant_id;
        
        IF current_stock IS NULL THEN
            RAISE EXCEPTION 'Product variant not found or access denied';
        END IF;
        
        new_stock := current_stock + p_quantity_change;
        
        -- Check for negative stock
        IF new_stock < 0 THEN
            RAISE EXCEPTION 'Insufficient stock. Current: %, Requested: %', current_stock, ABS(p_quantity_change);
        END IF;
        
        -- Update variant stock
        UPDATE product_variants 
        SET stock_quantity = new_stock, updated_at = NOW()
        WHERE id = p_variant_id AND tenant_id = p_tenant_id;
        
        target_id := p_variant_id;
    ELSE
        SELECT stock_quantity INTO current_stock 
        FROM products 
        WHERE id = p_product_id AND tenant_id = p_tenant_id AND track_inventory = true;
        
        IF current_stock IS NULL THEN
            RAISE EXCEPTION 'Product not found, not trackable, or access denied';
        END IF;
        
        new_stock := current_stock + p_quantity_change;
        
        -- Check for negative stock
        IF new_stock < 0 THEN
            RAISE EXCEPTION 'Insufficient stock. Current: %, Requested: %', current_stock, ABS(p_quantity_change);
        END IF;
        
        -- Update product stock
        UPDATE products 
        SET stock_quantity = new_stock, updated_at = NOW()
        WHERE id = p_product_id AND tenant_id = p_tenant_id;
        
        target_id := p_product_id;
    END IF;
    
    -- Record inventory movement
    INSERT INTO inventory_movements (
        tenant_id,
        product_id,
        variant_id,
        movement_type,
        quantity_change,
        previous_quantity,
        new_quantity,
        reference_type,
        reference_id,
        reason,
        performed_by
    ) VALUES (
        p_tenant_id,
        p_product_id,
        p_variant_id,
        p_movement_type,
        p_quantity_change,
        current_stock,
        new_stock,
        p_reference_type,
        p_reference_id,
        p_reason,
        p_performed_by
    );
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_product_stock TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_inventory TO authenticated;

-- ========================================
-- 9. SAMPLE DATA FOR DEVELOPMENT
-- ========================================

-- Insert sample product categories for testing
DO $$
DECLARE
    sample_tenant_id UUID;
BEGIN
    -- Get a sample tenant ID (replace with actual tenant ID in production)
    SELECT id INTO sample_tenant_id FROM tenants LIMIT 1;
    
    IF sample_tenant_id IS NOT NULL THEN
        -- Hair Care Categories
        INSERT INTO product_categories (tenant_id, name, description, display_order) VALUES
        (sample_tenant_id, 'Hair Care', 'Professional hair care products', 1),
        (sample_tenant_id, 'Styling Tools', 'Professional styling equipment', 2),
        (sample_tenant_id, 'Nail Care', 'Nail products and accessories', 3),
        (sample_tenant_id, 'Skin Care', 'Professional skincare products', 4),
        (sample_tenant_id, 'Accessories', 'General salon accessories', 5);
        
        RAISE NOTICE 'Sample product categories inserted for tenant: %', sample_tenant_id;
    END IF;
END $$;

-- Log completion
DO $$
BEGIN
    RAISE NOTICE 'Product Catalogue Schema Migration 035 completed successfully';
    RAISE NOTICE 'Created tables: product_categories, products, product_variants, inventory_movements, service_products';
    RAISE NOTICE 'Added RLS policies for multi-tenant isolation';
    RAISE NOTICE 'Created utility functions for inventory management';
    RAISE NOTICE 'Added performance indexes for search and filtering';
END $$;