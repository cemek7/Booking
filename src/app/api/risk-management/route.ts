import { z } from 'zod';
import { NextResponse } from 'next/server';
import { createHttpHandler } from '@/lib/error-handling/route-handler';
import { ApiErrorFactory } from '@/lib/error-handling/api-error';
import DoubleBookingPrevention from '@/lib/doubleBookingPrevention';
import PaymentSecurityService from '@/lib/paymentSecurityService';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('boka-risk-management');

const AcquireLockSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  resourceId: z.string().optional(),
  sessionId: z.string().optional(),
  lockDurationMinutes: z.number().optional(),
});

const ReleaseLockSchema = z.object({
  lockId: z.string(),
});

const ConflictCheckSchema = z.object({
  startAt: z.string(),
  endAt: z.string(),
  resourceIds: z.array(z.string()).optional(),
  excludeReservationId: z.string().optional(),
});

const FraudAssessmentSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  email: z.string().email(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  countryCode: z.string().optional(),
  paymentMethod: z.string().optional(),
});

/**
 * POST /api/risk-management
 * Risk management actions: acquire_lock, release_lock, check_conflicts, security_metrics, fraud_assessment, cleanup_expired
 */
export const POST = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('risk_management.api');

    try {
      const url = new URL(ctx.request.url);
      const action = url.searchParams.get('action');
      const tenantId = ctx.user?.tenantId || ctx.request.headers.get('x-tenant-id');

      if (!tenantId) {
        throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
      }

      span.setAttribute('risk_management.action', action || 'unknown');
      span.setAttribute('risk_management.tenant_id', tenantId);

      const doubleBookingPrevention = new DoubleBookingPrevention(ctx.supabase);
      const paymentSecurity = new PaymentSecurityService(ctx.supabase);

      switch (action) {
        case 'acquire_lock': {
          const body = await ctx.request.json();
          const validation = AcquireLockSchema.safeParse(body);
          if (!validation.success) {
            throw ApiErrorFactory.validationError({ issues: validation.error.issues });
          }

          const result = await doubleBookingPrevention.acquireSlotLock({
            tenantId,
            startAt: validation.data.startAt,
            endAt: validation.data.endAt,
            resourceId: validation.data.resourceId,
            sessionId: validation.data.sessionId,
            lockDurationMinutes: validation.data.lockDurationMinutes,
          });

          span.setAttribute('lock.acquired', result.success);
          span.setAttribute('lock.is_conflict', result.isConflict || false);

          if (result.success) {
            return { success: true, lockId: result.lockId };
          } else {
            return new NextResponse(
              JSON.stringify({ success: false, error: result.error, isConflict: result.isConflict }),
              { status: result.isConflict ? 409 : 500 }
            );
          }
        }

        case 'release_lock': {
          const body = await ctx.request.json();
          const validation = ReleaseLockSchema.safeParse(body);
          if (!validation.success) {
            throw ApiErrorFactory.validationError({ issues: validation.error.issues });
          }

          const result = await doubleBookingPrevention.releaseSlotLock(validation.data.lockId);
          span.setAttribute('lock.released', result.success);
          return result;
        }

        case 'check_conflicts': {
          const body = await ctx.request.json();
          const validation = ConflictCheckSchema.safeParse(body);
          if (!validation.success) {
            throw ApiErrorFactory.validationError({ issues: validation.error.issues });
          }

          const result = await doubleBookingPrevention.checkBookingConflicts({
            tenantId,
            startAt: validation.data.startAt,
            endAt: validation.data.endAt,
            resourceIds: validation.data.resourceIds,
            excludeReservationId: validation.data.excludeReservationId,
          });

          span.setAttribute('conflicts.count', result.conflicts.length);
          span.setAttribute('conflicts.has_conflict', result.hasConflict);
          return result;
        }

        case 'security_metrics': {
          const metrics = await paymentSecurity.monitorSecurityMetrics(tenantId);
          span.setAttribute('security.chargeback_rate', metrics.chargeback_rate);
          span.setAttribute('security.fraud_score', metrics.fraud_score);
          return { success: true, metrics, timestamp: new Date().toISOString() };
        }

        case 'fraud_assessment': {
          const body = await ctx.request.json();
          const validation = FraudAssessmentSchema.safeParse(body);
          if (!validation.success) {
            throw ApiErrorFactory.validationError({ issues: validation.error.issues });
          }

          const assessment = await paymentSecurity.assessFraud({
            amount: validation.data.amount,
            currency: validation.data.currency,
            email: validation.data.email,
            tenant_id: tenantId,
            ip_address: validation.data.ipAddress,
            user_agent: validation.data.userAgent,
            country_code: validation.data.countryCode,
            payment_method: validation.data.paymentMethod,
          });

          span.setAttribute('fraud.risk_score', assessment.risk_score);
          span.setAttribute('fraud.risk_level', assessment.risk_level);
          span.setAttribute('fraud.recommendation', assessment.recommendation);
          return { success: true, assessment };
        }

        case 'cleanup_expired': {
          const result = await doubleBookingPrevention.cleanupExpiredLocks();
          span.setAttribute('cleanup.count', result.cleanedCount || 0);
          return result;
        }

        default:
          throw ApiErrorFactory.validationError({
            action: 'Invalid action. Supported: acquire_lock, release_lock, check_conflicts, security_metrics, fraud_assessment, cleanup_expired',
          });
      }
    } finally {
      span.end();
    }
  },
  'POST',
  { auth: true, roles: ['owner', 'manager'] }
);

/**
 * GET /api/risk-management
 * Get security metrics or health check.
 */
export const GET = createHttpHandler(
  async (ctx) => {
    const span = tracer.startSpan('risk_management.api_get');

    try {
      const url = new URL(ctx.request.url);
      const action = url.searchParams.get('action');
      const tenantId = ctx.user?.tenantId || ctx.request.headers.get('x-tenant-id');

      if (!tenantId) {
        throw ApiErrorFactory.validationError({ tenantId: 'Tenant ID required' });
      }

      const paymentSecurity = new PaymentSecurityService(ctx.supabase);

      switch (action) {
        case 'security_metrics': {
          const metrics = await paymentSecurity.monitorSecurityMetrics(tenantId);
          return { metrics };
        }

        case 'health_check': {
          return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
              double_booking_prevention: true,
              payment_security: true,
              fraud_detection: true,
            },
          };
        }

        default:
          throw ApiErrorFactory.validationError({ action: 'Invalid action for GET request' });
      }
    } finally {
      span.end();
    }
  },
  'GET',
  { auth: true, roles: ['owner', 'manager'] }
);
