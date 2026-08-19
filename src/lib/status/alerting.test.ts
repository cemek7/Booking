import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sendCriticalAlert = jest.fn();
const sendWarningAlert = jest.fn();
jest.mock('@/lib/monitoring/alerting', () => ({
  getAlertService: () => ({ sendCriticalAlert, sendWarningAlert }),
}));

import { alertOnProbeFailures } from '@/lib/status/alerting';

describe('alertOnProbeFailures', () => {
  beforeEach(() => {
    sendCriticalAlert.mockReset();
    sendWarningAlert.mockReset();
  });

  it('does nothing when all probes are operational', async () => {
    await alertOnProbeFailures([
      { name: 'API health', status: 'operational' },
      { name: 'Readiness', status: 'operational' },
    ]);
    expect(sendCriticalAlert).not.toHaveBeenCalled();
    expect(sendWarningAlert).not.toHaveBeenCalled();
  });

  it('sends a warning when something is degraded but nothing is down', async () => {
    await alertOnProbeFailures([
      { name: 'API health', status: 'operational' },
      { name: 'Readiness', status: 'degraded' },
    ]);
    expect(sendWarningAlert).toHaveBeenCalledTimes(1);
    expect(sendCriticalAlert).not.toHaveBeenCalled();
    const [msg] = sendWarningAlert.mock.calls[0] as [string, unknown];
    expect(msg).toMatch(/Readiness=degraded/);
  });

  it('sends a critical alert when a probe is down', async () => {
    await alertOnProbeFailures([
      { name: 'API health', status: 'down' },
      { name: 'Readiness', status: 'degraded' },
    ]);
    expect(sendCriticalAlert).toHaveBeenCalledTimes(1);
    expect(sendWarningAlert).not.toHaveBeenCalled();
  });
});
