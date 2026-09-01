'use strict';

// Durable, low-frequency Instagram browser collection endurance runner.
// It runs exactly one keyword pass at a time and persists count-only progress.
// A platform restriction, session failure, or child-process failure stops the
// daemon immediately; it never retries aggressively or bypasses safeguards.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function positiveInteger(value, fallback, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function runPass(scriptPath, args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: ['ignore', 'ignore', 'ignore'] });
    child.once('error', error => resolve({ code: null, error: error.code || 'CHILD_PROCESS_ERROR' }));
    child.once('exit', code => resolve({ code, error: null }));
  });
}

async function main() {
  const userData = option('--user-data');
  if (!userData) throw new Error('Missing --user-data');
  const progressFile = path.resolve(option('--progress-file', path.join('test-results', 'instagram-3c-endurance-progress.json')));
  const passResultFile = path.resolve(option('--pass-result-file', path.join('test-results', 'instagram-3c-endurance-last-pass.json')));
  const intervalMs = positiveInteger(option('--interval-ms'), 10 * 60_000, 60 * 60_000);
  const maxRounds = Number(option('--max-rounds', '0')) || 0;
  const category = option('--category', 'Electronics & Technology');
  const keywords = (option('--keywords', 'tech review,gadget review,smartphone review,laptop review,consumer electronics'))
    .split(',').map(value => value.trim()).filter(Boolean);
  if (!keywords.length) throw new Error('No keywords configured');

  const state = {
    status: 'running',
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    stopReason: null,
    rounds: 0,
    candidates: 0,
    saved: 0,
    inserted: 0,
    updated: 0,
    lastCompletedAt: null,
    lastKeyword: null,
    lastErrorCode: null,
  };
  writeJson(progressFile, state);
  const collectionScript = path.join(__dirname, 'instagram-keyword-profile-collection.js');

  while (!maxRounds || state.rounds < maxRounds) {
    const keyword = keywords[state.rounds % keywords.length];
    try { fs.unlinkSync(passResultFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const child = await runPass(collectionScript, [
      '--user-data', userData,
      '--keyword', keyword,
      '--category', category,
      '--result-file', passResultFile,
    ]);
    let result = null;
    try { result = JSON.parse(fs.readFileSync(passResultFile, 'utf8')); } catch (error) { }
    state.rounds += 1;
    state.lastKeyword = keyword;
    state.lastCompletedAt = new Date().toISOString();
    if (!result || child.code !== 0 || result.ok !== true) {
      state.status = 'stopped';
      state.stoppedAt = state.lastCompletedAt;
      state.lastErrorCode = result?.code || child.error || 'NO_COLLECTION_SUMMARY';
      state.stopReason = 'collection_error';
      writeJson(progressFile, state);
      return;
    }
    state.candidates += Number(result.candidates || 0);
    state.saved += Number(result.saved || 0);
    state.inserted += Number(result.inserted || 0);
    state.updated += Number(result.updated || 0);
    writeJson(progressFile, state);
    if (maxRounds && state.rounds >= maxRounds) {
      state.status = 'complete';
      state.stoppedAt = new Date().toISOString();
      state.stopReason = 'max_rounds_reached';
      writeJson(progressFile, state);
      return;
    }
    await wait(intervalMs);
  }
}

main().catch(error => {
  const progressFile = path.resolve(option('--progress-file', path.join('test-results', 'instagram-3c-endurance-progress.json')));
  writeJson(progressFile, { status: 'stopped', stoppedAt: new Date().toISOString(), stopReason: 'runner_error', lastErrorCode: error?.code || 'ENDURANCE_RUNNER_ERROR' });
  process.exitCode = 1;
});
