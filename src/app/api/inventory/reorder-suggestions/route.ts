import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/supabaseClient';
import { getSession } from '../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../../lib/error-handling';
import { inventoryService } from '../../../../lib/services/inventory-service';

// Zod schema for GET query parameters
const GetSuggestionsQuerySchema = z.object({
  days: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(7).max(365)).default(30),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1).max(200)).default(100),
});

/**
 * GET /api/inventory/reorder-suggestions
 * Get intelligent reorder suggestions based on sales velocity and stock levels.
 * Requires 'manager' or 'admin' role.
 */
export async function GET(req: NextRequest) {
  try {
    const { session, tenantId } = await getSession(req);
    if (!session || !tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await validateTenantAccess(createServerSupabaseClient(), session.user.id, tenantId, ['owner', 'manager']);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(req.url);
    const queryValidation = GetSuggestionsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const { days: analysisWindow, priority: priorityFilter, limit } = queryValidation.data;

    const result = await inventoryService.getReorderSuggestions([tenantId], analysisWindow);
    if (!result.success || !result.suggestions) {
      throw new Error(result.error || 'Failed to get reorder suggestions from service.');
    }

    let suggestions = result.suggestions;
    if (priorityFilter) {
      suggestions = suggestions.filter(s => s.priority === priorityFilter);
    }
    const limitedSuggestions = suggestions.slice(0, limit);

    // Enrich suggestions with more product details
    const enrichedSuggestions = await enrichSuggestions(limitedSuggestions, tenantId);

    // --- Response Formatting ---
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
    }, {} as Record<string, any>);

    return NextResponse.json({
      suggestions: enrichedSuggestions,
      summary,
      suggestions_by_category: Object.values(suggestionsByCategory),
    });

  } catch (error) {
    return handleApiError(error, 'Failed to retrieve reorder suggestions');
  }
}

async function enrichSuggestions(suggestions: any[], tenantId: string) {
  if (suggestions.length === 0) return [];

  const supabase = createServerSupabaseClient();
  const productIds = [...new Set(suggestions.map(s => s.product_id))];
  
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, sku, cost_price_cents, category:product_categories(id, name)')
    .in('id', productIds)
    .eq('tenant_id', tenantId);

  if (error) throw error;

  const productMap = new Map(products.map(p => [p.id, p]));

  return suggestions.map(suggestion => {
    const product = productMap.get(suggestion.product_id);
    const estimated_cost = suggestion.suggested_reorder_quantity * (product?.cost_price_cents || 0) / 100;

    return {
      ...suggestion,
      product_name: product?.name || 'Unknown Product',
      sku: product?.sku,
      category: product?.category,
      estimated_cost,
    };
  });
}