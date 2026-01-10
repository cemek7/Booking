/**
 * Inventory Service
 * Business logic for inventory management operations
 */

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { 
  InventoryMovement, 
  UpdateInventoryRequest,
  ProductStockInfo,
  InventoryMovementType 
} from '@/types/product-catalogue';

export class InventoryService {
  private supabase;

  constructor() {
    this.supabase = createServerSupabaseClient();
  }

  /**
   * Update inventory for a product or variant
   */
  async updateInventory(
    tenantId: string,
    userId: string,
    request: UpdateInventoryRequest
  ): Promise<{ success: boolean; movement?: InventoryMovement; error?: string }> {
    try {
      // Validate request
      if (!request.product_id && !request.variant_id) {
        return { success: false, error: 'Either product_id or variant_id is required' };
      }

      if (request.quantity_change === 0) {
        return { success: false, error: 'Quantity change cannot be zero' };
      }

      // Use the database function for atomic inventory updates
      const { data: result, error } = await this.supabase.rpc('update_inventory', {
        p_tenant_id: tenantId,
        p_product_id: request.product_id || null,
        p_variant_id: request.variant_id || null,
        p_quantity_change: request.quantity_change,
        p_movement_type: request.movement_type,
        p_reference_type: request.reference_type || null,
        p_reference_id: request.reference_id || null,
        p_reason: request.reason || null,
        p_performed_by: userId,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Fetch the created movement record
      const { data: movement } = await this.supabase
        .from('inventory_movements')
        .select(`
          *,
          product:products!product_id(id, name, sku),
          variant:product_variants!variant_id(id, variant_name, variant_type)
        `)
        .eq('tenant_id', tenantId)
        .eq('performed_by', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      return { success: true, movement: movement || undefined };

    } catch (error) {
      console.error('InventoryService.updateInventory error:', error);
      return { success: false, error: 'Failed to update inventory' };
    }
  }

  /**
   * Get current stock levels for products and variants
   */
  async getStockLevels(
    tenantIds: string[],
    filters?: {
      productId?: string;
      categoryId?: string;
      lowStockOnly?: boolean;
      outOfStockOnly?: boolean;
    }
  ): Promise<{ success: boolean; stockLevels?: ProductStockInfo[]; error?: string }> {
    try {
      let query = this.supabase
        .from('products')
        .select(`
          id, name, sku, stock_quantity, low_stock_threshold, track_inventory,
          category:product_categories!category_id(id, name),
          variants:product_variants!product_id(
            id, variant_name, variant_type, stock_quantity, is_active
          )
        `)
        .in('tenant_id', tenantIds)
        .eq('is_active', true)
        .eq('track_inventory', true);

      if (filters?.categoryId) {
        query = query.eq('category_id', filters.categoryId);
      }

      if (filters?.productId) {
        query = query.eq('id', filters.productId);
      }

      const { data: products, error } = await query;

      if (error) {
        return { success: false, error: 'Failed to fetch stock levels' };
      }

      const stockLevels: ProductStockInfo[] = [];

      (products || []).forEach(product => {
        // Add base product stock info
        stockLevels.push({
          product_id: product.id,
          current_stock: product.stock_quantity,
          low_stock_threshold: product.low_stock_threshold,
          is_low_stock: product.stock_quantity <= product.low_stock_threshold,
        });

        // Add variant stock info
        (product.variants || [])
          .filter(variant => variant.is_active)
          .forEach(variant => {
            stockLevels.push({
              product_id: product.id,
              variant_id: variant.id,
              variant_name: `${variant.variant_name} (${variant.variant_type})`,
              current_stock: variant.stock_quantity,
              low_stock_threshold: product.low_stock_threshold,
              is_low_stock: variant.stock_quantity <= product.low_stock_threshold,
            });
          });
      });

      // Apply filters
      let filteredLevels = stockLevels;

      if (filters?.outOfStockOnly) {
        filteredLevels = stockLevels.filter(level => level.current_stock === 0);
      } else if (filters?.lowStockOnly) {
        filteredLevels = stockLevels.filter(level => level.is_low_stock);
      }

      return { success: true, stockLevels: filteredLevels };

    } catch (error) {
      console.error('InventoryService.getStockLevels error:', error);
      return { success: false, error: 'Failed to fetch stock levels' };
    }
  }

  /**
   * Get low stock alerts
   */
  async getLowStockAlerts(tenantIds: string[]): Promise<{
    success: boolean;
    alerts?: Array<{
      product_id: string;
      product_name: string;
      variant_id?: string;
      variant_name?: string;
      current_stock: number;
      threshold: number;
      urgency: 'critical' | 'warning' | 'low';
    }>;
    error?: string;
  }> {
    try {
      const { data: products, error } = await this.supabase
        .from('products')
        .select(`
          id, name, sku, stock_quantity, low_stock_threshold,
          category:product_categories!category_id(name),
          variants:product_variants!product_id(
            id, variant_name, variant_type, stock_quantity, is_active
          )
        `)
        .in('tenant_id', tenantIds)
        .eq('is_active', true)
        .eq('track_inventory', true);

      if (error) {
        return { success: false, error: 'Failed to fetch low stock alerts' };
      }

      const alerts: any[] = [];

      (products || []).forEach(product => {
        // Check base product stock
        if (product.stock_quantity <= product.low_stock_threshold) {
          const urgency = product.stock_quantity === 0 ? 'critical' : 
                         product.stock_quantity <= product.low_stock_threshold * 0.5 ? 'warning' : 'low';

          alerts.push({
            product_id: product.id,
            product_name: product.name,
            current_stock: product.stock_quantity,
            threshold: product.low_stock_threshold,
            urgency,
          });
        }

        // Check variant stock
        (product.variants || [])
          .filter(variant => variant.is_active)
          .forEach(variant => {
            if (variant.stock_quantity <= product.low_stock_threshold) {
              const urgency = variant.stock_quantity === 0 ? 'critical' : 
                             variant.stock_quantity <= product.low_stock_threshold * 0.5 ? 'warning' : 'low';

              alerts.push({
                product_id: product.id,
                product_name: product.name,
                variant_id: variant.id,
                variant_name: `${variant.variant_name} (${variant.variant_type})`,
                current_stock: variant.stock_quantity,
                threshold: product.low_stock_threshold,
                urgency,
              });
            }
          });
      });

      // Sort by urgency (critical first)
      alerts.sort((a, b) => {
        const urgencyOrder = { critical: 0, warning: 1, low: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      });

      return { success: true, alerts };

    } catch (error) {
      console.error('InventoryService.getLowStockAlerts error:', error);
      return { success: false, error: 'Failed to fetch low stock alerts' };
    }
  }

  /**
   * Process inventory for a booking (reduce stock)
   */
  async processBookingInventory(
    tenantId: string,
    bookingId: string,
    items: Array<{
      productId?: string;
      variantId?: string;
      quantity: number;
    }>,
    userId: string
  ): Promise<{ success: boolean; movements?: InventoryMovement[]; error?: string }> {
    try {
      const movements: InventoryMovement[] = [];

      for (const item of items) {
        const result = await this.updateInventory(tenantId, userId, {
          product_id: item.productId,
          variant_id: item.variantId,
          quantity_change: -item.quantity, // Negative for sale
          movement_type: 'sale',
          reference_type: 'booking',
          reference_id: bookingId,
          reason: 'Product sold during booking',
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }

        if (result.movement) {
          movements.push(result.movement);
        }
      }

      return { success: true, movements };

    } catch (error) {
      console.error('InventoryService.processBookingInventory error:', error);
      return { success: false, error: 'Failed to process booking inventory' };
    }
  }

  /**
   * Bulk inventory update
   */
  async bulkUpdateInventory(
    tenantId: string,
    userId: string,
    updates: Array<UpdateInventoryRequest>
  ): Promise<{ 
    success: boolean; 
    results?: Array<{ success: boolean; movement?: InventoryMovement; error?: string }>;
    error?: string;
  }> {
    try {
      const results = [];

      for (const update of updates) {
        const result = await this.updateInventory(tenantId, userId, update);
        results.push(result);
      }

      const failedUpdates = results.filter(r => !r.success);
      
      return { 
        success: failedUpdates.length === 0, 
        results,
        error: failedUpdates.length > 0 ? `${failedUpdates.length} updates failed` : undefined
      };

    } catch (error) {
      console.error('InventoryService.bulkUpdateInventory error:', error);
      return { success: false, error: 'Failed to perform bulk inventory update' };
    }
  }

  /**
   * Get inventory movement history
   */
  async getMovementHistory(
    tenantIds: string[],
    filters?: {
      productId?: string;
      variantId?: string;
      movementType?: InventoryMovementType;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
    }
  ): Promise<{ success: boolean; movements?: InventoryMovement[]; error?: string }> {
    try {
      let query = this.supabase
        .from('inventory_movements')
        .select(`
          *,
          product:products!product_id(id, name, sku),
          variant:product_variants!variant_id(id, variant_name, variant_type),
          performed_by_user:profiles!performed_by(id, full_name, email)
        `)
        .in('tenant_id', tenantIds)
        .order('created_at', { ascending: false });

      if (filters?.productId) {
        query = query.eq('product_id', filters.productId);
      }

      if (filters?.variantId) {
        query = query.eq('variant_id', filters.variantId);
      }

      if (filters?.movementType) {
        query = query.eq('movement_type', filters.movementType);
      }

      if (filters?.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }

      if (filters?.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data: movements, error } = await query;

      if (error) {
        return { success: false, error: 'Failed to fetch movement history' };
      }

      return { success: true, movements: movements || [] };

    } catch (error) {
      console.error('InventoryService.getMovementHistory error:', error);
      return { success: false, error: 'Failed to fetch movement history' };
    }
  }

  /**
   * Calculate reorder suggestions based on movement patterns
   */
  async getReorderSuggestions(
    tenantIds: string[],
    days: number = 30
  ): Promise<{
    success: boolean;
    suggestions?: Array<{
      product_id: string;
      product_name: string;
      variant_id?: string;
      variant_name?: string;
      current_stock: number;
      average_daily_usage: number;
      days_until_stockout: number;
      suggested_reorder_quantity: number;
      priority: 'high' | 'medium' | 'low';
    }>;
    error?: string;
  }> {
    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - days);

      // Get movement data for calculation
      const { data: movements, error } = await this.supabase
        .from('inventory_movements')
        .select(`
          product_id, variant_id, quantity_change, movement_type,
          product:products!product_id(id, name, stock_quantity, low_stock_threshold)
        `)
        .in('tenant_id', tenantIds)
        .gte('created_at', dateFrom.toISOString())
        .in('movement_type', ['sale', 'damage', 'adjustment']);

      if (error) {
        return { success: false, error: 'Failed to fetch movement data for analysis' };
      }

      // Calculate usage patterns
      const usageMap = new Map<string, {
        productId: string;
        variantId?: string;
        totalUsage: number;
        currentStock: number;
        threshold: number;
      }>();

      (movements || []).forEach(movement => {
        const key = movement.variant_id ? 
          `${movement.product_id}_${movement.variant_id}` : 
          movement.product_id;

        if (!usageMap.has(key)) {
          usageMap.set(key, {
            productId: movement.product_id,
            variantId: movement.variant_id,
            totalUsage: 0,
            currentStock: movement.product.stock_quantity,
            threshold: movement.product.low_stock_threshold,
          });
        }

        const item = usageMap.get(key)!;
        if (movement.quantity_change < 0) { // Outgoing stock
          item.totalUsage += Math.abs(movement.quantity_change);
        }
      });

      // Generate suggestions
      const suggestions = Array.from(usageMap.values()).map(item => {
        const averageDailyUsage = item.totalUsage / days;
        const daysUntilStockout = averageDailyUsage > 0 ? 
          item.currentStock / averageDailyUsage : 
          999; // Very high number if no usage

        // Calculate suggested reorder quantity (30 days supply + safety stock)
        const suggestedReorderQuantity = Math.ceil(
          (averageDailyUsage * 30) + item.threshold
        );

        // Determine priority
        let priority: 'high' | 'medium' | 'low' = 'low';
        if (daysUntilStockout <= 7) priority = 'high';
        else if (daysUntilStockout <= 14) priority = 'medium';

        return {
          product_id: item.productId,
          product_name: 'Product Name', // Would need to fetch from join
          variant_id: item.variantId,
          variant_name: item.variantId ? 'Variant Name' : undefined,
          current_stock: item.currentStock,
          average_daily_usage: Math.round(averageDailyUsage * 100) / 100,
          days_until_stockout: Math.round(daysUntilStockout * 10) / 10,
          suggested_reorder_quantity: suggestedReorderQuantity,
          priority,
        };
      }).filter(suggestion => 
        suggestion.current_stock <= suggestion.suggested_reorder_quantity ||
        suggestion.days_until_stockout <= 30
      ).sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });

      return { success: true, suggestions };

    } catch (error) {
      console.error('InventoryService.getReorderSuggestions error:', error);
      return { success: false, error: 'Failed to calculate reorder suggestions' };
    }
  }
}

// Singleton instance
export const inventoryService = new InventoryService();