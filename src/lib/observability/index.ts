/**
 * Unified observability entry point.
 *
 * Import from '@/lib/observability' — automatically selects Node or Edge
 * implementation based on runtime environment.
 *
 * For Prometheus metrics, import from '@/lib/metrics'.
 */
export { observability } from './observability';
