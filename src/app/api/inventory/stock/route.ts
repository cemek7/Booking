import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/supabaseClient';
import { getSession } from '../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../../lib/error-handling';
import { inventoryService } from '../../../../lib/services/inventory-service';

// Zod schema for GET query parameters
const GetStockQuerySchema = z.object({
  low_stock_only: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  out_of_stock_only: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  category_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
});

/**
 * GET /api/inventory/stock
 * Get current stock levels for products and variants for the tenant.
 * Requires 'manager' or higher role.
 */
export async function GET(req: NextRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Restricting to manager/owner for now to resolve type issue.
    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId, ['owner', 'manager']);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const queryValidation = GetStockQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const filters = queryValidation.data;

    // The inventoryService.getStockLevels already contains the core logic.
    // We pass the tenantId and filters to it.
    const result = await inventoryService.getStockLevels([tenantId], {
        productId: filters.product_id,
        categoryId: filters.category_id,
        lowStockOnly: filters.low_stock_only,
        outOfStockOnly: filters.out_of_stock_only,
    });

    if (!result.success || !result.stockLevels) {
        throw new Error(result.error || 'Failed to get stock levels from service.');
    }

    const stockLevels = result.stockLevels;

    // --- Response Formatting & Summary ---
    const summary = {
      total_tracked_items: stockLevels.length,
      low_stock_items: stockLevels.filter(item => item.is_low_stock && item.current_stock > 0).length,
      out_of_stock_items: stockLevels.filter(item => item.current_stock === 0).length,
    };
    
    // The service doesn't provide category info directly on the stock level object,
    // so this part would need adjustment if category breakdown is required.
    // For now, we'll omit the category_breakdown for simplicity as it requires another fetch.
    // TODO: Enhance inventoryService.getStockLevels to include category info for breakdown.

    return NextResponse.json({
      stock_levels: stockLevels,
      summary,
    });

  } catch (error) {
    return handleApiError(error, 'Failed to retrieve stock levels');
  }
}