import { CFG } from './config';

export interface RiskStats {
  initiatedRecipients: number;
  sent: number;
  initiated: number;
  cold: number;
  optOuts: number;
  failures: number;
}

export function computeRiskScore(stats: RiskStats, allocation: number): number {
  const weights = CFG.weights();
  const volume = Math.min(1, stats.initiatedRecipients / Math.max(allocation, 1));
  const cold = stats.cold / Math.max(stats.initiated, 1);
  const optOut = Math.min(1, (stats.optOuts / Math.max(stats.sent, 1)) / CFG.optOutDanger());
  const failure = Math.min(1, (stats.failures / Math.max(stats.sent, 1)) / CFG.failureDanger());

  return Math.min(
    1,
    weights.volume * volume +
      weights.cold * cold +
      weights.optOut * optOut +
      weights.failure * failure,
  );
}
