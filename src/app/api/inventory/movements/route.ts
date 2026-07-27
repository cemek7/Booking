export const dynamic = 'force-dynamic';
import { createHttpHandler, parseJsonBody } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { z } from 'zod';

/**
 * GET  /api/inventory/movements?product_id=&limit=  — stock movement history
 * POST /api/inventory/movements                     — record a stock movement
 *                                                     and adjust product stock
 *
 * Backs the inventory page's movement history and stock-adjustment actions.
 */

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const url = new URL(ctx.request.url);
    const productId = url.searchParams.get('product_id');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

    let query = ctx.supabase
      .from('inventory_movements')
      .select('id, product_id, variant_id, movement_type, quantity, quantity_change, reason, notes, previous_quantity, new_quantity, created_at, created_by')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (productId) query = query.eq('product_id', productId);

    const { data, error } = await query;
    if (error) throw ApiErrorFactory.databaseError(error);

    return { movements: data ?? [] };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager', 'staff'] }
);

const MovementSchema = z.object({
  product_id: z.string().min(1),
  movement_type: z.enum(['in', 'out', 'adjustment', 'transfer']),
  quantity: z.number().int().optional(),
  quantity_change: z.number().int().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  reference_id: z.string().optional(),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    if (!tenantId) throw ApiErrorFactory.forbidden('Tenant context required');

    const parsed = MovementSchema.safeParse(await parseJsonBody<unknown>(ctx.request));
    if (!parsed.success) {
      throw ApiErrorFactory.validationError(
        Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.') || '_', i.message]))
      );
    }
    const body = parsed.data;

    // Load the product (scoped to tenant) to compute the resulting stock level.
    const { data: product, error: prodErr } = await ctx.supabase
      .from('products')
      .select('id, stock_quantity, track_inventory')
      .eq('id', body.product_id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (prodErr) throw ApiErrorFactory.databaseError(prodErr);
    if (!product) throw ApiErrorFactory.validationError({ product_id: 'Product not found for this tenant' });

    const prev = Number((product as { stock_quantity?: number }).stock_quantity ?? 0);

    // Determine the signed change. `quantity_change` wins if provided; otherwise
    // derive from movement_type + quantity ('out' subtracts, 'adjustment' sets).
    const qty = Number(body.quantity ?? 0);
    let change: number;
    let next: number;
    if (typeof body.quantity_change === 'number') {
      change = body.quantity_change;
      next = prev + change;
    } else if (body.movement_type === 'adjustment') {
      next = qty;
      change = next - prev;
    } else if (body.movement_type === 'out') {
      change = -Math.abs(qty);
      next = prev + change;
    } else {
      // 'in' or 'transfer' (treated as inbound to this location)
      change = Math.abs(qty);
      next = prev + change;
    }
    next = Math.max(0, next);

    const { data: movement, error: moveErr } = await ctx.supabase
      .from('inventory_movements')
      .insert([{
        tenant_id: tenantId,
        product_id: body.product_id,
        movement_type: body.movement_type,
        quantity: Math.abs(qty || change),
        quantity_change: change,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        reference_id: body.reference_id ?? null,
        previous_quantity: prev,
        new_quantity: next,
        created_by: ctx.user!.id,
        performed_by: ctx.user!.id,
      }])
      .select('id, previous_quantity, new_quantity, quantity_change')
      .maybeSingle();
    if (moveErr) throw ApiErrorFactory.databaseError(moveErr);

    // Keep the product's stock level in sync when it tracks inventory.
    if ((product as { track_inventory?: boolean }).track_inventory) {
      const { error: updErr } = await ctx.supabase
        .from('products')
        .update({ stock_quantity: next })
        .eq('id', body.product_id)
        .eq('tenant_id', tenantId);
      if (updErr) throw ApiErrorFactory.databaseError(updErr);
    }

    return { movement, stock_quantity: next, success: true };
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);
