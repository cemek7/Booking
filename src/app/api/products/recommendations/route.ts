import { createHttpHandler } from '@/lib/create-http-handler';
import { z } from 'zod';
import { Product } from '@/types/product-catalogue';

/**
 * AI-powered product recommendations
 * Analyzes booking history, product relationships, and upsell priorities
 */

interface RecommendationRequest {
  context: 'booking' | 'product_view' | 'cart' | 'general';
  customer_id?: string;
  product_ids?: string[];
  service_ids?: string[];
  max_recommendations?: number;
  price_range_factor?: number; // 0.5 = 50% of current basket value
}

interface RecommendationScore {
  product_id: string;
  score: number;
  reasons: string[];
  confidence: number;
}

const RecommendationRequestSchema = z.object({
  context: z.enum(['booking', 'product_view', 'cart', 'general']),
  customer_id: z.string().optional(),
  product_ids: z.array(z.string()).optional(),
  service_ids: z.array(z.string()).optional(),
  max_recommendations: z.number().int().min(1).max(50).default(10),
  price_range_factor: z.number().min(0).max(10).default(1.0),
});

export const POST = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const body = await ctx.request.json();
    const bodyValidation = RecommendationRequestSchema.safeParse(body);

    if (!bodyValidation.success) {
      throw new Error(`Invalid request body: ${JSON.stringify(bodyValidation.error.issues)}`);
    }

    const {
      context,
      customer_id,
      product_ids = [],
      service_ids = [],
      max_recommendations = 10,
      price_range_factor = 1.0
    } = bodyValidation.data;

    // Get recommendations based on context
    const recommendations = await generateRecommendations(
      ctx.supabase,
      tenantId,
      context,
      {
        customer_id,
        product_ids,
        service_ids,
        max_recommendations,
        price_range_factor
      }
    );

    // Get product details for recommended items
    const productIds = recommendations.map(r => r.product_id);
    
    const { data: products, error: productsError } = await ctx.supabase
      .from('products')
      .select(`
        *,
        category:categories(name, slug),
        variants:product_variants(*)
      `)
      .eq('tenant_id', tenantId)
      .in('id', productIds)
      .eq('is_active', true);

    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`);
    }

    // Combine recommendations with product details and sort by score
    const enrichedRecommendations = recommendations
      .map(rec => {
        const product = products?.find(p => p.id === rec.product_id);
        return product ? { ...rec, product } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score);

    return {
      recommendations: enrichedRecommendations,
      context,
      total_count: enrichedRecommendations.length,
      algorithm_version: '1.0'
    };
  },
  'POST',
  { auth: true }
);

async function generateRecommendations(
  supabase: any,
  tenantId: string,
  context: string,
  options: {
    customer_id?: string;
    product_ids: string[];
    service_ids: string[];
    max_recommendations: number;
    price_range_factor: number;
  }
): Promise<RecommendationScore[]> {
  const scores: Map<string, RecommendationScore> = new Map();

  // 1. Get all active products for this tenant
  const { data: allProducts } = await supabase
    .from('products')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (!allProducts) return [];

  // 2. Calculate base scores for each product
  for (const product of allProducts) {
    if (options.product_ids.includes(product.id)) continue; // Don't recommend already selected products

    const score: RecommendationScore = {
      product_id: product.id,
      score: 0,
      reasons: [],
      confidence: 0
    };

    // Base upsell priority score (0-100)
    score.score += product.upsell_priority || 0;
    if (product.upsell_priority > 0) {
      score.reasons.push(`High upsell priority (${product.upsell_priority})`);
    }

    // Featured product bonus
    if (product.is_featured) {
      score.score += 20;
      score.reasons.push('Featured product');
    }

    // Stock availability factor
    if (product.track_inventory) {
      if (product.stock_quantity > 0) {
        score.score += 10;
        if (product.stock_quantity > product.low_stock_threshold) {
          score.score += 5;
          score.reasons.push('In stock');
        }
      } else {
        score.score -= 50; // Heavily penalize out of stock
        continue; // Skip out of stock products
      }
    }

    scores.set(product.id, score);
  }

  // 3. Context-specific scoring
  if (context === 'booking' && options.service_ids.length > 0) {
    await addServiceBasedRecommendations(supabase, tenantId, options.service_ids, scores);
  }

  if (context === 'product_view' && options.product_ids.length > 0) {
    await addProductAffinityRecommendations(supabase, tenantId, options.product_ids, scores);
  }

  if (options.customer_id) {
    await addCustomerHistoryRecommendations(supabase, tenantId, options.customer_id, scores);
  }

  // 4. Apply price range filtering if specified
  if (options.price_range_factor < 1.0 && options.product_ids.length > 0) {
    const { data: selectedProducts } = await supabase
      .from('products')
      .select('price_cents')
      .in('id', options.product_ids);

    if (selectedProducts && selectedProducts.length > 0) {
      const avgPrice = selectedProducts.reduce((sum, p) => sum + p.price_cents, 0) / selectedProducts.length;
      const maxRecommendedPrice = avgPrice * options.price_range_factor;

      // Filter out products that are too expensive
      for (const [productId, score] of scores.entries()) {
        const product = allProducts.find(p => p.id === productId);
        if (product && product.price_cents > maxRecommendedPrice) {
          scores.delete(productId);
        }
      }
    }
  }

  // 5. Calculate confidence scores and return top recommendations
  const recommendations = Array.from(scores.values())
    .map(score => {
      // Confidence based on number of scoring factors
      score.confidence = Math.min(score.reasons.length * 0.2, 1.0);
      return score;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, options.max_recommendations);

  return recommendations;
}

async function addServiceBasedRecommendations(
  supabase: any,
  tenantId: string,
  serviceIds: string[],
  scores: Map<string, RecommendationScore>
) {
  // Get products linked to these services
  const { data: serviceProducts } = await supabase
    .from('service_products')
    .select('product_id, service_id')
    .eq('tenant_id', tenantId)
    .in('service_id', serviceIds);

  if (serviceProducts) {
    for (const sp of serviceProducts) {
      const score = scores.get(sp.product_id);
      if (score) {
        score.score += 30;
        score.reasons.push('Commonly used with selected service');
      }
    }
  }

  // Analyze historical booking patterns
  const { data: bookingHistory } = await supabase
    .from('bookings')
    .select(`
      id,
      booking_products!inner(product_id)
    `)
    .eq('tenant_id', tenantId)
    .in('service_id', serviceIds)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()); // Last 90 days

  if (bookingHistory) {
    const productFrequency = new Map<string, number>();
    
    for (const booking of bookingHistory) {
      if (booking.booking_products) {
        for (const bp of booking.booking_products) {
          const count = productFrequency.get(bp.product_id) || 0;
          productFrequency.set(bp.product_id, count + 1);
        }
      }
    }

    // Add frequency-based scoring
    for (const [productId, frequency] of productFrequency.entries()) {
      const score = scores.get(productId);
      if (score && frequency > 1) {
        const frequencyBonus = Math.min(frequency * 5, 25);
        score.score += frequencyBonus;
        score.reasons.push(`Frequently booked together (${frequency} times)`);
      }
    }
  }
}

async function addProductAffinityRecommendations(
  supabase: any,
  tenantId: string,
  productIds: string[],
  scores: Map<string, RecommendationScore>
) {
  // Get category and tags of viewed products
  const { data: viewedProducts } = await supabase
    .from('products')
    .select('category_id, tags')
    .eq('tenant_id', tenantId)
    .in('id', productIds);

  if (!viewedProducts) return;

  const categoryIds = [...new Set(viewedProducts.map(p => p.category_id).filter(Boolean))];
  const allTags = [...new Set(viewedProducts.flatMap(p => p.tags || []))];

  // Boost products in same categories
  if (categoryIds.length > 0) {
    for (const [productId, score] of scores.entries()) {
      const { data: productDetail } = await supabase
        .from('products')
        .select('category_id, tags')
        .eq('id', productId)
        .single();

      if (productDetail) {
        if (categoryIds.includes(productDetail.category_id)) {
          score.score += 15;
          score.reasons.push('Same category as viewed product');
        }

        // Tag similarity
        if (productDetail.tags && allTags.length > 0) {
          const commonTags = productDetail.tags.filter(tag => allTags.includes(tag));
          if (commonTags.length > 0) {
            score.score += commonTags.length * 8;
            score.reasons.push(`Similar tags: ${commonTags.join(', ')}`);
          }
        }
      }
    }
  }
}

async function addCustomerHistoryRecommendations(
  supabase: any,
  tenantId: string,
  customerId: string,
  scores: Map<string, RecommendationScore>
) {
  // Get customer's purchase history
  const { data: customerBookings } = await supabase
    .from('bookings')
    .select(`
      id,
      booking_products!inner(product_id, quantity)
    `)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .gte('created_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString()) // Last 6 months
    .order('created_at', { ascending: false })
    .limit(50);

  if (!customerBookings) return;

  const purchasedProducts = new Set();
  const productPurchaseCount = new Map<string, number>();

  for (const booking of customerBookings) {
    if (booking.booking_products) {
      for (const bp of booking.booking_products) {
        purchasedProducts.add(bp.product_id);
        const count = productPurchaseCount.get(bp.product_id) || 0;
        productPurchaseCount.set(bp.product_id, count + bp.quantity);
      }
    }
  }

  // Find products frequently bought by similar customers
  const { data: similarCustomers } = await supabase
    .from('bookings')
    .select(`
      customer_id,
      booking_products!inner(product_id)
    `)
    .eq('tenant_id', tenantId)
    .in('booking_products.product_id', Array.from(purchasedProducts))
    .neq('customer_id', customerId)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  if (similarCustomers) {
    const collaborativeRecommendations = new Map<string, number>();
    
    for (const booking of similarCustomers) {
      if (booking.booking_products) {
        for (const bp of booking.booking_products) {
          if (!purchasedProducts.has(bp.product_id)) {
            const count = collaborativeRecommendations.get(bp.product_id) || 0;
            collaborativeRecommendations.set(bp.product_id, count + 1);
          }
        }
      }
    }

    // Apply collaborative filtering scores
    for (const [productId, similarityCount] of collaborativeRecommendations.entries()) {
      const score = scores.get(productId);
      if (score && similarityCount > 1) {
        const collaborativeBonus = Math.min(similarityCount * 3, 20);
        score.score += collaborativeBonus;
        score.reasons.push(`Popular with similar customers`);
      }
    }
  }

  // Penalize recently purchased products (avoid recommending same items)
  for (const productId of purchasedProducts) {
    const score = scores.get(productId);
    if (score) {
      const purchaseCount = productPurchaseCount.get(productId) || 0;
      const recencyPenalty = Math.min(purchaseCount * 10, 30);
      score.score -= recencyPenalty;
      score.reasons.push('Recently purchased');
    }
  }
}