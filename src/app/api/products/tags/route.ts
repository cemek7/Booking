import { createHttpHandler } from '@/lib/create-http-handler';

/**
 * Get popular product tags for search suggestions
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const url = new URL(ctx.request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
    const minCount = parseInt(url.searchParams.get('min_count') || '2');

    // Get all tags from active products
    const { data: products, error } = await ctx.supabase
      .from('products')
      .select('tags')
      .eq('tenant_id', ctx.user.tenantId)
      .eq('is_active', true)
      .not('tags', 'is', null);

    if (error) throw new Error(`Failed to fetch tags: ${error.message}`);

    // Count tag frequencies
    const tagCounts = new Map<string, number>();
    
    for (const product of products) {
      if (product.tags && Array.isArray(product.tags)) {
        for (const tag of product.tags) {
          const count = tagCounts.get(tag) || 0;
          tagCounts.set(tag, count + 1);
        }
      }
    }

    // Sort tags by frequency and filter by minimum count
    const popularTags = Array.from(tagCounts.entries())
      .filter(([tag, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));

    return {
      tags: popularTags.map(t => t.tag),
      tag_stats: popularTags,
      total_unique_tags: tagCounts.size
    };
  },
  'GET',
  { auth: true }
);