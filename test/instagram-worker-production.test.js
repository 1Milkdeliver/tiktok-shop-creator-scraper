'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const workerRoot = path.join(projectRoot, 'runtime', 'python', 'workers');
const pythonCommand = process.env.PYTHON || 'python';
const pythonAvailable = spawnSync(pythonCommand, ['--version'], { windowsHide: true }).status === 0;

test('Instagram public-profile worker is covered with injected offline adapter doubles', { skip: !pythonAvailable }, () => {
  const result = spawnSync(pythonCommand, ['test_instagram_worker_live.py'], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
