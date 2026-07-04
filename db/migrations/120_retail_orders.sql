-- 120_retail_orders.sql
--
-- First-class retail cart + order model for AI front-desk sales conversations.
-- Keeps product commerce distinct from service bookings while still linking both
-- back to chats/customers/tenants for operator visibility.

BEGIN;

CREATE TABLE IF NOT EXISTS public.retail_carts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id           uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  source_chat_id        uuid REFERENCES public.chats(id) ON DELETE SET NULL,
  external_customer_ref text,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'abandoned')),
  currency              text NOT NULL DEFAULT 'NGN',
  subtotal_cents        integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  total_cents           integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_carts_tenant_status
  ON public.retail_carts (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_carts_tenant_external_ref
  ON public.retail_carts (tenant_id, external_customer_ref)
  WHERE external_customer_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retail_carts_source_chat
  ON public.retail_carts (source_chat_id)
  WHERE source_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.retail_cart_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id          uuid NOT NULL REFERENCES public.retail_carts(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id       uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  total_price_cents integer NOT NULL DEFAULT 0 CHECK (total_price_cents >= 0),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_cart_items_cart
  ON public.retail_cart_items (cart_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_retail_cart_items_tenant_product
  ON public.retail_cart_items (tenant_id, product_id);

CREATE TABLE IF NOT EXISTS public.retail_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cart_id             uuid REFERENCES public.retail_carts(id) ON DELETE SET NULL,
  customer_id         uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  source_chat_id      uuid REFERENCES public.chats(id) ON DELETE SET NULL,
  external_customer_ref text,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_payment', 'paid', 'cancelled', 'fulfilled')),
  payment_status      text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'failed', 'refunded')),
  fulfillment_status  text NOT NULL DEFAULT 'unfulfilled' CHECK (fulfillment_status IN ('unfulfilled', 'preparing', 'fulfilled', 'cancelled')),
  currency            text NOT NULL DEFAULT 'NGN',
  subtotal_cents      integer NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  total_cents         integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  notes               text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_orders_tenant_status
  ON public.retail_orders (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_retail_orders_cart
  ON public.retail_orders (cart_id)
  WHERE cart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retail_orders_source_chat
  ON public.retail_orders (source_chat_id)
  WHERE source_chat_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.retail_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.retail_orders(id) ON DELETE CASCADE,
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id       uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents integer NOT NULL DEFAULT 0 CHECK (unit_price_cents >= 0),
  total_price_cents integer NOT NULL DEFAULT 0 CHECK (total_price_cents >= 0),
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retail_order_items_order
  ON public.retail_order_items (order_id, created_at ASC);

COMMIT;
