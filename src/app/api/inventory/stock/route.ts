import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { inventoryService } from '@/lib/services/inventory-service';

// Zod schema for GET query parameters
const GetStockQuerySchema = z.object({
  low_stock_only: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  out_of_stock_only: z.preprocess((val) => val === 'true', z.boolean()).optional(),
  category_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
});

interface StockLevel {
  is_low_stock: boolean;
  current_stock: number;
}

/**
 * GET /api/inventory/stock
 * Get current stock levels for products and variants.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetStockQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const filters = queryValidation.data;

    const result = await inventoryService.getStockLevels([tenantId], {
      productId: filters.product_id,
      categoryId: filters.category_id,
      lowStockOnly: filters.low_stock_only,
      outOfStockOnly: filters.out_of_stock_only,
    });

    if (!result.success || !result.stockLevels) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to get stock levels'));
    }

    const stockLevels = result.stockLevels as StockLevel[];

    const summary = {
      total_tracked_items: stockLevels.length,
      low_stock_items: stockLevels.filter(item => item.is_low_stock && item.current_stock > 0).length,
      out_of_stock_items: stockLevels.filter(item => item.current_stock === 0).length,
    };

    return {
      stock_levels: stockLevels,
      summary,
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
