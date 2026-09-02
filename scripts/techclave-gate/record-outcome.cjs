const fs = require('fs');
const path = require('path');

const OUTCOMES = new Set(['accepted', 'fixed', 'false_positive', 'accepted_risk', 'needs_more_evidence']);

function recordOutcome({ resultId, ruleId, outcome, actor }, logPath) {
  if (!/^sha:[A-Za-z0-9_-]+$/.test(resultId)) throw new Error('invalid result id');
  if (typeof ruleId !== 'string' || ruleId.length === 0) throw new Error('invalid rule id');
  if (!OUTCOMES.has(outcome)) throw new Error('invalid outcome');
  const record = { recordedAt: new Date().toISOString(), resultId, ruleId, outcome };
  if (actor) record.actor = actor;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  return record;
}

module.exports = { OUTCOMES, recordOutcome };
