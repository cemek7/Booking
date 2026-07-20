BEGIN;

CREATE OR REPLACE FUNCTION public.record_retail_sale_tx(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_external_customer_ref text DEFAULT NULL,
  p_source_chat_id uuid DEFAULT NULL,
  p_currency text DEFAULT 'NGN',
  p_notes text DEFAULT NULL,
  p_reference_key text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  order_id uuid,
  transaction_id uuid,
  total_cents integer,
  item_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_transaction_id uuid;
  v_total_cents integer := 0;
  v_item_count integer := 0;
  v_reference_key text := COALESCE(NULLIF(trim(p_reference_key), ''), concat('retail_pos_', replace(gen_random_uuid()::text, '-', '')));
  v_item record;
  v_track_inventory boolean;
  v_quantity integer;
  v_unit_price integer;
  v_line_total integer;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'record_retail_sale_tx requires at least one item';
  END IF;

  INSERT INTO public.retail_orders (
    tenant_id,
    customer_id,
    source_chat_id,
    external_customer_ref,
    status,
    payment_status,
    fulfillment_status,
    currency,
    subtotal_cents,
    total_cents,
    notes,
    metadata
  )
  VALUES (
    p_tenant_id,
    p_customer_id,
    p_source_chat_id,
    p_external_customer_ref,
    'fulfilled',
    'paid',
    'fulfilled',
    COALESCE(NULLIF(trim(p_currency), ''), 'NGN'),
    0,
    0,
    p_notes,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'pos',
      'paidAt', now(),
      'paidBy', p_actor_user_id,
      'fulfilledAt', now(),
      'fulfilledBy', p_actor_user_id,
      'inventoryAppliedAt', now(),
      'inventoryAppliedBy', p_actor_user_id,
      'retailSaleAttributedAt', now()
    )
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      product_id uuid,
      variant_id uuid,
      quantity integer,
      unit_price_cents integer,
      total_price_cents integer,
      metadata jsonb
    )
  LOOP
    v_quantity := GREATEST(COALESCE(v_item.quantity, 0), 0);
    v_unit_price := GREATEST(COALESCE(v_item.unit_price_cents, 0), 0);
    v_line_total := COALESCE(v_item.total_price_cents, v_unit_price * v_quantity);

    IF v_item.product_id IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'retail sale items require product_id and positive quantity';
    END IF;

    INSERT INTO public.retail_order_items (
      order_id,
      tenant_id,
      product_id,
      variant_id,
      quantity,
      unit_price_cents,
      total_price_cents,
      metadata
    )
    VALUES (
      v_order_id,
      p_tenant_id,
      v_item.product_id,
      v_item.variant_id,
      v_quantity,
      v_unit_price,
      v_line_total,
      COALESCE(v_item.metadata, '{}'::jsonb)
    );

    SELECT COALESCE(track_inventory, false)
    INTO v_track_inventory
    FROM public.products
    WHERE id = v_item.product_id
      AND tenant_id = p_tenant_id;

    IF COALESCE(v_track_inventory, false) THEN
      PERFORM public.update_inventory(
        p_tenant_id,
        v_item.product_id,
        v_item.variant_id,
        -v_quantity,
        'sale',
        'retail_order',
        v_order_id::text,
        format('Retail POS sale %s', v_order_id),
        p_actor_user_id,
        NULL
      );
    END IF;

    v_total_cents := v_total_cents + v_line_total;
    v_item_count := v_item_count + v_quantity;
  END LOOP;

  UPDATE public.retail_orders
  SET subtotal_cents = v_total_cents,
      total_cents = v_total_cents,
      updated_at = now()
  WHERE id = v_order_id;

  INSERT INTO public.transactions (
    tenant_id,
    amount,
    currency,
    type,
    status,
    subject_type,
    subject_id,
    provider,
    provider_reference,
    raw
  )
  VALUES (
    p_tenant_id,
    v_total_cents / 100.0,
    COALESCE(NULLIF(trim(p_currency), ''), 'NGN'),
    'sale',
    'success',
    'retail_order',
    v_order_id,
    'internal',
    v_reference_key,
    jsonb_build_object(
      'source', 'pos',
      'retail_order_id', v_order_id,
      'item_count', v_item_count,
      'actor_user_id', p_actor_user_id
    )
  )
  RETURNING id INTO v_transaction_id;

  RETURN QUERY
  SELECT v_order_id, v_transaction_id, v_total_cents, v_item_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_retail_sale_tx(
  p_tenant_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text DEFAULT NULL,
  p_reference_key text DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  refund_transaction_id uuid,
  total_cents integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order record;
  v_sale_transaction_id uuid;
  v_existing_refund_id uuid;
  v_refund_transaction_id uuid;
  v_reference_key text := COALESCE(NULLIF(trim(p_reference_key), ''), concat('retail_refund_', replace(gen_random_uuid()::text, '-', '')));
  v_item record;
  v_track_inventory boolean;
BEGIN
  SELECT *
  INTO v_order
  FROM public.retail_orders
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retail order not found';
  END IF;

  IF v_order.payment_status = 'refunded' THEN
    SELECT id
    INTO v_existing_refund_id
    FROM public.transactions
    WHERE tenant_id = p_tenant_id
      AND subject_type = 'retail_order'
      AND subject_id = p_order_id
      AND type = 'refund'
    ORDER BY created_at DESC
    LIMIT 1;

    RETURN QUERY
    SELECT p_order_id, v_existing_refund_id, COALESCE(v_order.total_cents, 0);
    RETURN;
  END IF;

  SELECT id
  INTO v_sale_transaction_id
  FROM public.transactions
  WHERE tenant_id = p_tenant_id
    AND subject_type = 'retail_order'
    AND subject_id = p_order_id
    AND type = 'sale'
  ORDER BY created_at DESC
  LIMIT 1;

  FOR v_item IN
    SELECT roi.product_id, roi.variant_id, roi.quantity
    FROM public.retail_order_items roi
    WHERE roi.order_id = p_order_id
  LOOP
    SELECT COALESCE(track_inventory, false)
    INTO v_track_inventory
    FROM public.products
    WHERE id = v_item.product_id
      AND tenant_id = p_tenant_id;

    IF COALESCE(v_track_inventory, false) THEN
      PERFORM public.update_inventory(
        p_tenant_id,
        v_item.product_id,
        v_item.variant_id,
        GREATEST(COALESCE(v_item.quantity, 0), 0),
        'refund_restock',
        'retail_order',
        p_order_id::text,
        COALESCE(p_reason, format('Retail POS refund %s', p_order_id)),
        p_actor_user_id,
        NULL
      );
    END IF;
  END LOOP;

  UPDATE public.retail_orders
  SET status = 'cancelled',
      payment_status = 'refunded',
      fulfillment_status = 'cancelled',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'refundedAt', now(),
        'refundedBy', p_actor_user_id,
        'inventoryRevertedAt', now()
      ),
      updated_at = now()
  WHERE id = p_order_id
    AND tenant_id = p_tenant_id;

  INSERT INTO public.transactions (
    tenant_id,
    original_transaction_id,
    amount,
    currency,
    type,
    status,
    subject_type,
    subject_id,
    provider,
    provider_reference,
    refund_amount,
    refund_reason,
    raw
  )
  VALUES (
    p_tenant_id,
    v_sale_transaction_id,
    -(COALESCE(v_order.total_cents, 0) / 100.0),
    COALESCE(v_order.currency, 'NGN'),
    'refund',
    'completed',
    'retail_order',
    p_order_id,
    'internal',
    v_reference_key,
    COALESCE(v_order.total_cents, 0) / 100.0,
    p_reason,
    jsonb_build_object(
      'source', 'pos',
      'retail_order_id', p_order_id,
      'original_transaction_id', v_sale_transaction_id,
      'actor_user_id', p_actor_user_id
    )
  )
  RETURNING id INTO v_refund_transaction_id;

  RETURN QUERY
  SELECT p_order_id, v_refund_transaction_id, COALESCE(v_order.total_cents, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_retail_sale_tx(uuid, uuid, jsonb, uuid, text, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_retail_sale_tx(uuid, uuid, uuid, text, text) TO service_role;

COMMIT;
