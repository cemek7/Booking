import { register, Histogram, collectDefaultMetrics, Counter, Gauge } from 'prom-client';

collectDefaultMetrics({ register });

export const reservationCreationDuration = new Histogram({
  name: 'reservation_creation_duration_seconds',
  help: 'Duration of reservation creation operation in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_seconds',
  help: 'Duration of LLM classification / reply generation in seconds',
  buckets: [0.25, 0.5, 1, 2, 4, 8, 16]
});

export const paymentWebhookDuration = new Histogram({
  name: 'payment_webhook_duration_seconds',
  help: 'Duration of payment webhook processing in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

export const outboxDispatchCount = new Histogram({
  name: 'event_outbox_dispatch_count',
  help: 'Count of events dispatched per run',
  buckets: [1, 5, 10, 25, 50, 100]
});

export const outboxDispatchTotal = new Counter({ name: 'outbox_dispatch_total', help: 'Total outbox events dispatched', labelNames: ['status'] });
export const outboxDispatchDuration = new Histogram({ name: 'outbox_dispatch_duration_seconds', help: 'Outbox dispatch operation duration', buckets: [0.1, 0.25, 0.5, 1, 2, 5] });

// Booking lifecycle metrics
export const bookingsCreatedTotal = new Counter({ name: 'bookings_created_total', help: 'Total reservations created', labelNames: ['tenant'] });
export const bookingsCancelledTotal = new Counter({ name: 'bookings_cancelled_total', help: 'Total reservations cancelled', labelNames: ['tenant'] });

export const bookingsActiveGauge = new Gauge({ name: 'bookings_active_total', help: 'Active reservations snapshot (set by increments/decrements)', labelNames: ['tenant'] });

export { register as metricsRegistry };
/**
 * Minimal metrics hooks used by worker and admin dashboards.
 * If no metrics backend is configured, these functions log to console.
 */

export async function incr(metricName: string, value = 1) {
  try {
    if (process.env.METRICS_BACKEND === 'console' || !process.env.METRICS_BACKEND) {
      console.log(`metric incr ${metricName} +${value}`);
      return;
    }
    // Placeholder: integrate with Prometheus pushgateway or other system in future
  } catch (e) {
    console.warn('metrics.incr failed', e);
  }
}

export async function gauge(metricName: string, value: number) {
  try {
    console.log(`metric gauge ${metricName} => ${value}`);
  } catch (e) { console.warn('metrics.gauge failed', e); }
}

const metrics = { incr, gauge };
export default metrics;

// Additional counters/histograms for HTTP + chat + webhook replay + payments lifecycle
export const httpRequestsTotal = new Counter({ name: 'http_requests_total', help: 'Total HTTP requests', labelNames: ['route','method','status'] });
export const httpRequestDurationSeconds = new Histogram({ name: 'http_request_duration_seconds', help: 'HTTP request duration seconds', labelNames: ['route','method','status'], buckets: [0.05,0.1,0.25,0.5,1,2,5] });
export const chatMessagesSent = new Counter({ name: 'chat_messages_sent_total', help: 'Outbound chat messages sent', labelNames: ['tenant'] });
export const webhookReplayTotal = new Counter({ name: 'webhook_replay_total', help: 'Webhook replay detections', labelNames: ['provider'] });

// Payment lifecycle metrics
export const paymentRefundsTotal = new Counter({ name: 'payment_refunds_total', help: 'Total payment refunds processed', labelNames: ['tenant', 'status'] });
export const paymentRefundAmount = new Histogram({ name: 'payment_refund_amount', help: 'Payment refund amounts', labelNames: ['tenant'], buckets: [10, 50, 100, 500, 1000, 5000, 10000] });
export const transactionRetriesTotal = new Counter({ name: 'transaction_retries_total', help: 'Total transaction retry attempts', labelNames: ['tenant', 'status'] });
export const reconciliationDiscrepancies = new Counter({ name: 'reconciliation_discrepancies_total', help: 'Reconciliation discrepancies found', labelNames: ['tenant', 'type'] });
export const depositIdempotencyHits = new Counter({ name: 'deposit_idempotency_hits_total', help: 'Deposit creation idempotency cache hits', labelNames: ['tenant'] });

export function observeRequest(route: string, method: string, status: number, seconds: number) {
  try {
    httpRequestsTotal.inc({ route, method, status: String(status) });
    httpRequestDurationSeconds.observe({ route, method, status: String(status) }, seconds);
  } catch {}
}

export function metricsText() { return register.metrics(); }

export function bookingCreated(tenant: string) { try { bookingsCreatedTotal.inc({ tenant }); bookingsActiveGauge.inc({ tenant }); } catch {} }
export function bookingCancelled(tenant: string) { try { bookingsCancelledTotal.inc({ tenant }); bookingsActiveGauge.dec({ tenant }); } catch {} }
export function dispatchSuccess() { try { outboxDispatchTotal.inc({ status: 'success' }); } catch {} }
export function dispatchFailure() { try { outboxDispatchTotal.inc({ status: 'failure' }); } catch {} }
export function observeDispatch(seconds: number) { try { outboxDispatchDuration.observe(seconds); } catch {} }

// Payment lifecycle metric helpers
export function refundProcessed(tenant: string, status: 'success' | 'failed', amount?: number) {
  try {
    paymentRefundsTotal.inc({ tenant, status });
    if (amount && status === 'success') {
      paymentRefundAmount.observe({ tenant }, amount);
    }
  } catch {}
}

export function transactionRetried(tenant: string, status: 'success' | 'failed') {
  try { transactionRetriesTotal.inc({ tenant, status }); } catch {}
}

export function reconciliationDiscrepancy(tenant: string, type: 'amount_mismatch' | 'status_mismatch' | 'provider_error') {
  try { reconciliationDiscrepancies.inc({ tenant, type }); } catch {}
}

export function depositIdempotencyHit(tenant: string) {
  try { depositIdempotencyHits.inc({ tenant }); } catch {}
}

export async function pushMetrics() {
  const url = process.env.PUSHGATEWAY_URL;
  if (!url) return;
  try {
    // dynamic import to avoid cost if unused
    const { Pushgateway } = await import('prom-client');
    const pg = new Pushgateway(url);
    // pushAdd without callback in newer prom-client returns a Promise
    await pg.pushAdd({ jobName: 'boka' });
  } catch (e) { console.warn('pushMetrics failed', e); }
}
