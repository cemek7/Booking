import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { inventoryService } from '@/lib/services/inventory-service';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// Zod schema for GET query parameters
const GetSuggestionsQuerySchema = z.object({
  days: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(7).max(365)).default(30),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1).max(200)).default(100),
});

interface Suggestion {
  product_id: string;
  priority: 'high' | 'medium' | 'low';
  suggested_reorder_quantity: number;
  estimated_cost?: number;
  product_name?: string;
  sku?: string;
  category?: { id: string; name: string } | null;
}

interface CategoryGroup {
  category_name: string;
  suggestions: Suggestion[];
  total_cost: number;
}

async function enrichSuggestions(suggestions: Suggestion[], tenantId: string): Promise<Suggestion[]> {
  if (suggestions.length === 0) return [];

  const supabase = createServerSupabaseClient();
  const productIds = [...new Set(suggestions.map(s => s.product_id))];

  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, sku, cost_price_cents, category:product_categories(id, name)')
    .in('id', productIds)
    .eq('tenant_id', tenantId);

  if (error) throw error;

  const productMap = new Map(products?.map(p => [p.id, p]) || []);

  return suggestions.map(suggestion => {
    const product = productMap.get(suggestion.product_id);
    const costPriceCents = (product as { cost_price_cents?: number })?.cost_price_cents || 0;
    const estimated_cost = suggestion.suggested_reorder_quantity * costPriceCents / 100;

    return {
      ...suggestion,
      product_name: product?.name || 'Unknown Product',
      sku: product?.sku,
      category: product?.category as { id: string; name: string } | null,
      estimated_cost,
    };
  });
}

/**
 * GET /api/inventory/reorder-suggestions
 * Get intelligent reorder suggestions based on sales velocity and stock levels.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetSuggestionsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const { days: analysisWindow, priority: priorityFilter, limit } = queryValidation.data;

    const result = await inventoryService.getReorderSuggestions([tenantId], analysisWindow);
    if (!result.success || !result.suggestions) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to get reorder suggestions'));
    }

    let suggestions = result.suggestions as Suggestion[];
    if (priorityFilter) {
      suggestions = suggestions.filter(s => s.priority === priorityFilter);
    }
    const limitedSuggestions = suggestions.slice(0, limit);

    // Enrich suggestions with more product details
    const enrichedSuggestions = await enrichSuggestions(limitedSuggestions, tenantId);

    // Response Formatting
    const summary = {
      total_suggestions: enrichedSuggestions.length,
      high_priority: enrichedSuggestions.filter(s => s.priority === 'high').length,
      medium_priority: enrichedSuggestions.filter(s => s.priority === 'medium').length,
      low_priority: enrichedSuggestions.filter(s => s.priority === 'low').length,
      total_estimated_cost: enrichedSuggestions.reduce((sum, s) => sum + (s.estimated_cost || 0), 0),
      analysis_period_days: analysisWindow,
    };

    const suggestionsByCategory = enrichedSuggestions.reduce((acc, suggestion) => {
      const categoryName = suggestion.category?.name || 'Uncategorized';
      if (!acc[categoryName]) {
        acc[categoryName] = { category_name: categoryName, suggestions: [], total_cost: 0 };
      }
      acc[categoryName].suggestions.push(suggestion);
      acc[categoryName].total_cost += suggestion.estimated_cost || 0;
      return acc;
    }, {} as Record<string, CategoryGroup>);

    return {
      suggestions: enrichedSuggestions,
      summary,
      suggestions_by_category: Object.values(suggestionsByCategory),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
