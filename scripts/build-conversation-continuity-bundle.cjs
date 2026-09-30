#!/usr/bin/env node

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const continuityReleaseFiles = Object.freeze([
  'db/releases/2026-09-28-conversation-continuity.sql',
  'db/releases/2026-09-28-channel-identity-runtime-hardening.sql',
  'db/releases/2026-09-28-conversation-ingest-replay-hardening.sql',
  'db/releases/2026-09-29-conversation-effect-delivery-hardening.sql',
  'db/releases/2026-09-29-verified-customer-memory.sql',
  'db/releases/2026-09-29-handoff-thread-continuity.sql',
]);

const verifierFile = 'scripts/sql/verify_conversation_continuity.sql';
const outputFile = 'db/releases/2026-09-30-conversation-continuity-all-in-one.sql';

function normalizeNewlines(content) {
  return content.replace(/\r\n?/g, '\n');
}

function stripTransactionWrapper(source) {
  const lines = normalizeNewlines(source.content).split('\n');
  const beginIndexes = [];
  const commitIndexes = [];

  lines.forEach((line, index) => {
    if (/^\s*BEGIN;\s*$/i.test(line)) beginIndexes.push(index);
    if (/^\s*COMMIT;\s*$/i.test(line)) commitIndexes.push(index);
  });

  if (
    beginIndexes.length !== 1
    || commitIndexes.length !== 1
    || beginIndexes[0] >= commitIndexes[0]
  ) {
    throw new Error(
      `${source.path} must contain exactly one ordered line-only transaction wrapper`,
    );
  }

  return lines
    .filter((_line, index) => index !== beginIndexes[0] && index !== commitIndexes[0])
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function buildBundle({ releases, verifier }) {
  if (!Array.isArray(releases) || releases.length === 0) {
    throw new Error('At least one release is required');
  }
  if (!verifier || typeof verifier.content !== 'string') {
    throw new Error('A final verifier is required');
  }

  const sections = releases.map((source) => [
    `-- source: ${source.path}`,
    stripTransactionWrapper(source),
  ].join('\n'));
  const verifierBody = normalizeNewlines(verifier.content).replace(/^\n+|\n+$/g, '');

  return [
    '-- GENERATED FILE. DO NOT EDIT DIRECTLY.',
    '-- Regenerate with: npm run db:bundle:conversation-continuity',
    '-- Run first in staging Supabase SQL Editor after confirming backup/PITR.',
    '',
    'BEGIN;',
    '',
    sections.join('\n\n'),
    '',
    `-- final verifier: ${verifier.path}`,
    verifierBody,
    '',
    'COMMIT;',
    '',
  ].join('\n');
}

function generateBundle(repositoryRoot = resolve(__dirname, '..')) {
  const releases = continuityReleaseFiles.map((path) => ({
    path,
    content: readFileSync(resolve(repositoryRoot, path), 'utf8'),
  }));
  const verifier = {
    path: verifierFile,
    content: readFileSync(resolve(repositoryRoot, verifierFile), 'utf8'),
  };
  const output = buildBundle({ releases, verifier });
  writeFileSync(resolve(repositoryRoot, outputFile), output, 'utf8');
  return output;
}

module.exports = {
  buildBundle,
  continuityReleaseFiles,
  generateBundle,
  outputFile,
  verifierFile,
};

if (require.main === module) {
  generateBundle();
  process.stdout.write(`${outputFile}\n`);
}
