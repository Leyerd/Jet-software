#!/usr/bin/env node
const { execSync } = require('child_process');

function run(cmd) {
  console.log(`\n[CI] $ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

try {
  run("find . -name '*.js' -print | sort | xargs -I{} node --check {}");
  run('node scripts/qa-runner.js');
  console.log('\n[CI] OK: quality gate passed');
} catch (err) {
  console.error('\n[CI] FAIL: quality gate failed');
  process.exit(1);
}
