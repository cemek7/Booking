import { createHttpHandler } from '../../../../lib/create-http-handler';
import MachineLearningService from '../../../../lib/machineLearningService';
import { z } from 'zod';

const PredictionTypeSchema = z.enum(['scheduling', 'demand', 'anomalies', 'pricing', 'insights']);

const BasePredictionQuerySchema = z.object({
  type: PredictionTypeSchema,
});

const SchedulingQuerySchema = z.object({
  date: z.string().optional(),
  service_id: z.string().optional(),
  staff_id: z.string().optional(),
});

const DemandQuerySchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  service_id: z.string().optional(),
});

const AnomaliesQuerySchema = z.object({
  lookback_days: z.coerce.number().int().min(1).max(365).optional(),
});

const PricingQuerySchema = z.object({
  service_ids: z.string().optional(),
});

const InsightsQuerySchema = z.object({
  customer_ids: z.string().optional(),
});

export const GET = createHttpHandler(
  async (ctx) => {
    const tenantId = ctx.request.headers.get('X-Tenant-ID') || ctx.user?.tenantId;
    
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    const { searchParams } = new URL(ctx.request.url);
    const query = Object.fromEntries(searchParams);

    const baseValidation = BasePredictionQuerySchema.safeParse(query);
    if (!baseValidation.success) {
      throw new Error(`Invalid prediction type: ${JSON.stringify(baseValidation.error.issues)}`);
    }
    const { type } = baseValidation.data;

    const mlService = new MachineLearningService(ctx.supabase);
    let result;

    switch (type) {
      case 'scheduling': {
        const { date, service_id, staff_id } = SchedulingQuerySchema.parse(query);
        result = await mlService.getSchedulingPredictions(tenantId, date, service_id, staff_id);
        break;
      }
      case 'demand': {
        const { start_date, end_date, service_id } = DemandQuerySchema.parse(query);
        result = await mlService.getDemandForecast(tenantId, start_date, end_date, service_id);
        break;
      }
      case 'anomalies': {
        const { lookback_days } = AnomaliesQuerySchema.parse(query);
        result = await mlService.detectAnomalies(tenantId, lookback_days);
        break;
      }
      case 'pricing': {
        const { service_ids } = PricingQuerySchema.parse(query);
        result = await mlService.getPricingOptimizations(tenantId, service_ids?.split(','));
        break;
      }
      case 'insights': {
        const { customer_ids } = InsightsQuerySchema.parse(query);
        result = await mlService.getCustomerInsights(tenantId, customer_ids?.split(','));
        break;
      }
      default:
        throw new Error('Invalid prediction type');
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to generate predictions');
    }

    return result;
  },
  'GET',
  { auth: true, roles: ['manager', 'owner'] }
);
      // The service already provides a structured error
      return NextResponse.json({ error: result.error || 'Prediction failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      type,
      data: result.data,
      usage: result.usage,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    span.recordException(error as Error);
    return handleApiError(error, 'Failed to retrieve ML prediction');
  } finally {
    span.end();
  }
}