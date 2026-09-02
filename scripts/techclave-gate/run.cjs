const fs = require('fs');
const path = require('path');

const { classifyFiles } = require('./classify.cjs');
const { scanDiff } = require('./deterministic.cjs');
const { decideRelease } = require('./decision.cjs');

function renderSummary(result) {
  const lines = [
    '## TECHCLAVE GATE · Advisory',
    '',
    `**Decision:** ${result.decision}`,
    `**Sensitive change classes:** ${result.classification.classes.join(', ') || 'none'}`,
  ];
  if (result.findings.length > 0) {
    lines.push('', '### Findings');
    for (const finding of result.findings) lines.push(`- **${finding.severity.toUpperCase()}** (${finding.ruleId}): ${finding.summary}`);
  }
  if (result.missingProof.length > 0) lines.push('', `**Required proof:** ${result.missingProof.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

async function runGate({ files, diff, outputDir, policyPath = path.join(process.cwd(), '.techclave/gate-policy.json') }) {
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const classification = classifyFiles(files, policy);
  const scan = scanDiff(diff, classification);
  const decision = decideRelease({ findings: scan.findings });
  const result = {
    schemaVersion: 1,
    decision: decision.decision,
    classification,
    findings: scan.findings,
    missingProof: scan.missingProof,
    scannerFailures: decision.scannerFailures,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'gate-result.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'gate-summary.md'), renderSummary(result));
  return result;
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (require.main === module) {
  const filesJson = readOption(process.argv, '--files-json');
  const diffFile = readOption(process.argv, '--diff-file');
  const outputDir = readOption(process.argv, '--output-dir');
  const policyPath = readOption(process.argv, '--policy');
  if (!filesJson || !diffFile || !outputDir) {
    process.stderr.write('Usage: node run.cjs --files-json <path> --diff-file <path> --output-dir <path> [--policy <path>]\n');
    process.exitCode = 2;
  } else {
    const entries = JSON.parse(fs.readFileSync(filesJson, 'utf8'));
    const files = entries.map((entry) => typeof entry === 'string' ? entry : entry.filename).filter(Boolean);
    runGate({ files, diff: fs.readFileSync(diffFile, 'utf8'), outputDir, policyPath }).then((result) => {
      process.stdout.write(`${result.decision}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = { renderSummary, runGate };
