#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { buildDemoState } = require('../apps/api/src/lib/demoData');

const storePath = path.join(__dirname, '..', 'apps', 'api', 'data', 'store.json');
const demo = buildDemoState();

fs.mkdirSync(path.dirname(storePath), { recursive: true });
fs.writeFileSync(storePath, JSON.stringify(demo.state, null, 2));

console.log(JSON.stringify({
  ok: true,
  storePath,
  totalsByYear: demo.totalsByYear,
  products: demo.products,
  movements: demo.movements
}, null, 2));
