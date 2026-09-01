const childProcess = require('child_process');
const path = require('path');

const { runGate } = require('./run.cjs');

async function replay({ base, head, outputRoot, execFileSync = childProcess.execFileSync }) {
  const range = `${base}...${head}`;
  const files = execFileSync('git', ['diff', '--no-ext-diff', '--name-only', range], { encoding: 'utf8' })
    .toString()
    .split('\n')
    .filter(Boolean);
  const diff = execFileSync('git', ['diff', '--no-ext-diff', range], { encoding: 'utf8' }).toString();
  return runGate({ files, diff, outputDir: path.join(outputRoot, `${base}..${head}`) });
}

function readOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (require.main === module) {
  const base = readOption(process.argv, '--base');
  const head = readOption(process.argv, '--head');
  const outputRoot = readOption(process.argv, '--output-root');
  if (!base || !head || !outputRoot) {
    process.stderr.write('Usage: node replay.cjs --base <sha> --head <sha> --output-root <path>\n');
    process.exitCode = 2;
  } else {
    replay({ base, head, outputRoot }).then((result) => {
      process.stdout.write(`${result.decision}\n`);
    }).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = { replay };
