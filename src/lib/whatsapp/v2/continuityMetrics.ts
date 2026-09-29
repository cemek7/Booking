import { createHash } from 'crypto';
import { Counter, Histogram, register } from 'prom-client';

function counter(name: string, help: string, labelNames: string[]): Counter<string> {
  return (register.getSingleMetric(name) as Counter<string> | undefined)
    ?? new Counter({ name, help, labelNames });
}

function histogram(
  name: string,
  help: string,
  labelNames: string[],
  buckets: number[],
): Histogram<string> {
  return (register.getSingleMetric(name) as Histogram<string> | undefined)
    ?? new Histogram({ name, help, labelNames, buckets });
}

export const conversationRouteNeedsCode = counter(
  'conversation_route_needs_code_total', 'Shared-channel messages that could not be tenant-routed', ['channel'],
);
export const conversationRouteChanged = counter(
  'conversation_route_changed_total', 'Explicit shared-channel route bindings', ['channel', 'source'],
);
export const conversationQueueClaim = counter(
  'conversation_queue_claim_total', 'Durable conversation queue claim outcomes', ['channel', 'outcome'],
);
export const conversationQueueLeaseRecovery = counter(
  'conversation_queue_lease_recovery_total', 'Claims containing previously retried queue rows', ['channel'],
);
export const conversationDuplicateEffectPrevented = counter(
  'conversation_duplicate_effect_prevented_total', 'Duplicate irreversible conversation effects suppressed', ['effect_type', 'status'],
);
export const conversationContextIsolationFailure = counter(
  'conversation_context_isolation_failure_total', 'Tenant/customer/thread context isolation failures', ['stage'],
);
export const conversationStateConflict = counter(
  'conversation_state_conflict_total', 'Optimistic conversation state update conflicts', ['operation'],
);
export const conversationHandoff = counter(
  'conversation_handoff_total', 'Conversation handoff transitions', ['channel', 'source'],
);
export const conversationContextAssemblyDuration = histogram(
  'conversation_context_assembly_duration_seconds', 'Time to assemble tenant-isolated AI conversation context',
  ['mode', 'outcome'], [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
);
export const conversationContextTokenEstimate = histogram(
  'conversation_context_token_estimate', 'Approximate tokens included in assembled conversation context',
  ['mode'], [50, 100, 250, 500, 1000, 2000, 4000, 8000],
);

export function safeMetric(action: () => void): void {
  try { action(); } catch { /* metrics must never break message processing */ }
}

export function hashCorrelationId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
