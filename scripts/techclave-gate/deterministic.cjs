const { createFinding } = require('./types.cjs');

function addedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function scanDiff(diff, classification = { classes: [], requirements: [] }) {
  const lines = addedLines(diff);
  const text = lines.join('\n');
  const findings = [];
  const missingProof = new Set();

  if (/\bgh[pousr]_[A-Za-z0-9]{36,255}\b/.test(text)) {
    findings.push(createFinding({
      ruleId: 'secret.github-token',
      severity: 'critical',
      evidenceKind: 'deterministic',
      summary: 'Added GitHub token detected in pull-request diff.',
    }));
  }

  if (/\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b/.test(text)) {
    findings.push(createFinding({
      ruleId: 'secret.openai-key',
      severity: 'critical',
      evidenceKind: 'deterministic',
      summary: 'Added API key detected in pull-request diff.',
    }));
  }

  if (/\bAKIA[0-9A-Z]{16}\b/.test(text)) {
    findings.push(createFinding({
      ruleId: 'secret.aws-access-key',
      severity: 'critical',
      evidenceKind: 'deterministic',
      summary: 'Added AWS access key detected in pull-request diff.',
    }));
  }

  const isMigration = classification.classes.includes('database_migrations');
  const definesFunction = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(text);
  const revokesPublic = /\bREVOKE\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION[\s\S]*?\bFROM\s+PUBLIC\b/i.test(text);
  if (isMigration && definesFunction && !revokesPublic) {
    missingProof.add('rls_and_function_privilege_review');
  }

  if (isMigration && /\bDISABLE\s+ROW\s+LEVEL\s+SECURITY\b/i.test(text)) {
    findings.push(createFinding({
      ruleId: 'database.rls-disabled',
      severity: 'critical',
      evidenceKind: 'deterministic',
      summary: 'Migration disables row-level security.',
    }));
  }

  if (isMigration && /\bGRANT\s+(?:ALL|EXECUTE)[\s\S]*?\bTO\s+PUBLIC\b/i.test(text)) {
    findings.push(createFinding({
      ruleId: 'database.public-grant',
      severity: 'critical',
      evidenceKind: 'deterministic',
      summary: 'Migration grants database privileges to PUBLIC.',
    }));
  }

  return {
    findings,
    missingProof: [...missingProof].sort(),
  };
}

module.exports = {
  scanDiff,
};
