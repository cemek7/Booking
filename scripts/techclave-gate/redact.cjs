const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g,
  /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

function redactForReasoner(diff, files) {
  const excludedFiles = files.filter((filePath) => filePath.split('/').at(-1).startsWith('.env'));
  if (excludedFiles.length > 0) return { text: '', excludedFiles };

  let text = diff;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED_SECRET]');
  return { text: text.slice(0, 12000), excludedFiles };
}

module.exports = { redactForReasoner };
