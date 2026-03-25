#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');

try {
  const output = execSync('npm run build 2>&1', { encoding: 'utf-8', timeout: 180000 });
  fs.writeFileSync('build.log', output);
  console.log('Build succeeded');
} catch (e) {
  fs.writeFileSync('build.log', e.stdout || e.message);
  console.log('Build failed - check build.log');
}
