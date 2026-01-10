import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import DoubleBookingPrevention from '@/lib/doubleBookingPrevention';
import PaymentSecurityService from '@/lib/paymentSecurityService';
import { trace } from '@opentelemetry/api';

interface SlotLockRequest {
  startAt: string;
  endAt: string;
  resourceId?: string;
  sessionId?: string;
  lockDurationMinutes?: number;
}

interface ConflictCheckRequest {
  startAt: string;
  endAt: string;
  resourceIds?: string[];
  excludeReservationId?: string;
}

interface SecurityMetricsRequest {
  tenantId?: string;
}

/**
 * Risk Management API Route
 * Provides endpoints for double-booking prevention and payment security monitoring
 */

export async function POST(req: NextRequest) {
  const tracer = trace.getTracer('boka-risk-management');
  const span = tracer.startSpan('risk_management.api');

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const tenantId = req.headers.get('x-tenant-id');

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant ID' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const doubleBookingPrevention = new DoubleBookingPrevention(supabase);
    const paymentSecurity = new PaymentSecurityService(supabase);

    span.setAttribute('risk_management.action', action || 'unknown');
    span.setAttribute('risk_management.tenant_id', tenantId);

    switch (action) {
      case 'acquire_lock':
        return await handleAcquireLock(req, doubleBookingPrevention, tenantId, span);

      case 'release_lock':
        return await handleReleaseLock(req, doubleBookingPrevention, span);

      case 'check_conflicts':
        return await handleCheckConflicts(req, doubleBookingPrevention, tenantId, span);

      case 'security_metrics':
        return await handleSecurityMetrics(paymentSecurity, tenantId, span);

      case 'fraud_assessment':
        return await handleFraudAssessment(req, paymentSecurity, tenantId, span);

      case 'cleanup_expired':
        return await handleCleanupExpired(doubleBookingPrevention, span);

      default:
        return NextResponse.json(
          { error: 'Invalid action. Supported actions: acquire_lock, release_lock, check_conflicts, security_metrics, fraud_assessment, cleanup_expired' },
          { status: 400 }
        );
    }

  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2, message: 'Error in risk management API' });

    console.error('Risk Management API Error:', error);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    span.end();
  }
}

export async function GET(req: NextRequest) {
  const tracer = trace.getTracer('boka-risk-management');
  const span = tracer.startSpan('risk_management.api_get');

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');
    const tenantId = req.headers.get('x-tenant-id');

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant ID' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const paymentSecurity = new PaymentSecurityService(supabase);

    switch (action) {
      case 'security_metrics':
        const metrics = await paymentSecurity.monitorSecurityMetrics(tenantId);
        return NextResponse.json({ metrics });

      case 'health_check':
        return NextResponse.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            double_booking_prevention: true,
            payment_security: true,
            fraud_detection: true,
          },
        });

      default:
        return NextResponse.json(
          { error: 'Invalid action for GET request' },
          { status: 400 }
        );
    }

  } catch (error) {
    span.recordException(error as Error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  } finally {
    span.end();
  }
}

// Helper functions

async function handleAcquireLock(
  req: NextRequest,
  doubleBookingPrevention: DoubleBookingPrevention,
  tenantId: string,
  span: any
): Promise<NextResponse> {
  const body = await req.json() as SlotLockRequest;
  
  const result = await doubleBookingPrevention.acquireSlotLock({
    tenantId,
    startAt: body.startAt,
    endAt: body.endAt,
    resourceId: body.resourceId,
    sessionId: body.sessionId,
    lockDurationMinutes: body.lockDurationMinutes,
  });

  span.setAttribute('lock.acquired', result.success);
  span.setAttribute('lock.is_conflict', result.isConflict || false);

  if (result.success) {
    return NextResponse.json({
      success: true,
      lockId: result.lockId,
    });
  } else {
    const statusCode = result.isConflict ? 409 : 500;
    return NextResponse.json({
      success: false,
      error: result.error,
      isConflict: result.isConflict,
    }, { status: statusCode });
  }
}

async function handleReleaseLock(
  req: NextRequest,
  doubleBookingPrevention: DoubleBookingPrevention,
  span: any
): Promise<NextResponse> {
  const body = await req.json() as { lockId: string };
  
  const result = await doubleBookingPrevention.releaseSlotLock(body.lockId);

  span.setAttribute('lock.released', result.success);

  return NextResponse.json(result);
}

async function handleCheckConflicts(
  req: NextRequest,
  doubleBookingPrevention: DoubleBookingPrevention,
  tenantId: string,
  span: any
): Promise<NextResponse> {
  const body = await req.json() as ConflictCheckRequest;
  
  const result = await doubleBookingPrevention.checkBookingConflicts({
    tenantId,
    startAt: body.startAt,
    endAt: body.endAt,
    resourceIds: body.resourceIds,
    excludeReservationId: body.excludeReservationId,
  });

  span.setAttribute('conflicts.count', result.conflicts.length);
  span.setAttribute('conflicts.has_conflict', result.hasConflict);

  return NextResponse.json(result);
}

async function handleSecurityMetrics(
  paymentSecurity: PaymentSecurityService,
  tenantId: string,
  span: any
): Promise<NextResponse> {
  const metrics = await paymentSecurity.monitorSecurityMetrics(tenantId);

  span.setAttribute('security.chargeback_rate', metrics.chargeback_rate);
  span.setAttribute('security.fraud_score', metrics.fraud_score);

  return NextResponse.json({
    success: true,
    metrics,
    timestamp: new Date().toISOString(),
  });
}

async function handleFraudAssessment(
  req: NextRequest,
  paymentSecurity: PaymentSecurityService,
  tenantId: string,
  span: any
): Promise<NextResponse> {
  const body = await req.json() as {
    amount: number;
    currency: string;
    email: string;
    ipAddress?: string;
    userAgent?: string;
    countryCode?: string;
    paymentMethod?: string;
  };
  
  const assessment = await paymentSecurity.assessFraud({
    amount: body.amount,
    currency: body.currency,
    email: body.email,
    tenant_id: tenantId,
    ip_address: body.ipAddress,
    user_agent: body.userAgent,
    country_code: body.countryCode,
    payment_method: body.paymentMethod,
  });

  span.setAttribute('fraud.risk_score', assessment.risk_score);
  span.setAttribute('fraud.risk_level', assessment.risk_level);
  span.setAttribute('fraud.recommendation', assessment.recommendation);

  return NextResponse.json({
    success: true,
    assessment,
  });
}

async function handleCleanupExpired(
  doubleBookingPrevention: DoubleBookingPrevention,
  span: any
): Promise<NextResponse> {
  const result = await doubleBookingPrevention.cleanupExpiredLocks();

  span.setAttribute('cleanup.count', result.cleanedCount || 0);

  return NextResponse.json(result);
}