import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../../lib/supabaseClient';
import { getSession } from '../../../../lib/auth/session';
import { validateTenantAccess } from '../../../../lib/enhanced-rbac';
import { z } from 'zod';
import { handleApiError } from '../../../../lib/error-handling';
import { inventoryService } from '../../../../lib/services/inventory-service';

// Zod schema for GET query parameters
const GetAlertsQuerySchema = z.object({
  urgency: z.enum(['critical', 'warning', 'low']).optional(),
  limit: z.preprocess((val) => parseInt(String(val), 10), z.number().int().min(1).max(200)).default(50),
});

/**
 * GET /api/inventory/alerts
 * Get low stock and out-of-stock alerts for the tenant.
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
    const queryValidation = GetAlertsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!queryValidation.success) {
      return NextResponse.json({ error: 'Invalid query parameters', details: queryValidation.error.issues }, { status: 400 });
    }
    const { urgency: urgencyFilter, limit } = queryValidation.data;

    const result = await inventoryService.getLowStockAlerts([tenantId]);

    if (!result.success || !result.alerts) {
      throw new Error(result.error || 'Failed to get low stock alerts from service.');
    }

    let alerts = result.alerts;

    // Apply urgency filter if provided
    if (urgencyFilter) {
      alerts = alerts.filter(alert => alert.urgency === urgencyFilter);
    }

    // Apply limit
    const limitedAlerts = alerts.slice(0, limit);

    // Calculate summary statistics based on the filtered alerts
    const summary = {
      total_alerts: limitedAlerts.length,
      critical_alerts: limitedAlerts.filter(a => a.urgency === 'critical').length,
      warning_alerts: limitedAlerts.filter(a => a.urgency === 'warning').length,
      low_alerts: limitedAlerts.filter(a => a.urgency === 'low').length,
    };

    // Group alerts by product for better organization
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
    }, {} as Record<string, { product_id: string; product_name: string; alerts: any[] }>);

    return NextResponse.json({
      alerts: limitedAlerts,
      summary,
      alerts_by_product: Object.values(alertsByProduct),
    });

  } catch (error) {
    return handleApiError(error, 'Failed to retrieve inventory alerts');
  }
}