import { z } from 'zod';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import { inventoryService } from '@/lib/services/inventory-service';

// Zod schema for GET query parameters
const GetAlertsQuerySchema = z.object({
  urgency: z.enum(['critical', 'warning', 'low']).optional(),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1).max(200)).default(50),
});

interface Alert {
  product_id: string;
  product_name: string;
  urgency: 'critical' | 'warning' | 'low';
}

interface AlertGroup {
  product_id: string;
  product_name: string;
  alerts: Alert[];
}

/**
 * GET /api/inventory/alerts
 * Get low stock and out-of-stock alerts for the tenant.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.user?.tenantId;
    if (!tenantId) {
      throw ApiErrorFactory.forbidden('Tenant ID required');
    }

    const url = new URL(ctx.request.url);
    const queryValidation = GetAlertsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      throw ApiErrorFactory.validationError({ issues: queryValidation.error.issues });
    }
    const { urgency: urgencyFilter, limit } = queryValidation.data;

    const result = await inventoryService.getLowStockAlerts([tenantId]);

    if (!result.success || !result.alerts) {
      throw ApiErrorFactory.internalServerError(new Error(result.error || 'Failed to get low stock alerts'));
    }

    let alerts = result.alerts as Alert[];

    // Apply urgency filter if provided
    if (urgencyFilter) {
      alerts = alerts.filter(alert => alert.urgency === urgencyFilter);
    }

    // Apply limit
    const limitedAlerts = alerts.slice(0, limit);

    // Calculate summary statistics
    const summary = {
      total_alerts: limitedAlerts.length,
      critical_alerts: limitedAlerts.filter(a => a.urgency === 'critical').length,
      warning_alerts: limitedAlerts.filter(a => a.urgency === 'warning').length,
      low_alerts: limitedAlerts.filter(a => a.urgency === 'low').length,
    };

    // Group alerts by product
    const alertsByProduct = limitedAlerts.reduce((acc, alert) => {
      const key = alert.product_id;
      if (!acc[key]) {
        acc[key] = {
          product_id: alert.product_id,
          product_name: alert.product_name,
          alerts: [],
        };
      }
      acc[key].alerts.push(alert);
      return acc;
    }, {} as Record<string, AlertGroup>);

    return {
      alerts: limitedAlerts,
      summary,
      alerts_by_product: Object.values(alertsByProduct),
    };
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
