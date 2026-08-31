const { validatePolicy } = require('./types.cjs');

function toChangeClass(ruleId) {
  return ruleId.replaceAll('.', '_');
}

function classifyFiles(paths, policy) {
  validatePolicy(policy);

  const classes = new Set();
  const requirements = new Set();
  const matchedRules = [];

  for (const rule of policy.rules) {
    const patterns = (rule.paths || []).map((pattern) => new RegExp(pattern));
    const matchedPaths = paths.filter((filePath) => patterns.some((pattern) => pattern.test(filePath)));
    if (matchedPaths.length === 0) continue;

    classes.add(toChangeClass(rule.id));
    for (const requirement of rule.requires || []) requirements.add(requirement);
    matchedRules.push({ id: rule.id, paths: matchedPaths });
  }

  return {
    classes: [...classes].sort(),
    matchedRules,
    requirements: [...requirements].sort(),
  };
}

module.exports = {
  classifyFiles,
};
