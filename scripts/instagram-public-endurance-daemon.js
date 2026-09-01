'use strict';

// Keeps the existing one-tick public endurance runner alive across its
// low-frequency waits. It deliberately makes no Instagram profile request,
// loads no Cookie, and stops at the persisted 48-hour target.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeLock(file) {
  const lockFile = `${file}.daemon.lock`;
  try {
    const descriptor = fs.openSync(lockFile, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return { descriptor, lockFile };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = readJson(lockFile);
    const existingPid = Number(existing?.pid || 0);
    let alive = false;
    try { if (existingPid > 0) { process.kill(existingPid, 0); alive = true; } } catch (_) {}
    if (alive) return null;
    try { fs.renameSync(lockFile, `${lockFile}.stale-${Date.now()}`); } catch (_) { return null; }
    return writeLock(file);
  }
}

function releaseLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.descriptor); } catch (_) {}
  try { fs.unlinkSync(lock.lockFile); } catch (_) {}
}

function runTick(runner, stateFile, progressFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, '--state-file', stateFile, '--progress-file', progressFile], {
      cwd: path.dirname(runner), stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
    });
    child.once('error', () => resolve());
    child.once('exit', () => resolve());
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(1_000, Math.min(ms, 30 * 60_000))));
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const stateFile = path.resolve(option('--state-file') || path.join(projectRoot, 'test-results', 'instagram-public-no-cookie-48h-state.json'));
  const progressFile = path.resolve(option('--progress-file') || path.join(projectRoot, 'test-results', 'instagram-public-no-cookie-48h-progress.json'));
  const runner = path.join(__dirname, 'instagram-public-endurance-runner.js');
  const lock = writeLock(stateFile);
  if (!lock) {
    console.log(JSON.stringify({ status: 'already_running' }));
    return;
  }
  try {
    while (true) {
      const state = readJson(stateFile);
      if (!state || state.status === 'complete' || Date.now() >= Number(state.targetEndsAt || 0)) break;
      if (Date.now() >= Number(state.nextEligibleAt || 0)) await runTick(runner, stateFile, progressFile);
      const updated = readJson(stateFile);
      if (!updated || updated.status === 'complete' || Date.now() >= Number(updated.targetEndsAt || 0)) break;
      await wait(Number(updated.nextEligibleAt || Date.now() + 60_000) - Date.now());
    }
  } finally {
    releaseLock(lock);
  }
}

main().catch(() => { process.exitCode = 1; });
