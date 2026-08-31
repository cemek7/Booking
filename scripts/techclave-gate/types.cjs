const DECISIONS = Object.freeze({
  APPROVE: 'APPROVE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  WOULD_BLOCK: 'WOULD_BLOCK',
  VALIDATION_INCOMPLETE: 'VALIDATION_INCOMPLETE',
});

const SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
const EVIDENCE_KINDS = Object.freeze(['deterministic', 'corroborated', 'model', 'missing_proof']);

function validatePolicy(policy) {
  if (!policy || policy.version !== 1 || !Array.isArray(policy.rules)) {
    throw new Error('policy must have version 1 and a rules array');
  }

  const ruleIds = new Set();
  for (const rule of policy.rules) {
    if (!rule || typeof rule.id !== 'string' || rule.id.length === 0) {
      throw new Error('policy rules require an id');
    }
    if (ruleIds.has(rule.id)) {
      throw new Error(`duplicate policy rule id: ${rule.id}`);
    }
    ruleIds.add(rule.id);

    if (rule.block && rule.evidenceKind !== 'deterministic') {
      throw new Error('blocking rules require deterministic evidence');
    }
  }

  return policy;
}

function createFinding(input) {
  if (!input || typeof input.ruleId !== 'string' || input.ruleId.length === 0) {
    throw new Error('finding requires a ruleId');
  }
  if (!SEVERITIES.includes(input.severity)) {
    throw new Error(`invalid finding severity: ${input.severity}`);
  }
  if (!EVIDENCE_KINDS.includes(input.evidenceKind)) {
    throw new Error(`invalid evidence kind: ${input.evidenceKind}`);
  }

  const isDeterministicCritical = input.evidenceKind === 'deterministic' && input.severity === 'critical';
  return {
    ...input,
    confidence: input.confidence ?? (input.evidenceKind === 'deterministic' ? 100 : 0),
    decisionEligible: isDeterministicCritical ? DECISIONS.WOULD_BLOCK : DECISIONS.REVIEW_REQUIRED,
  };
}

module.exports = {
  DECISIONS,
  EVIDENCE_KINDS,
  SEVERITIES,
  createFinding,
  validatePolicy,
};
