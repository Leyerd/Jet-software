#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const nodeBin = process.execPath;
const cwd = path.join(__dirname, '..');

const server = spawn(nodeBin, ['server.js'], {
  cwd,
  env: { ...process.env, PERSISTENCE_MODE: process.env.PERSISTENCE_MODE || 'file' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let started = false;
server.stdout.on('data', d => {
  const msg = d.toString();
  process.stdout.write(msg);
  if (msg.includes('escuchando en puerto')) started = true;
});
server.stderr.on('data', d => process.stderr.write(d.toString()));

function runSmoke() {
  return new Promise((resolve) => {
    const smoke = spawn(nodeBin, ['scripts/qa-smoke.js'], { cwd, env: process.env, stdio: 'inherit' });
    smoke.on('exit', code => resolve(code || 0));
  });
}

(async () => {
  const timeout = Date.now() + 5000;
  while (!started && Date.now() < timeout) {
    await new Promise(r => setTimeout(r, 100));
  }

  if (!started) {
    console.error('QA runner FAIL: server no inició a tiempo');
    server.kill('SIGTERM');
    process.exit(1);
  }

  const code = await runSmoke();
  server.kill('SIGTERM');
  process.exit(code);
})();
