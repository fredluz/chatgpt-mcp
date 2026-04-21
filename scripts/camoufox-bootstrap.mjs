#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getLaunchPath } = require('camoufox');

function log(message) {
  console.error(`[camoufox-bootstrap] ${message}`);
}

function hasCamoufoxBinary() {
  try {
    const launchPath = getLaunchPath();
    return typeof launchPath === 'string' && launchPath.length > 0;
  } catch {
    return false;
  }
}

if (process.env.CHATGPT_MCP_SKIP_CAMOUFOX_FETCH === '1') {
  log('skipping fetch because CHATGPT_MCP_SKIP_CAMOUFOX_FETCH=1');
  process.exit(0);
}

if (hasCamoufoxBinary()) {
  log('browser binary already installed');
  process.exit(0);
}

log('Camoufox browser binary missing; running `camoufox fetch`');
const npmExec = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(npmExec, ['camoufox', 'fetch'], { stdio: 'inherit' });

if (run.status !== 0) {
  log('fetch failed; run `npx camoufox fetch` manually before using the Camoufox backend');
  process.exit(0);
}

if (!hasCamoufoxBinary()) {
  log('fetch completed but no browser binary was detected; run `npx camoufox fetch` manually');
}
