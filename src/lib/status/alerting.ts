import { getAlertService } from '@/lib/monitoring/alerting';
import { overallStatus, type ProbeStatus } from './probe';

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
}

/**
 * Alert when any probe is non-operational. Routes through the committed
 * AlertService (Telegram/Slack/email per its config): 'down' → critical,
 * 'degraded' → warning. No-op when everything is operational.
 */
export async function alertOnProbeFailures(results: ProbeResult[]): Promise<void> {
  const failing = results.filter((r) => r.status !== 'operational');
  if (failing.length === 0) return;

  const overall = overallStatus(results.map((r) => r.status));
  const summary = `System status ${overall}: ${failing
    .map((f) => `${f.name}=${f.status}`)
    .join(', ')}`;
  const context = { operation: 'status_probe', metadata: { failing, overall } };

  const service = getAlertService();
  if (overall === 'down') {
    await service.sendCriticalAlert(summary, context);
  } else {
    await service.sendWarningAlert(summary, context);
  }
}
