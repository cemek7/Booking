const { DECISIONS } = require('./types.cjs');

function decideRelease({ findings = [], scannerFailures = [] }) {
  if (scannerFailures.length > 0) {
    return { decision: DECISIONS.VALIDATION_INCOMPLETE, findings, scannerFailures };
  }

  const deterministicCritical = findings.some((finding) =>
    finding.evidenceKind === 'deterministic' && finding.severity === 'critical',
  );
  if (deterministicCritical) return { decision: DECISIONS.WOULD_BLOCK, findings, scannerFailures };
  if (findings.length > 0) return { decision: DECISIONS.REVIEW_REQUIRED, findings, scannerFailures };
  return { decision: DECISIONS.APPROVE, findings, scannerFailures };
}

module.exports = { decideRelease };
